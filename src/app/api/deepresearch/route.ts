import { NextResponse } from "next/server";
import { Valyu } from "valyu-js";
import { isSelfHostedMode } from "@/lib/app-mode";
import { withDeadline } from "@/lib/network";
import { problems } from "@/lib/problems";
import { checkRateLimit } from "@/lib/rate-limit";
import { validatePaidRequest } from "@/lib/request-security";
import { issueReportAccessToken } from "@/lib/report-access";
import { verifyResearchToken } from "@/lib/research-token";
import { getValyuAccessToken, getValyuUser } from "@/lib/valyu-session";
import type { OpenProblem } from "@/lib/types";

export const dynamic = "force-dynamic";

const buildQuery = (problem: OpenProblem) => {
  const sourceLedger = problem.sources.map((source, index) => [
    `${index + 1}. ${source.title}`,
    `URL: ${source.url}`,
    source.passage ? `Retrieved open-status passage: “${source.passage}”` : undefined,
  ].filter(Boolean).join("\n")).join("\n\n");

  return `Build a rigorous research plan for the open problem: ${problem.title}.

Exact statement: ${problem.statement}
Why it appears open: ${problem.whyOpen}
Proposed foothold: ${problem.smallestStep}
Agent readiness: ${problem.agentReadiness || "not classified"}
Available execution resources: ${problem.executionResources || problem.tools.join(", ")}
Success or falsification criterion: ${problem.successCriterion || "Define a measurable criterion before beginning."}

Starting source ledger:
${sourceLedger || "No starting sources were supplied. Locate primary sources before making status claims."}

Produce:
1. Status check: independently verify that the exact problem and proposed foothold remain open as of today. Treat the supplied passages as discovery leads, not proof. Flag disputed or stale claims.
2. Exact definitions, quantifiers, prerequisites and adjacent formulations.
3. Chronological history of the strongest results, citing primary papers.
4. Approaches tried, what each achieved, and the concrete obstruction or failure mode.
5. Current frontier: best bounds, unresolved cases, public datasets, formalizations and available code.
6. Five neglected or newly feasible routes enabled by modern coding/research agents. Separate evidence from speculation.
7. A 72-hour starting plan with reproducible experiments, tests, falsification criteria and required tools.
8. An agent-ready prompt that forbids claiming numerical evidence as proof and requires a claim ledger.

Return polished GitHub-flavoured Markdown. Put inline mathematics inside $...$ and display equations on separate lines inside $$...$$ so a KaTeX renderer can typeset them. Use fenced code blocks with a language identifier. Use web sources and academic literature, preferring primary sources. Every material claim needs a directly linked citation in the form [[n]](https://source-url). Never emit an unlinked citation number and never cite an identifier that is absent from the returned source set.`;
};

interface NotificationTarget {
  email: string;
  custom_url: string;
}

const readUserEmail = async () => {
  const user = await getValyuUser();
  return user?.email;
};

