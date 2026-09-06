import { clientSearchFailure } from "@/lib/search-diagnostics";
import { checkRateLimit } from "@/lib/rate-limit";
import { validatePaidRequest } from "@/lib/request-security";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_ANALYTICS_ENABLED !== "true") return new Response(null, { status: 204 });
  const invalidRequest = validatePaidRequest(request);
  if (invalidRequest) return invalidRequest;
  const limit = checkRateLimit(request, "search-diagnostics", 20, 10 * 60 * 1000);
  if (!limit.allowed) return new Response(null, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  if (!request.body || Number(request.headers.get("content-length") || 0) > 2_048) return new Response(null, { status: 413 });
  const reader = request.body.getReader();
  try {
    const decoder = new TextDecoder();
    let raw = "";
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_048) return new Response(null, { status: 413 });
      raw += decoder.decode(value, { stream: true });
    }
    const failure = clientSearchFailure(JSON.parse(raw + decoder.decode()));
    if (!failure) return new Response(null, { status: 400 });
    // Client reports are untrusted observations, not proof of a server failure.
    console.warn("[search] client_failure", failure);
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
