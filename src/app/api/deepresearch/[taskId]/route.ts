import { NextResponse } from "next/server";
import { Valyu } from "valyu-js";
import { isSelfHostedMode } from "@/lib/app-mode";
import { withDeadline } from "@/lib/network";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyReportAccessToken } from "@/lib/report-access";
import { parseResearchEffort } from "@/lib/research-effort";
import { activitySources, researchActivity } from "@/lib/research-activity";
import { getValyuAccessToken } from "@/lib/valyu-session";

export const dynamic = "force-dynamic";

async function statusViaOAuth(taskId: string, accessToken: string) {
  const requestStatus = (token: string) => fetch(`${process.env.VALYU_APP_URL || "https://platform.valyu.ai"}/api/oauth/proxy`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: `/v1/deepresearch/tasks/${taskId}/status`, method: "GET" }),
  });
  let response = await withDeadline(requestStatus(accessToken), 15_000, "Research status timed out");
  if (response.status === 401) {
    const refreshed = await getValyuAccessToken(true);
    if (refreshed) response = await withDeadline(requestStatus(refreshed), 15_000, "Research status timed out");
  }
  if (response.status === 401) throw new Error("SESSION_EXPIRED");
  if (response.status === 404) throw new Error("TASK_NOT_FOUND");
  if (!response.ok) throw new Error("Could not read research status");
  return response.json();
}

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    if (!/^[a-zA-Z0-9_-]{6,128}$/.test(taskId)) {
      return NextResponse.json({ error: "Invalid task identifier." }, { status: 400 });
    }

    const selfHosted = isSelfHostedMode();
    if (selfHosted && !verifyReportAccessToken(new URL(request.url).searchParams.get("access"), taskId)) {
      return NextResponse.json({ error: "This report link is invalid or expired." }, { status: 401 });
    }
    const limit = checkRateLimit(request, "research-status", selfHosted ? 90 : 180, 10 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many report updates. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    }

    let data;
    if (selfHosted) {
      const apiKey = process.env.VALYU_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "VALYU_API_KEY is not configured." }, { status: 503 });
      data = await withDeadline(new Valyu(apiKey).deepresearch.status(taskId), 15_000, "Research status timed out");
      if (!data.success) {
        if (/not found|unknown/i.test(String(data.error || ""))) {
          return NextResponse.json({ error: "Research task not found." }, { status: 404 });
        }
        throw new Error("Could not read research status");
      }
    } else {
      const accessToken = await getValyuAccessToken();
      if (!accessToken) return NextResponse.json({ error: "Session expired." }, { status: 401 });
      data = await statusViaOAuth(taskId, accessToken);
    }

    return NextResponse.json({
      taskId,
      status: data.status || "unknown",
      effort: data.mode === undefined ? undefined : parseResearchEffort(data.mode),
      progress: data.progress ? {
        currentStep: data.progress.current_step ?? data.progress.currentStep ?? 0,
        totalSteps: data.progress.total_steps ?? data.progress.totalSteps ?? 0,
      } : undefined,
      activity: researchActivity(data.messages, data.status || "unknown"),
      activitySources: activitySources(data.sources),
      output: data.status === "completed" ? (typeof data.output === "string" ? data.output : JSON.stringify(data.output)) : undefined,
      sources: data.status === "completed" ? (data.sources || [])
        .filter((source: { url?: string }) => {
          try {
            return Boolean(source.url && ["http:", "https:"].includes(new URL(source.url).protocol));
          } catch {
            return false;
          }
        })
        .map((source: { title?: string; url?: string; source_id?: number; snippet?: string; description?: string }) => ({
          title: source.title || "Source",
          url: source.url!,
          sourceId: source.source_id,
          snippet: (source.snippet || source.description || "").slice(0, 360) || undefined,
        })) : undefined,
      pdfUrl: data.status === "completed" ? data.pdf_url : undefined,
      title: data.title,
      createdAt: data.created_at,
      completedAt: data.completed_at,
      error: data.status === "failed" ? "Research task failed." : undefined,
    }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch (error) {
    if (error instanceof Error && error.message === "TASK_NOT_FOUND") {
      return NextResponse.json({ error: "Research task not found." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "SESSION_EXPIRED") {
      return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
    }
    return NextResponse.json({ error: "Could not read research status." }, { status: 500 });
  }
}
