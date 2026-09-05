import { NextResponse } from "next/server";
import { Valyu, type AnswerResponse, type AnswerStreamChunk } from "valyu-js";
import { isSelfHostedMode } from "@/lib/app-mode";
import { checkRateLimit } from "@/lib/rate-limit";
import { validatePaidRequest } from "@/lib/request-security";
import { withDeadline } from "@/lib/network";
import { issueResearchToken } from "@/lib/research-token";
import { getValyuAccessToken } from "@/lib/valyu-session";
import type { DiscoveredProblem, Field } from "@/lib/types";

export const dynamic = "force-dynamic";

interface SourceResult {
  title: string;
  url: string;
  content?: string | object | unknown[];
  description?: string;
  abstract?: string;
  source?: string;
  source_type?: string;
  relevance_score?: number;
  publication_date?: string;
  date?: string;
  doi?: string;
}

interface ObservedSource {
  title: string;
  url: string;
  content: string;
  sourceType?: string;
  publishedAt?: string;
  doi?: string;
}

const problemSchema = {
  type: "object",
  properties: {
    problems: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          question: { type: "string" },
          whyOpen: { type: "string" },
          firstStep: { type: "string" },
          field: { type: "string", enum: ["Mathematics", "Physics", "Computer science", "Biology", "Chemistry"] },
          subfield: { type: "string" },
          sourceEvidence: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                url: { type: "string" },
                passage: { type: "string" },
              },
              required: ["url", "passage"],
            },
          },
          agentReadiness: { type: "string", enum: ["agent-ready", "hybrid", "physical-world"] },
          executionResources: { type: "string" },
          successCriterion: { type: "string" },
        },
        required: ["title", "question", "whyOpen", "firstStep", "field", "subfield", "sourceEvidence", "agentReadiness", "executionResources", "successCriterion"],
      },
    },
  },
  required: ["problems"],
};

const validFields = new Set<Field>(["Mathematics", "Physics", "Computer science", "Biology", "Chemistry"]);

