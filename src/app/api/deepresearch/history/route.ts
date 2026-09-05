import { NextResponse } from "next/server";
import { isSelfHostedMode } from "@/lib/app-mode";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseResearchEffort } from "@/lib/research-effort";
import type { ResearchHistoryJob, ResearchHistoryResponse } from "@/lib/research-history";
import { getValyuAccessToken } from "@/lib/valyu-session";

export const dynamic = "force-dynamic";

const historyLimit = 100;
const queryPrefix = "Build a rigorous research plan for the open problem: ";
const statuses = new Set(["queued", "running", "awaiting_input", "paused", "completed", "failed", "cancelled"]);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store", Vary: "Cookie", ...headers },
});

function date(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const timestamp = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp < 8.64e15 ? new Date(timestamp).toISOString() : undefined;
}

function jobFromRecord(value: unknown): ResearchHistoryJob | undefined {
  const job = record(value);
  if (!job) return undefined;
  const id = text(job.deepresearch_id);
  if (!/^[a-zA-Z0-9_-]{6,128}$/.test(id)) return undefined;
  const metadata = record(job.metadata);
  const query = text(job.query) || text(job.input);
  // Older connections can return account-wide results; keep only this app's plans.
  if (metadata?.source !== "arc-agi-n" && !query.startsWith(queryPrefix)) return undefined;
  const queryTitle = query.startsWith(queryPrefix) ? query.slice(queryPrefix.length).split("\n")[0].replace(/\.$/, "") : "";
  const mode = job.mode ?? metadata?.effort;
  return {
    id,
    title: (text(metadata?.problem_title) || text(job.title) || queryTitle || "Research plan").slice(0, 300),
    status: typeof job.status === "string" && statuses.has(job.status) ? job.status : "unknown",
    effort: mode === undefined ? undefined : parseResearchEffort(mode),
    createdAt: date(job.created_at),
    completedAt: date(job.completed_at),
  };
}

export async function GET(request: Request) {
  if (isSelfHostedMode()) {
    return reply({ error: "Self-hosted history is stored in this browser. Open a saved report link to check its status." }, 403);
  }
  if (new URL(request.url).search) {
    return reply({ error: "History does not accept query parameters." }, 400);
  }
  const limit = checkRateLimit(request, "research-history", 30, 10 * 60 * 1000);
  if (!limit.allowed) {
    return reply({ error: "Too many history requests. Try again shortly." }, 429, { "Retry-After": String(limit.retryAfter) });
  }

  try {
    const accessToken = await getValyuAccessToken();
    if (!accessToken) return reply({ error: "Sign in to view your research history." }, 401);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    const list = (token: string) => fetch(`${process.env.VALYU_APP_URL || "https://platform.valyu.ai"}/api/oauth/proxy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: `/v1/deepresearch/list?limit=${historyLimit}`, method: "GET" }),
      cache: "no-store",
      signal,
    });
    let response = await list(accessToken);
    if (response.status === 401) {
      await response.body?.cancel();
      const refreshed = await getValyuAccessToken(true);
      if (!refreshed) return reply({ error: "Session expired. Sign in again." }, 401);
      response = await list(refreshed);
    }
    if (response.status === 401) return reply({ error: "Session expired. Sign in again." }, 401);
    if (!response.ok) {
      await response.body?.cancel();
      return reply({ error: "Could not load research history. Try again shortly." }, response.status === 429 ? 429 : 502);
    }
    const payload: unknown = await response.json();
    const envelope = record(payload);
    const rows = Array.isArray(payload) ? payload : envelope?.data;
    if (envelope?.success === false || !Array.isArray(rows)) {
      return reply({ error: "Could not load research history. Try again shortly." }, 502);
    }
    const jobs = rows.slice(0, historyLimit).map(jobFromRecord).filter((job): job is ResearchHistoryJob => Boolean(job));
    const uniqueJobs = [...new Map(jobs.map((job) => [job.id, job])).values()];
    uniqueJobs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const result: ResearchHistoryResponse = { jobs: uniqueJobs, truncated: rows.length >= historyLimit };
    return reply(result);
  } catch {
    return reply({ error: "Could not load research history. Try again shortly." }, 502);
  }
}