async function createViaOAuth(problem: OpenProblem, accessToken: string, alertEmail?: NotificationTarget) {
  const response = await fetch(`${process.env.VALYU_APP_URL || "https://platform.valyu.ai"}/api/oauth/proxy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "/v1/deepresearch/tasks",
      method: "POST",
      body: {
        query: buildQuery(problem),
        mode: "fast",
        output_formats: ["markdown", "pdf"],
        alert_email: alertEmail,
        metadata: { source: "arc-agi-n", problem_id: problem.id, problem_title: problem.title },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Session expired. Sign in again.");
    throw new Error(response.status === 402 ? "Insufficient Valyu credits" : "Could not start research");
  }
  return response.json();
}

export async function POST(request: Request) {
  const invalidRequest = validatePaidRequest(request);
  if (invalidRequest) return invalidRequest;
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 64_000) return NextResponse.json({ error: "Research request is too large." }, { status: 413 });
    const rawBody = await request.text();
    if (rawBody.length > 64_000) return NextResponse.json({ error: "Research request is too large." }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
    }
    const suppliedProblem = body && typeof body === "object" ? (body as { problem?: OpenProblem }).problem : undefined;
    if (!suppliedProblem?.id || !suppliedProblem.title || !suppliedProblem.statement) {
      return NextResponse.json({ error: "A valid problem is required." }, { status: 400 });
    }
    const canonicalProblem = problems.find((problem) => problem.id === suppliedProblem.id);
    let problem = canonicalProblem;
    if (!problem && suppliedProblem.provisional && suppliedProblem.id.startsWith("live-")) {
      const claims = verifyResearchToken(suppliedProblem.researchToken);
      const validClaim = claims &&
        claims.title === suppliedProblem.title &&
        claims.question === suppliedProblem.statement &&
        claims.firstStep === suppliedProblem.smallestStep &&
        claims.field === suppliedProblem.field &&
        claims.subfield === suppliedProblem.subfield &&
        claims.whyOpen === suppliedProblem.whyOpen &&
        claims.agentReadiness === suppliedProblem.agentReadiness &&
        claims.executionResources === suppliedProblem.executionResources &&
        claims.successCriterion === suppliedProblem.successCriterion &&
        JSON.stringify(claims.sourceUrls) === JSON.stringify(suppliedProblem.sources.map((source) => source.url)) &&
        JSON.stringify(claims.sourceEvidence) === JSON.stringify(suppliedProblem.sources.map((source) => ({ url: source.url, passage: source.passage || "" })));
      if (validClaim) problem = suppliedProblem;
    }
    if (!problem) {
      return NextResponse.json({ error: "This problem brief is invalid or expired. Run the search again." }, { status: 400 });
    }

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
    const userEmail = isSelfHostedMode() ? process.env.DEEPRESEARCH_ALERT_EMAIL : await readUserEmail();
    const hostedAlertEmail = userEmail ? {
      email: userEmail,
      custom_url: `${siteUrl}/research/{id}`,
    } : undefined;
    const reportPath = (taskId: string) => {
      const access = issueReportAccessToken(taskId);
      return `/research/${taskId}${access ? `?access=${encodeURIComponent(access)}` : ""}`;
    };

    if (isSelfHostedMode()) {
      const apiKey = process.env.VALYU_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "VALYU_API_KEY is not configured." }, { status: 503 });
      const limit = checkRateLimit(request, "deepresearch", 3, 60 * 60 * 1000);
      if (!limit.allowed) {
        return NextResponse.json({ error: "Research launch limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
      }
      const task = await withDeadline(new Valyu(apiKey).deepresearch.create({
        query: buildQuery(problem),
        mode: "fast",
        outputFormats: ["markdown", "pdf"],
        alertEmail: userEmail,
        metadata: { source: "arc-agi-n", problem_id: problem.id, problem_title: problem.title },
      }), 30_000, "DeepResearch launch timed out");
      if (!task.success || !task.deepresearch_id) throw new Error(task.error || "Could not start research");
      return NextResponse.json({
        taskId: task.deepresearch_id,
        status: task.status || "queued",
        notified: false,
        reportPath: reportPath(task.deepresearch_id),
      });
    }

    const accessToken = await getValyuAccessToken();
    if (!accessToken) return NextResponse.json({ error: "Sign in to build a DeepResearch plan." }, { status: 401 });
    const limit = checkRateLimit(request, "deepresearch", 10, 60 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Research launch limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    }
    const task = await withDeadline(createViaOAuth(problem, accessToken, hostedAlertEmail), 30_000, "DeepResearch launch timed out");
    if (!task.deepresearch_id) throw new Error(task.error || "Could not start research");
    return NextResponse.json({
      taskId: task.deepresearch_id,
      status: task.status || "queued",
      notified: Boolean(hostedAlertEmail),
      reportPath: reportPath(task.deepresearch_id),
    });
  } catch (error) {
    const sessionExpired = error instanceof Error && error.message.includes("Sign in");
    const message = error instanceof Error && (error.message.includes("credits") || error.message.includes("timed out") || sessionExpired)
      ? error.message
      : "Could not start the DeepResearch plan.";
    return NextResponse.json({ error: message }, { status: sessionExpired ? 401 : 500 });
  }
}
