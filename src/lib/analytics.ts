import { track } from "@vercel/analytics";

export const analyticsEnabled = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "true";

const oneOf = (...values: string[]) => (value: unknown) => typeof value === "string" && values.includes(value);
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 3_600_000;
const boolean = (value: unknown) => typeof value === "boolean";
const field = oneOf("All", "Mathematics", "Physics", "Computer science", "Biology", "Chemistry");
const effort = oneOf("fast", "standard", "heavy");
const status = oneOf("queued", "running", "completed", "failed", "cancelled", "paused", "awaiting_input", "unknown");
const problem = { field, problem_type: oneOf("atlas", "search") };

const events = {
  search_started: { field, origin: oneOf("typed", "example", "retry", "refine") },
  search_completed: { source_count: count, problem_count: count, duration_ms: count },
  search_failed: { duration_ms: count },
  search_stopped: {},
  atlas_browsed: {},
  surprise_clicked: {},
  breakthroughs_opened: {},
  field_selected: { field },
  problem_opened: problem,
  prompt_copied: { method: oneOf("button", "app_link") },
  prompt_copy_failed: {},
  prompt_preview_opened: {},
  agent_open_clicked: { target: oneOf("claude", "openai", "cursor", "chatgpt"), prefilled: boolean },
  research_requested: { ...problem, effort, signed_in: boolean },
  research_auth_required: { effort },
  research_created: { effort },
  research_create_failed: { effort, uncertain: boolean },
  research_effort_selected: { effort },
  sign_in_started: { resumes_research: boolean },
  sign_in_completed: {},
  sign_in_failed: {},
  sign_out_completed: {},
  report_status_viewed: { status, effort },
  report_download_clicked: {},
  report_link_copied: {},
  history_report_opened: { status },
  source_opened: { surface: oneOf("search", "problem", "report", "breakthrough") },
} satisfies Record<string, Record<string, (value: unknown) => boolean>>;

type EventName = keyof typeof events;
type Properties = Record<string, string | number | boolean | undefined>;

export function eventProperties(name: EventName, properties: Properties = {}): Properties {
  const allowed: Record<string, (value: unknown) => boolean> = events[name];
  return Object.fromEntries(Object.entries(properties).filter(([key, value]) => Object.hasOwn(allowed, key) && allowed[key](value)));
}

export function trackEvent(name: EventName, properties: Properties = {}) {
  if (!analyticsEnabled || typeof window === "undefined") return;
  try {
    track(name, eventProperties(name, properties));
  } catch {
    // Telemetry must never interrupt the user's action.
  }
}

const signInMarker = "arc-agi-n:analytics-sign-in";

export function rememberSignIn() {
  if (!analyticsEnabled) return;
  try {
    window.sessionStorage.setItem(signInMarker, "1");
  } catch {
    trackEvent("sign_in_completed");
  }
}

export function trackRememberedSignIn() {
  if (!analyticsEnabled) return;
  try {
    if (window.sessionStorage.getItem(signInMarker) !== "1") return;
    window.sessionStorage.removeItem(signInMarker);
    trackEvent("sign_in_completed");
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

export function analyticsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    if (url.pathname.startsWith("/research/")) url.pathname = "/research/report";
    else if (url.pathname.startsWith("/auth/")) url.pathname = "/auth/callback";
    else if (!["/", "/research"].includes(url.pathname)) url.pathname = "/other";
    return url.toString();
  } catch {
    return null;
  }
}
