export const searchFailureReasons = [
  "rate_limit", "http_error", "missing_body", "invalid_stream", "server_error",
  "incomplete_stream", "network_error", "timeout", "invalid_output", "unknown",
] as const;

export type SearchFailureReason = typeof searchFailureReasons[number];

export function searchRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
}

export function searchFailureDetails(error: unknown): { reason: SearchFailureReason; http_status?: number } {
  let value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  for (let depth = 0; depth < 3 && value.name === "AI_RetryError"; depth++) {
    if (!value.lastError || typeof value.lastError !== "object") break;
    value = value.lastError as Record<string, unknown>;
  }
  const status = value.statusCode;
  const http_status = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  let reason: SearchFailureReason = "unknown";
  if (http_status === 429) reason = "rate_limit";
  else if (http_status && http_status >= 400) reason = "http_error";
  else if (value.name === "TimeoutError") reason = "timeout";
  else if (["ZodError", "SyntaxError", "AI_NoObjectGeneratedError", "AI_TypeValidationError", "AI_JSONParseError"].includes(String(value.name))) reason = "invalid_output";
  else if (value.name === "TypeError") reason = "network_error";
  return { reason, ...(http_status ? { http_status } : {}) };
}

export interface ClientSearchFailure {
  reason: SearchFailureReason;
  request_id?: string;
  http_status: number;
  duration_ms: number;
  source_count: number;
  problem_count: number;
  online: boolean;
}

export function clientSearchFailure(value: unknown): ClientSearchFailure | undefined {
  if (!value || typeof value !== "object") return;
  const input = value as Record<string, unknown>;
  if (!searchFailureReasons.includes(input.reason as SearchFailureReason) || typeof input.online !== "boolean") return;
  const bounded = (key: string, max: number) => typeof input[key] === "number" && Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= max;
  if (!bounded("http_status", 599) || !bounded("duration_ms", 3_600_000) || !bounded("source_count", 100) || !bounded("problem_count", 100)) return;
  if (input.request_id !== undefined && !searchRequestId(input.request_id)) return;
  return {
    reason: input.reason as SearchFailureReason,
    ...(input.request_id ? { request_id: input.request_id as string } : {}),
    http_status: input.http_status as number,
    duration_ms: input.duration_ms as number,
    source_count: input.source_count as number,
    problem_count: input.problem_count as number,
    online: input.online,
  };
}
