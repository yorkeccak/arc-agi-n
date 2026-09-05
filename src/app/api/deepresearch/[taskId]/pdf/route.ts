import { NextResponse } from "next/server";
import { Valyu } from "valyu-js";
import { isSelfHostedMode } from "@/lib/app-mode";
import { withDeadline } from "@/lib/network";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyReportAccessToken } from "@/lib/report-access";
import { getValyuAccessToken } from "@/lib/valyu-session";

export const dynamic = "force-dynamic";

const statusViaOAuth = async (taskId: string, accessToken: string) => {
  const requestStatus = (token: string) => fetch(`${process.env.VALYU_APP_URL || "https://platform.valyu.ai"}/api/oauth/proxy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: `/v1/deepresearch/tasks/${taskId}/status`, method: "GET" }),
    cache: "no-store",
  });
  let response = await withDeadline(requestStatus(accessToken), 15_000, "Research status timed out");
  if (response.status === 401) {
    const refreshed = await getValyuAccessToken(true);
    if (refreshed) response = await withDeadline(requestStatus(refreshed), 15_000, "Research status timed out");
  }
  if (response.status === 401) throw new Error("SESSION_EXPIRED");
  if (response.status === 404) throw new Error("TASK_NOT_FOUND");
  if (!response.ok) throw new Error("STATUS_UNAVAILABLE");
  return response.json() as Promise<{ status?: string; pdf_url?: string }>;
};

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
    const limit = checkRateLimit(request, "research-pdf", selfHosted ? 12 : 30, 60 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many PDF requests. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    }

    let data: { success?: boolean; error?: string; status?: string; pdf_url?: string };
    if (selfHosted) {
      const apiKey = process.env.VALYU_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "VALYU_API_KEY is not configured." }, { status: 503 });
      data = await withDeadline(new Valyu(apiKey).deepresearch.status(taskId), 15_000, "Research status timed out");
      if (!data.success) {
        if (/not found|unknown/i.test(String(data.error || ""))) {
          return NextResponse.json({ error: "Research task not found." }, { status: 404 });
        }
        throw new Error("STATUS_UNAVAILABLE");
      }
    } else {
      const accessToken = await getValyuAccessToken();
      if (!accessToken) return NextResponse.json({ error: "Session expired." }, { status: 401 });
      data = await statusViaOAuth(taskId, accessToken);
    }

    if (data.status !== "completed" || !data.pdf_url) {
      return NextResponse.json({ error: "The PDF is not ready yet." }, { status: 409 });
    }
    const pdfUrl = new URL(data.pdf_url);
    if (pdfUrl.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && pdfUrl.protocol === "http:")) {
      throw new Error("INVALID_PDF_URL");
    }
    const pdf = await fetch(pdfUrl, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!pdf.ok || !pdf.body || !/^application\/pdf(?:;|$)/i.test(pdf.headers.get("content-type") || "")) throw new Error("PDF_UNAVAILABLE");

    return new Response(pdf.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="arc-agi-n-${taskId.slice(0, 12)}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "TASK_NOT_FOUND") {
      return NextResponse.json({ error: "Research task not found." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "SESSION_EXPIRED") {
      return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
    }
    return NextResponse.json({ error: "Could not download this PDF." }, { status: 502 });
  }
}