const cleanText = (value: SourceResult["content"] | string | undefined) => {
  const raw = typeof value === "string" ? value : JSON.stringify(value || "");
  return raw.replace(/\s+/g, " ").replace(/[#*_`]/g, "").trim().slice(0, 320);
};

const cleanEvidenceContent = (value: SourceResult["content"] | string | undefined) => {
  const raw = typeof value === "string" ? value : JSON.stringify(value || "");
  return raw.replace(/\s+/g, " ").trim().slice(0, 48_000);
};

const sourceLabel = (source: string | undefined, url: string) => {
  const value = (source || new URL(url).hostname).replace(/^valyu\//, "").replace(/^valyu-/, "");
  if (/pubmed|arxiv|paper/i.test(value)) return "Academic paper";
  return value.replace(/^www\./, "");
};

const weakSourceDomains = [
  "quora.com",
  "reddit.com",
  "wikipedia.org",
  "grokipedia.com",
  "medium.com",
  "researchgate.net",
  "academia.edu",
  "theguardian.com",
];

const canonicalUrl = (value: string) => {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
};

const isWeakSource = (url: string) => {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return weakSourceDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return true;
  }
};

const authoritativeDomainPatterns = [
  /(^|\.)arxiv\.org$/,
  /(^|\.)doi\.org$/,
  /(^|\.)nature\.com$/,
  /(^|\.)science\.org$/,
  /(^|\.)sciencedirect\.com$/,
  /(^|\.)springer\.com$/,
  /(^|\.)wiley\.com$/,
  /(^|\.)pnas\.org$/,
  /(^|\.)ncbi\.nlm\.nih\.gov$/,
  /(^|\.)pubmed\.ncbi\.nlm\.nih\.gov$/,
  /(^|\.)agupubs\.onlinelibrary\.wiley\.com$/,
  /(^|\.)ametsoc\.org$/,
  /(^|\.)copernicus\.org$/,
  /(^|\.)royalsocietypublishing\.org$/,
  /(^|\.)oup\.com$/,
  /(^|\.)tandfonline\.com$/,
  /(^|\.)claymath\.org$/,
  /(^|\.)aps\.org$/,
  /(^|\.)aip\.org$/,
  /(^|\.)iop\.org$/,
  /(^|\.)ieee\.org$/,
  /(^|\.)acm\.org$/,
  /(^|\.)cern\.ch$/,
  /(^|\.)esa\.int$/,
  /(^|\.)who\.int$/,
  /\.ac\.uk$/,
  /\.gov$/,
  /\.edu$/,
];

const isAuthoritativeSource = (result: SourceResult) => {
  try {
    const hostname = new URL(result.url).hostname.replace(/^www\./, "").toLowerCase();
    const source = `${result.source || ""} ${result.source_type || ""}`;
    return /paper|journal|academic|arxiv|pubmed|biorxiv|medrxiv/i.test(source) ||
      authoritativeDomainPatterns.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
};

const weakEvidencePaths = /\/(?:news|events?|talks?|courses?|people|profiles?|press|blog|topics)(?:\/|$)|\/(?:~|users?\/)[^/]+/i;

const isEvidenceSource = (result: SourceResult) => {
  if (!isAuthoritativeSource(result) || isWeakSource(result.url)) return false;
  try {
    const url = new URL(result.url);
    if (weakEvidencePaths.test(url.pathname)) return false;
    const source = `${result.source || ""} ${result.source_type || ""}`;
    const publisherHost = authoritativeDomainPatterns.slice(0, -3).some((pattern) => pattern.test(url.hostname));
    return /paper|journal|academic|arxiv|pubmed|biorxiv|medrxiv|review/i.test(source) || publisherHost || /\.pdf$/i.test(url.pathname);
  } catch {
    return false;
  }
};

const asLeads = (results: SourceResult[]) => results
  .filter((result) => result.url && result.title && !isWeakSource(result.url) && isAuthoritativeSource(result))
  .slice(0, 8)
  .map((result) => ({
    title: result.title,
    url: result.url,
    snippet: cleanText(result.description || result.abstract || result.content),
    source: sourceLabel(result.source, result.url),
    relevance: result.relevance_score ?? 0,
    authoritative: isAuthoritativeSource(result),
    publishedAt: result.publication_date || result.date,
    sourceType: result.source_type,
    doi: result.doi,
  }));

const groundWithSources = (query: string, sources: Iterable<ObservedSource>) => {
  const records = [...sources].slice(0, 14);
  if (records.length === 0) return query;
  return `${query}

Authoritative sources already retrieved for this request:
${records.map((source, index) => `${index + 1}. ${source.title}\nURL: ${source.url}\nRetrieved passage: ${source.content.slice(0, 700)}`).join("\n\n")}

Use only exact URLs from this list or exact URLs returned by your own retrieval. Every sourceEvidence passage must be a short verbatim excerpt from its URL that explicitly describes the unresolved question, knowledge gap or failure mode. Do not rewrite, shorten or invent URLs or passages.`;
};

const normalizeEvidenceText = (value: string) => value
  .normalize("NFKD")
  .toLowerCase()
  .replace(/[‐‑‒–—−]/g, "-")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const passageAppearsInSource = (passage: string, source: string) => {
  const normalizedPassage = normalizeEvidenceText(passage);
  const normalizedSource = normalizeEvidenceText(source);
  if (normalizedPassage.length < 35 || normalizedSource.length < 35) return false;
  if (normalizedSource.includes(normalizedPassage)) return true;
  const words = normalizedPassage.split(" ");
  if (words.length < 8) return false;
  const windows = Array.from({ length: Math.max(1, words.length - 7) }, (_, index) => words.slice(index, index + 8).join(" "));
  return windows.some((window) => normalizedSource.includes(window));
};

const passageStatesResearchGap = (passage: string) => /\b(?:open (?:problem|question|issue)|remain(?:s|ed)? (?:open|unknown|unclear|unresolved|uncertain|poorly constrained)|unresolved|unknown whether|not (?:yet |fully )?(?:known|understood|resolved|established|explained)|still (?:unknown|unclear|debated|uncertain)|future work|further research|major challenge|key challenge|challenge remains|important uncertainty|dominant uncertainty|lack of|missing)\b/i.test(passage);

const sourceFramesResearchGap = (source: ObservedSource) => {
  if (passageStatesResearchGap(source.title)) return true;
  try {
    return /\bopen[-_]?(?:problems?|questions?|issues?)\b/i.test(new URL(source.url).pathname);
  } catch {
    return false;
  }
};

const corpusContradictsOpenStatus = (candidate: DiscoveredProblem, sources: Iterable<ObservedSource>) => {
  const titleTerms = normalizeEvidenceText(candidate.title)
    .split(" ")
    .filter((term) => term.length > 3 && !["conjecture", "problem", "question", "identity", "theory"].includes(term));
  if (titleTerms.length === 0) return false;
  return [...sources].some((source) => {
    const title = normalizeEvidenceText(source.title);
    const discussesCandidate = titleTerms.slice(0, 4).every((term) => title.includes(term));
    if (!discussesCandidate) return false;
    return /\b(?:a |the )?(?:proof|solution) (?:of|to)\b|\b(?:is|was|has been|recently) (?:proved|solved|resolved|settled)\b|\bwe (?:prove|solve|resolve|settle)\b/i.test(`${source.title} ${source.content.slice(0, 1200)}`);
  });
};

const isFormalQuestion = (candidate: DiscoveredProblem) => candidate.field === "Mathematics" || /\b(?:conjecture|theorem|proof|prove|smoothness|regularity|complexity class)\b/i.test(`${candidate.title} ${candidate.question} ${candidate.subfield}`);

const hasCredibleSuccessCriterion = (candidate: DiscoveredProblem) => {
  const formalQuestion = isFormalQuestion(candidate);
  if (!formalQuestion) return true;
  const proposedWork = `${candidate.firstStep} ${candidate.successCriterion}`;
  const exploratoryComputation = /\b(?:simulation|monte[ -]?carlo|random(?:ly)? (?:sample|generate)|heuristic|tested range)\b/i.test(proposedWork);
  const proofProducingComputation = /\b(?:formally verified|proof-producing|certified exhaustive|exact certificate|construct(?:ed)? (?:an? )?explicit counterexample|computer-assisted proof)\b/i.test(proposedWork);
  if (exploratoryComputation && !proofProducingComputation) return false;
  if (/\b(?:supports?|suggests?|empirical evidence|constructive evidence|confirming the property for the tested range)\b/i.test(candidate.successCriterion)) return false;
  if (/\b(?:no (?:singularity|counterexample|failure) (?:was )?(?:found|observed)|simulation completes without|appears bounded|empirical support)\b/i.test(candidate.successCriterion)) return false;
  return /\b(?:proof|counterexample|improved? bound|lower bound|upper bound|formal(?:ly)? verified|certificate|certified exhaustive|new infinite family|reduction)\b/i.test(candidate.successCriterion);
};

const removeUnsupportedNumericCriterion = (candidate: DiscoveredProblem) => {
  const criterionNumbers = candidate.successCriterion.match(/\b\d+(?:\.\d+)?\s*%?/g) || [];
  if (criterionNumbers.length === 0) return candidate.successCriterion;
  const evidence = `${candidate.question} ${candidate.sourceEvidence.map((item) => item.passage).join(" ")}`;
  const unsupported = criterionNumbers.some((number) => !evidence.includes(number));
  if (!unsupported) return candidate.successCriterion;
  if (isFormalQuestion(candidate)) {
    if (/\bbound\b/i.test(`${candidate.question} ${candidate.successCriterion}`)) {
      return "A rigorously proved and independently checkable bound that strictly improves the best bound stated in the cited literature.";
    }
    if (/\bcounterexample\b/i.test(candidate.successCriterion)) {
      return "A formally checkable counterexample that directly resolves the cited claim.";
    }
    return "A complete, independently checkable proof, counterexample or reduction that directly advances the cited open question.";
  }
  return "A reproducible result that narrows the cited uncertainty, reports uncertainty across relevant baselines, and survives an independent implementation check.";
};

const parseProblems = (contents: unknown): DiscoveredProblem[] => {
  try {
    const parsed = typeof contents === "string"
      ? JSON.parse(contents.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))
      : contents;
    if (!parsed || typeof parsed !== "object" || !("problems" in parsed) || !Array.isArray(parsed.problems)) return [];
    return parsed.problems.slice(0, 6).flatMap((problem: unknown) => {
      if (!problem || typeof problem !== "object") return [];
      const candidate = problem as Record<string, unknown>;
      if (!["title", "question", "whyOpen", "firstStep", "field", "subfield", "executionResources", "successCriterion"].every((key) => typeof candidate[key] === "string")) return [];
      if (!validFields.has(candidate.field as Field)) return [];
      if (!["agent-ready", "hybrid", "physical-world"].includes(String(candidate.agentReadiness))) return [];
      const sourceEvidence = Array.isArray(candidate.sourceEvidence)
        ? candidate.sourceEvidence.flatMap((item): Array<{ url: string; passage: string }> => {
          if (!item || typeof item !== "object") return [];
          const evidence = item as Record<string, unknown>;
          if (typeof evidence.url !== "string" || typeof evidence.passage !== "string" || !/^https?:\/\//.test(evidence.url)) return [];
          return [{ url: evidence.url, passage: evidence.passage.slice(0, 360) }];
        }).slice(0, 4)
        : [];
      if (sourceEvidence.length === 0) return [];
      return [{
        title: (candidate.title as string).slice(0, 160),
        question: (candidate.question as string).slice(0, 600),
        whyOpen: (candidate.whyOpen as string).slice(0, 700),
        firstStep: (candidate.firstStep as string).slice(0, 700),
        field: candidate.field as Field,
        subfield: (candidate.subfield as string).slice(0, 100),
        sourceUrls: sourceEvidence.map((evidence) => evidence.url),
        sourceEvidence,
        agentReadiness: candidate.agentReadiness as DiscoveredProblem["agentReadiness"],
        executionResources: (candidate.executionResources as string).slice(0, 500),
        successCriterion: (candidate.successCriterion as string).slice(0, 500),
      }];
    });
  } catch {
    return [];
  }
};

const validateProblems = (
  candidates: DiscoveredProblem[],
  observedSources: Map<string, ObservedSource>,
  requestedField?: Field,
) => {
  return candidates.flatMap((candidate) => {
    if (requestedField && candidate.field !== requestedField) return [];
    if (candidate.agentReadiness === "physical-world") return [];
    const successCriterion = removeUnsupportedNumericCriterion(candidate);
    const normalizedCandidate = { ...candidate, successCriterion };
    if (!hasCredibleSuccessCriterion(normalizedCandidate)) return [];
    if (corpusContradictsOpenStatus(candidate, observedSources.values())) return [];
    const publicationKeys = new Set<string>();
    const sourceEvidence = candidate.sourceEvidence.flatMap((evidence) => {
      const observed = observedSources.get(canonicalUrl(evidence.url));
      if (!observed || isWeakSource(observed.url)) return [];
      if ((!passageStatesResearchGap(evidence.passage) && !sourceFramesResearchGap(observed)) || !passageAppearsInSource(evidence.passage, observed.content)) return [];
      const publicationKey = observed.doi?.toLowerCase() || canonicalUrl(observed.url);
      if (publicationKeys.has(publicationKey)) return [];
      publicationKeys.add(publicationKey);
      return [{ url: observed.url, passage: evidence.passage.trim() }];
    }).slice(0, 4);
    if (sourceEvidence.length === 0) return [];
    const sourceUrls = sourceEvidence.map((evidence) => evidence.url);
    const problem: DiscoveredProblem = {
      ...normalizedCandidate,
      sourceUrls,
      sourceEvidence,
      evidenceStrength: sourceEvidence.length >= 2 ? "strong" : "provisional",
      evidenceNote: sourceEvidence.length >= 2
        ? `${sourceEvidence.length} independent retrieved passages describe this research gap. Recheck its current status before investing heavily.`
        : "One retrieved passage describes this research gap. Recheck its current status before investing heavily.",
    };
    return [{ ...problem, researchToken: issueResearchToken(problem) }];
  });
};

async function answerViaOAuth(query: string, accessToken: string, systemInstructions: string, requestSignal: AbortSignal, searchType: "all" | "proprietary" = "all") {
  const proxyUrl = `${process.env.VALYU_APP_URL || "https://platform.valyu.ai"}/api/oauth/proxy`;
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "/v1/answer",
      method: "POST",
      body: {
        query,
        search_type: searchType,
        structured_output: problemSchema,
        fast_mode: true,
        system_instructions: systemInstructions,
      },
    }),
    signal: AbortSignal.any([requestSignal, AbortSignal.timeout(80_000)]),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Session expired. Sign in again.");
    throw new Error(response.status === 402 ? "Insufficient Valyu credits" : "Valyu search unavailable");
  }
  return response.json();
}

