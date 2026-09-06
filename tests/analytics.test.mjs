import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/analytics.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
function load({ enabled, browser = true, storage, track = () => {} } = {}) {
  const testModule = { exports: {} };
  new Function("require", "module", "exports", "process", "window", outputText)((name) => {
    assert.equal(name, "@vercel/analytics");
    return { track };
  }, testModule, testModule.exports, { env: { NEXT_PUBLIC_ANALYTICS_ENABLED: enabled } }, browser ? { sessionStorage: storage } : undefined);
  return testModule.exports;
}

test("analytics stays disabled unless explicitly enabled, including self-hosted defaults", () => {
  for (const enabled of [undefined, "false", "1", "TRUE"]) {
    load({ enabled, track() { assert.fail("Unexpected tracking"); } }).trackEvent("atlas_browsed");
  }
  load({ enabled: "true", browser: false, track() { assert.fail("Server tracking"); } }).trackEvent("atlas_browsed");
});

test("custom events send only allowlisted values and cannot interrupt actions", () => {
  const sent = [];
  const analytics = load({ enabled: "true", track: (...args) => sent.push(args) });
  analytics.trackEvent("research_requested", {
    effort: "fast", signed_in: true, field: "Physics", problem_type: "search",
    email: "private@example.org", query: "private question", token: "private-token", taskId: "private-job",
  });
  assert.deepEqual(sent, [["research_requested", { effort: "fast", signed_in: true, field: "Physics", problem_type: "search" }]]);
  assert.deepEqual(analytics.eventProperties("research_requested", { effort: "private@example.org", field: "private prompt", signed_in: "private-id" }), {});
  assert.deepEqual(analytics.eventProperties("search_completed", { duration_ms: Infinity, source_count: -1, problem_count: 12, extra: "private" }), { problem_count: 12 });
  assert.deepEqual(analytics.eventProperties("atlas_browsed", { query: "private", toString: "private" }), {});
  assert.doesNotThrow(() => load({ enabled: "true", track() { throw new Error("Blocked"); } }).trackEvent("atlas_browsed"));
});

test("analytics URLs remove private report IDs, callback credentials, queries and fragments", () => {
  const { analyticsUrl } = load();
  for (const [input, expected] of [
    ["https://arc-agi-n.com/?problem=private&research=1#private", "https://arc-agi-n.com/"],
    ["https://arc-agi-n.com/research/private-id?access=private-token#private", "https://arc-agi-n.com/research/report"],
    ["https://arc-agi-n.com/auth/valyu/callback?code=private&state=private", "https://arc-agi-n.com/auth/callback"],
    ["https://arc-agi-n.com/research?email=private@example.org", "https://arc-agi-n.com/research"],
    ["https://arc-agi-n.com/unknown/private", "https://arc-agi-n.com/other"],
    ["https://user:pass@arc-agi-n.com/", "https://arc-agi-n.com/"],
    ["javascript:alert(1)", null],
    ["not a URL", null],
  ]) assert.equal(analyticsUrl(input), expected);
});

test("sign-in completion survives redirects and is consumed only once", () => {
  const stored = new Map();
  const sent = [];
  const analytics = load({
    enabled: "true", track: (...args) => sent.push(args),
    storage: { setItem: (key, value) => stored.set(key, value), getItem: (key) => stored.get(key), removeItem: (key) => stored.delete(key) },
  });
  analytics.rememberSignIn();
  assert.deepEqual([...stored.values()], ["1"]);
  assert.equal(sent.length, 0);
  analytics.trackRememberedSignIn();
  analytics.trackRememberedSignIn();
  assert.deepEqual(sent, [["sign_in_completed", {}]]);
  assert.equal(stored.size, 0);
  assert.doesNotThrow(() => load({ enabled: "true" }).trackRememberedSignIn());
});

test("pageview integration uses the privacy filter and never exposes private referrer paths", async () => {
  const component = await readFile(new URL("../src/components/site-analytics.tsx", import.meta.url), "utf8");
  const config = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(component, /analyticsEnabled \? <Analytics beforeSend=\{beforeSend\}/);
  assert.match(component, /analyticsUrl\(event.url\)/);
  assert.match(config, /"Referrer-Policy", value: "strict-origin"/);
});

test("both sign-in entry points record an attempt without sending their return URL", async () => {
  const history = await readFile(new URL("../src/components/research-history.tsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../src/components/auth-dialog.tsx", import.meta.url), "utf8");
  assert.match(history, /href="\/api\/oauth\/start\?returnTo=%2Fresearch" onClick=\{\(\) => trackEvent\("sign_in_started", \{ resumes_research: false \}\)\}/);
  assert.match(dialog, /href=\{signInPath\} onClick=\{\(\) => trackEvent\("sign_in_started", \{ resumes_research: resumesResearch \}\)\}/);
});
