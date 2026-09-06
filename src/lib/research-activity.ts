export interface ActivitySource {
  title: string;
  url: string;
}

export interface ResearchActivityStep {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "completed" | "failed" | "stopped";
  sources: ActivitySource[];
}

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string" && value.length < 200_000) {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

const text = (value: unknown, limit = 280) => typeof value === "string" ? value.trim().slice(0, limit) : "";

export function activitySources(value: unknown): ActivitySource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: ActivitySource[] = [];
  for (const raw of value.slice(0, 300)) {
    const source = record(raw);
    try {
      const url = new URL(text(source.url, 2048));
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
      seen.add(url.href);
      sources.push({ url: url.href, title: text(source.title) || url.hostname });
    } catch { /* Ignore malformed publication links. */ }
  }
  return sources;
}

export function researchActivity(messages: unknown, taskStatus: string): ResearchActivityStep[] {
  if (!Array.isArray(messages)) return [];
  const parts: Record<string, unknown>[] = [];
  for (const raw of messages.slice(-1000)) {
    const message = record(raw);
    if (!["assistant", "tool"].includes(String(message.role)) || !Array.isArray(message.content)) continue;
    for (const part of message.content.slice(0, 100)) {
      const item = record(part);
      if (["tool-call", "tool-result"].includes(String(item.type)) && text(item.toolCallId, 200)) parts.push(item);
    }
  }

  const results = new Map(parts.filter((part) => part.type === "tool-result").map((part) => [text(part.toolCallId, 200), part]));
  const steps = new Map<string, ResearchActivityStep>();
  for (const part of parts) {
    const id = text(part.toolCallId, 200);
    if (steps.has(id)) continue;
    const result = results.get(id);
    const envelope = record(result?.output);
    const output = envelope.value === undefined ? envelope : record(envelope.value);
    const input = record(part.input);
    const name = text(part.toolName).toLowerCase();
    const sources = activitySources(output.sources).slice(0, 12);
    const query = text(input.query);
    const label = /search/.test(name) ? "Search the literature" : /content|fetch|browse|read/.test(name) ? "Read sources" : /code|python|calculat/.test(name) ? "Check a calculation" : "Research step";
    const failed = envelope.type === "error-text" || envelope.type === "error-json" || output.success === false || result?.isError === true;
    steps.set(id, {
      id,
      label,
      detail: query || undefined,
      status: failed ? "failed" : result ? "completed" : taskStatus === "running" ? "running" : "stopped",
      sources,
    });
  }
  return [...steps.values()].slice(-100);
}