async function searchViaOAuth(query: string, accessToken: string, requestSignal: AbortSignal, searchType: "all" | "proprietary" = "all") {
  const response = await fetch(`${process.env.VALYU_APP_URL || "https://platform.valyu.ai"}/api/oauth/proxy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "/v1/search",
      method: "POST",
      body: {
        query,
        search_type: searchType,
        max_num_results: 12,
        relevance_threshold: 0.35,
        response_length: "short",
        fast_mode: searchType !== "proprietary",
        exclude_sources: weakSourceDomains,
      },
    }),
    signal: AbortSignal.any([requestSignal, AbortSignal.timeout(25_000)]),
  });
  if (!response.ok) return [];
  const data = await response.json() as { results?: SourceResult[] };
  return data.results || [];
}

async function* answerViaApiKey(
  query: string,
  apiKey: string,
  systemInstructions: string,
  requestSignal: AbortSignal,
): AsyncGenerator<AnswerStreamChunk> {
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(70_000)]);
  const response = await fetch(`${process.env.VALYU_API_URL || "https://api.valyu.ai/v1"}/answer`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      query,
      search_type: "all",
      structured_output: problemSchema,
      system_instructions: systemInstructions,
      fast_mode: true,
    }),
    signal,
  });
  if (!response.ok) throw new Error(response.status === 402 ? "Insufficient Valyu credits" : "Valyu search unavailable");
  if (!response.body) throw new Error("Valyu did not return a search stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const value = line.slice(6);
        if (value === "[DONE]") {
          yield { type: "done" } satisfies AnswerStreamChunk;
          continue;
        }
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(value) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (Array.isArray(data.search_results) && data.success === undefined) {
          yield { type: "search_results", search_results: data.search_results } as AnswerStreamChunk;
        } else if (Array.isArray(data.choices)) {
          const choice = data.choices[0] as { delta?: { content?: string }; finish_reason?: string } | undefined;
          yield { type: "content", content: choice?.delta?.content || "", finish_reason: choice?.finish_reason };
        } else if (data.success !== undefined) {
          yield {
            type: "metadata",
            contents: data.contents as AnswerStreamChunk["contents"],
            search_results: data.search_results as AnswerStreamChunk["search_results"],
          };
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function POST(request: Request) {
  const invalidRequest = validatePaidRequest(request);
  if (invalidRequest) return invalidRequest;
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 12_000) return NextResponse.json({ error: "Search request is too large." }, { status: 413 });
    const rawBody = await request.text();
    if (rawBody.length > 12_000) return NextResponse.json({ error: "Search request is too large." }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
    }
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid search request." }, { status: 400 });
    const { query, field: rawField } = body as Record<string, unknown>;
    if (typeof query !== "string" || query.trim().length < 2 || query.length > 500) {
      return NextResponse.json({ error: "Enter a search between 2 and 500 characters." }, { status: 400 });
    }
    if (rawField !== undefined && (typeof rawField !== "string" || !validFields.has(rawField as Field))) {
      return NextResponse.json({ error: "Choose a valid research field." }, { status: 400 });
    }
    const field = rawField as Field | undefined;

    const normalizedQuery = query.trim()
      .replace(/^pen\s+problems?\b/i, "open problems")
      .replace(/\b(?:porblems|probelms|probkems)\b/gi, "problems");
    const researchQuery = `Find up to 4 concrete, currently unsolved research questions related to: ${normalizedQuery}${field ? ` in ${field}` : ""}. Prioritize 2023-2026 paper conclusions, review future-directions sections and maintained authoritative problem lists containing the exact phrases open problem, open question, remains unresolved, unknown or future work. Each question must be narrow and falsifiable, not a topic heading. For every candidate, quote a short verbatim source passage that explicitly says the question, uncertainty or blocking gap remains open, and return its exact URL. Classify agentReadiness as agent-ready, hybrid or physical-world. Prefer agent-ready questions with named public datasets, codebases, formal libraries or bounded compute. The firstStep must be executable within 72 hours and the successCriterion must say exactly what result would count as progress or falsify the route. For a formal mathematics question, require a rigorous sub-lemma, proof-producing computation, exact certificate, explicit counterexample or provably improved bound; random trials and numerical evidence never establish a theorem. Check basic parameter feasibility before proposing a computation. Omit physical-world candidates unless the request explicitly asks for experimental work. Return fewer candidates when evidence is weak. Exclude solved questions, invented thresholds, policy advocacy, generic deployment goals and projects dependent mainly on political adoption. Reject a candidate if any retrieved source announces its proof, solution or resolution.`;
    const evidenceQuery = `${normalizedQuery}${field ? ` in ${field}` : ""}. Find recent primary papers and scholarly reviews, preferably from 2023-2026, whose text explicitly says a concrete question is an open problem, open question, remains unresolved, remains unknown, or is future work. Exclude papers announcing proofs or solutions.`;
    const systemInstructions = `Act as a skeptical scientific research editor. Return narrow, falsifiable, currently open questions${field ? ` in ${field}` : ""}, never topic labels. Omit any candidate unless a retrieved primary, peer-reviewed or institutional source contains a verbatim passage explicitly describing the unresolved question, uncertainty or failure mode. Put that exact excerpt and exact URL in sourceEvidence; never invent or paraphrase evidence. Prefer recent reviews plus primary work and independent publications. Never use social posts, Wikipedia, news, personal notes, event pages, course pages or aggregators as open-status evidence. Prefer tractable frontier edges over famous monuments. Do not return a Clay problem, a grand unification problem, dark-matter identity or another field-defining monument unless the request names it directly. Prefer agent-ready work using named public data, code, formal tools or bounded compute. executionResources must name what is available. firstStep must fit 72 hours. successCriterion must be measurable and falsifiable. For formal mathematics, firstStep must target a rigorous sub-lemma, proof-producing computation, exact certificate, explicit counterexample or provably improved bound. Never claim that Monte Carlo, random sampling, a tested range or failure to find a counterexample proves or materially supports a universal theorem. Validate elementary parameter feasibility before proposing a computation. Mark work needing both computation and later experiments as hybrid. Mark work that cannot progress without a lab, field campaign or proprietary facility as physical-world. Exclude physical-world candidates unless explicitly requested. Never invent a benchmark, threshold, dataset or open status. Return fewer candidates rather than weak ones.`;
    const selfHosted = isSelfHostedMode();
    const apiKey = selfHosted ? process.env.VALYU_API_KEY : undefined;
    const accessToken = selfHosted ? undefined : await getValyuAccessToken();
    if (selfHosted && !apiKey) return NextResponse.json({ error: "VALYU_API_KEY is not configured." }, { status: 503 });
    if (!selfHosted && !accessToken) return NextResponse.json({ error: "Sign in to run live search." }, { status: 401 });
    const limit = checkRateLimit(request, "search", selfHosted ? 20 : 40, 10 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many searches. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    }

    const encoder = new TextEncoder();
    const upstreamController = new AbortController();
    const searchSignal = AbortSignal.any([request.signal, upstreamController.signal]);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const seenSources = new Set<string>();
        const authoritativeSources = new Map<string, ObservedSource>();
        let closed = false;
        const send = (event: object) => {
          if (closed || searchSignal.aborted) return false;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            return true;
          } catch {
            closed = true;
            return false;
          }
        };
        const emitSources = async (results: SourceResult[]) => {
          results.filter(isEvidenceSource).forEach((result) => {
            const key = canonicalUrl(result.url);
            const content = cleanEvidenceContent(result.content || result.abstract || result.description);
            const existing = authoritativeSources.get(key);
            if (!existing || content.length > existing.content.length) {
              authoritativeSources.set(key, {
                title: result.title,
                url: result.url,
                content,
                sourceType: result.source_type,
                publishedAt: result.publication_date || result.date,
                doi: result.doi,
              });
            }
          });
          for (const lead of asLeads(results)) {
            if (seenSources.size >= 16) break;
            if (seenSources.has(lead.url)) continue;
            seenSources.add(lead.url);
            if (!send({ type: "source", lead })) return;
            await wait(55);
          }
        };

        try {
          send({ type: "status", message: "Opening research and web indexes" });
          let problems: DiscoveredProblem[] = [];

          if (selfHosted) {
            const client = new Valyu(apiKey!);
            const searchEvidence = (searchType: "all" | "proprietary", fastMode: boolean) => withDeadline(client.search(evidenceQuery, {
              searchType,
              maxNumResults: 12,
              relevanceThreshold: 0.35,
              responseLength: "short",
              fastMode,
              excludeSources: weakSourceDomains,
              instructions: "Prioritize sources that explicitly name an unresolved question. Prefer primary papers, scholarly reviews, official research institutes and authoritative open-problem lists.",
            }), 25_000, "Search evidence timed out").then(async (evidence) => {
              if (evidence.success) await emitSources(evidence.results);
            });
            await Promise.allSettled([
              searchEvidence("all", true),
              searchEvidence("proprietary", false),
            ]);
            searchSignal.throwIfAborted();
            if (seenSources.size > 0) send({ type: "status", message: `Reading ${seenSources.size} authoritative sources` });

            const answer = answerViaApiKey(
              groundWithSources(researchQuery, authoritativeSources.values()),
              apiKey!,
              systemInstructions,
              searchSignal,
            );

            let streamedContent = "";
            let synthesisStarted = false;
            const iterator = answer[Symbol.asyncIterator]();
            while (true) {
              const next = await iterator.next();
              if (next.done) break;
              const chunk = next.value;
              if (searchSignal.aborted) break;
              if (chunk.type === "search_results" && chunk.search_results) {
                await emitSources(chunk.search_results);
                send({ type: "status", message: `Reading ${seenSources.size} promising sources` });
              }
              if (chunk.type === "content" && chunk.content) {
                streamedContent += chunk.content;
                if (!synthesisStarted) {
                  synthesisStarted = true;
                  send({ type: "status", message: "Synthesizing exact open questions" });
                }
              }
              if (chunk.type === "metadata") {
                if (chunk.search_results) await emitSources(chunk.search_results);
                problems = parseProblems(chunk.contents || streamedContent);
              }
              if (chunk.type === "error") throw new Error(chunk.error || "Search failed");
            }
            if (problems.length === 0) problems = parseProblems(streamedContent);
          } else {
            const [paperSources, allSources] = await Promise.all([
              searchViaOAuth(evidenceQuery, accessToken!, searchSignal, "proprietary"),
              searchViaOAuth(evidenceQuery, accessToken!, searchSignal, "all"),
            ]);
            await emitSources([...paperSources, ...allSources]);
            searchSignal.throwIfAborted();
            if (seenSources.size > 0) send({ type: "status", message: `Reading ${seenSources.size} authoritative sources` });
            const result = await answerViaOAuth(groundWithSources(researchQuery, authoritativeSources.values()), accessToken!, systemInstructions, searchSignal) as AnswerResponse;
            if (result.success === false) throw new Error(result.error || "Search failed");
            await emitSources(result.search_results || []);
            send({ type: "status", message: "Synthesizing exact open questions" });
            problems = parseProblems(result.contents);
          }

          send({
            type: "status",
            message: problems.length > 0
              ? `Checking ${problems.length} ${problems.length === 1 ? "candidate" : "candidates"} against the source text`
              : "No exact questions were returned; keeping the relevant atlas matches",
          });
          const validatedProblems = validateProblems(problems, authoritativeSources, field);
          for (const problem of validatedProblems) {
            if (!send({ type: "problem", problem })) break;
            await wait(90);
          }
          send({
            type: "done",
            message: validatedProblems.length > 0
              ? `${validatedProblems.length} ${validatedProblems.length === 1 ? "question cleared" : "questions cleared"} the source check`
              : problems.length > 0
                ? `${problems.length} ${problems.length === 1 ? "candidate did" : "candidates did"} not clear the source check`
                : "No exact question was returned from the live synthesis",
          });
        } catch (error) {
          if (searchSignal.aborted) return;
          if (process.env.NODE_ENV !== "production") {
            console.error("[search]", error instanceof Error ? `${error.name}: ${error.message}` : "Unknown search failure");
          }
          const message = error instanceof Error && (error.message.includes("credits") || error.message.includes("Sign in") || error.message.includes("timed out"))
            ? error.message
            : "Live research search failed. Try again.";
          send({ type: "error", message });
        } finally {
          if (!closed && !upstreamController.signal.aborted) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        upstreamController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("credits") ? error.message : "Live research search failed. Try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
