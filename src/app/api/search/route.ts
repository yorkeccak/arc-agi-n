import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { validatePaidRequest } from "@/lib/request-security";
import { runDiscovery } from "@/lib/search-discovery";
import type { Field } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const validFields = new Set<Field>(["Mathematics", "Physics", "Computer science", "Biology", "Chemistry"]);

export async function POST(request: Request) {
  const invalidRequest = validatePaidRequest(request);
  if (invalidRequest) return invalidRequest;
  if (Number(request.headers.get("content-length") || 0) > 12_000) {
    return NextResponse.json({ error: "Search request is too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 12_000) return NextResponse.json({ error: "Search request is too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid search request." }, { status: 400 });
  const { query, field } = body as Record<string, unknown>;
  if (typeof query !== "string" || query.trim().length < 2 || query.length > 500) {
    return NextResponse.json({ error: "Enter a search between 2 and 500 characters." }, { status: 400 });
  }
  if (field !== undefined && (typeof field !== "string" || !validFields.has(field as Field))) {
    return NextResponse.json({ error: "Choose a valid research field." }, { status: 400 });
  }
  const apiKey = process.env.VALYU_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !openaiKey) return NextResponse.json({ error: "Live search is temporarily unavailable." }, { status: 503 });
  const limit = checkRateLimit(request, "search", 20, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many searches. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const upstream = new AbortController();
  const signal = AbortSignal.any([request.signal, upstream.signal, AbortSignal.timeout(165_000)]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        if (!closed && !request.signal.aborted && !upstream.signal.aborted) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      };
      try {
        send({ type: "status", message: "Looking for open problems in papers and on the web…" });
        const count = await runDiscovery({
          query: query.trim(), field: field as Field | undefined, apiKey, openaiKey, signal,
          onStatus: (message) => send({ type: "status", message }),
          onSource: (lead) => send({ type: "source", lead }),
          onProblem: (problem) => send({ type: "problem", problem }),
        });
        send({ type: "done", message: count ? `Found ${count} open questions to explore.` : "No matching open questions found. Try a related field or a more specific question." });
      } catch {
        if (!request.signal.aborted && !upstream.signal.aborted) {
          console.error("[search] Discovery failed", { timedOut: signal.aborted });
          send({ type: "error", message: "Search could not finish. Please try again." });
        }
      } finally {
        upstream.abort();
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      upstream.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
