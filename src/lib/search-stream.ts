import type { DiscoveredProblem, SearchLead } from "@/lib/types";
import type { SearchFailureReason } from "@/lib/search-diagnostics";

type SearchStreamEvent =
  | { type: "status"; message: string }
  | { type: "source"; lead: SearchLead }
  | { type: "problem"; problem: DiscoveredProblem }
  | { type: "done"; message?: string };

export class SearchResponseError extends Error {
  constructor(message: string, public readonly reason: SearchFailureReason = "unknown") {
    super(message);
  }
}

const unavailableMessage = "Search is temporarily unavailable. Please try again shortly.";

export async function readSearchResponse(response: Response, onEvent: (event: SearchStreamEvent) => void) {
  if (!response.ok) {
    if (response.status === 429) {
      throw new SearchResponseError("Too many searches right now. Please wait a moment before trying again.", "rate_limit");
    }
    if (response.status >= 500) throw new SearchResponseError(unavailableMessage, "http_error");
    throw new SearchResponseError("Search could not start. Please refresh the page and try again.", "http_error");
  }
  if (!response.body) throw new SearchResponseError(unavailableMessage, "missing_body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: SearchStreamEvent | { type: "error"; message?: string };
        try {
          event = JSON.parse(line);
        } catch {
          throw new SearchResponseError("The search response was interrupted. Please try again.", "invalid_stream");
        }
        if (!event || typeof event !== "object" || !["status", "source", "problem", "done", "error"].includes(event.type)) {
          throw new SearchResponseError("The search response was interrupted. Please try again.", "invalid_stream");
        }
        if (event.type === "error") {
          throw new SearchResponseError("Search could not finish. Your results so far are still here. Please try again.", "server_error");
        }
        onEvent(event);
        if (event.type === "done") return;
      }
      if (done) {
        throw new SearchResponseError("Search ended before it finished. Your results so far are still here. Please try again.", "incomplete_stream");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
