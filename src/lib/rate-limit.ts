import { isIP } from "node:net";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const entries = new Map<string, RateLimitEntry>();
let checksSincePrune = 0;

const clientIdentity = (request: Request) => {
  // Outside Vercel, enable this only when the edge overwrites X-Real-IP.
  if (process.env.VERCEL === "1" || process.env.TRUST_PROXY_HEADERS === "true") {
    const address = request.headers.get("x-real-ip")?.trim();
    if (address && isIP(address)) return `network:${address}`;
  }
  return "client:untrusted-network";
};

const pruneEntries = (now: number) => {
  checksSincePrune += 1;
  if (checksSincePrune < 128 && entries.size < 5_000) return;
  checksSincePrune = 0;
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) entries.delete(key);
  }
  while (entries.size >= 5_000) {
    const oldest = entries.keys().next().value;
    if (!oldest) break;
    entries.delete(oldest);
  }
};

export function checkRateLimit(request: Request, scope: string, limit: number, windowMs: number) {
  const now = Date.now();
  pruneEntries(now);
  const client = clientIdentity(request);
  const key = `${scope}:${client}`;
  const current = entries.get(key);

  if (!current || current.resetAt <= now) {
    entries.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  if (current.count >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}
