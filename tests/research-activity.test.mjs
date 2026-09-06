import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), outputText)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}

const activity = await load("../src/lib/research-activity.ts");
const call = { type: "tool-call", toolCallId: "search-1", toolName: "web_search", input: { query: "enhancer grammar open questions", apiKey: "do-not-return" } };
const source = { title: "Enhancer grammar", url: "https://example.org/paper", snippet: "A paper", privateField: "do-not-return" };
const result = { type: "tool-result", toolCallId: "search-1", output: { type: "json", value: { sources: [source], internal: "do-not-return" } } };
const messages = [{ role: "user", content: [{ type: "text", text: "do-not-return" }] }, { role: "assistant", content: [{ type: "reasoning", text: "do-not-return" }, call] }, { role: "tool", content: [result] }];

test("activity pairs calls with wrapped results and exposes only display fields", () => {
  const steps = activity.researchActivity(messages, "running");
  assert.deepEqual(steps, [{ id: "search-1", label: "Search the literature", detail: call.input.query, status: "completed", sources: [{ title: source.title, url: source.url }] }]);
  assert.doesNotMatch(JSON.stringify(steps), /do-not-return|reasoning|apiKey|internal/);
  assert.deepEqual(activity.researchActivity([...messages, ...messages], "running"), steps);
});

test("activity supports direct and stringified results, standalone results and invalid data", () => {
  for (const output of [{ sources: [source] }, { value: JSON.stringify({ sources: [source] }) }, JSON.stringify({ sources: [source] })]) {
    const steps = activity.researchActivity([{ role: "tool", content: [{ ...result, output }] }], "completed");
    assert.equal(steps[0].sources[0].url, source.url);
  }
  for (const value of [undefined, null, {}, "bad", [null, { role: "assistant", content: "bad" }]]) assert.deepEqual(activity.researchActivity(value, "running"), []);
});

test("pending and failed tools remain distinct from completed tools", () => {
  for (const [taskStatus, expected] of [["running", "running"], ["completed", "stopped"], ["failed", "stopped"], ["paused", "stopped"]]) {
    assert.equal(activity.researchActivity([{ role: "assistant", content: [call] }], taskStatus)[0].status, expected);
  }
  assert.equal(activity.researchActivity([...messages.slice(0, 2), { role: "tool", content: [{ ...result, output: { type: "error-text", value: "private error" } }] }], "running")[0].status, "failed");
});

test("sources are deduplicated, bounded, and reject unsafe links", () => {
  const sources = activity.activitySources([source, source, null, { url: "javascript:alert(1)" }, { url: "https://user:password@example.org" }, { url: "bad" }]);
  assert.deepEqual(sources, [{ title: source.title, url: source.url }]);
  assert.equal(activity.activitySources(Array.from({ length: 400 }, (_, i) => ({ url: `https://example.org/${i}` }))).length, 300);
  assert.equal(activity.researchActivity([{ role: "assistant", content: Array.from({ length: 200 }, (_, i) => ({ ...call, toolCallId: `${i}` })) }], "running").length, 100);
});

async function handler({ selfHosted = false, token = "session-token", validLink = true, data = { success: true, status: "running", messages, sources: [source], progress: { current_step: 0, total_steps: 10 } } } = {}) {
  let calls = 0;
  const { GET } = await load("../src/app/api/deepresearch/[taskId]/route.ts", {
    "next/server": { NextResponse: Response },
    "valyu-js": { Valyu: class { deepresearch = { status: async () => { calls++; return data; } }; } },
    "@/lib/app-mode": { isSelfHostedMode: () => selfHosted },
    "@/lib/network": { withDeadline: (promise) => promise },
    "@/lib/rate-limit": { checkRateLimit: () => ({ allowed: true }) },
    "@/lib/report-access": { verifyReportAccessToken: () => validLink },
    "@/lib/research-effort": { parseResearchEffort: (value) => value },
    "@/lib/research-activity": activity,
    "@/lib/valyu-session": { getValyuAccessToken: async () => token },
  }, {
    process: { env: { VALYU_API_KEY: "test-key" } },
    fetch: async (_, options) => {
      calls++;
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers.Authorization, "Bearer session-token");
      return Response.json(data);
    },
  });
  const response = await GET(new Request("https://example.org/api/deepresearch/test-task"), { params: Promise.resolve({ taskId: "test-task" }) });
  return { response, calls };
}

test("both provider modes expose live activity before the report is complete", async () => {
  for (const selfHosted of [true, false]) {
    const { response } = await handler({ selfHosted });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    assert.equal(body.activity.length, 1);
    assert.equal(body.activitySources.length, 1);
    assert.equal(body.output, undefined);
    assert.equal(body.progress.currentStep, 0);
    assert.doesNotMatch(JSON.stringify(body), /session-token|test-key|do-not-return/);
  }
});

test("activity cannot bypass report access controls", async () => {
  for (const options of [{ token: null }, { selfHosted: true, validLink: false }]) {
    const { response, calls } = await handler(options);
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  }
});

test("completed reports retain their output, sources and activity", async () => {
  const { response } = await handler({ data: { status: "completed", output: "# Report\n$x^2$", messages, sources: [source], pdf_url: "https://example.org/report.pdf" } });
  const body = await response.json();
  assert.equal(body.output, "# Report\n$x^2$");
  assert.equal(body.sources.length, 1);
  assert.equal(body.activity[0].status, "completed");
});

const uiDependencies = Object.fromEntries(await Promise.all(["react", "react/jsx-runtime", "lucide-react"].map(async (name) => [name, await import(name)])));
const favicons = await load("../src/components/source-favicon.tsx", uiDependencies);
const { ResearchActivity } = await load("../src/components/research-activity.tsx", {
  ...uiDependencies,
  "@/components/source-favicon": favicons,
  "./research-activity.module.css": { default: new Proxy({}, { get: (_, key) => String(key) }) },
});
const renderActivity = (status, steps = activity.researchActivity(messages, status)) => renderToStaticMarkup(createElement(ResearchActivity, { steps, status, sources: [], progress: { currentStep: 2, totalSteps: 8 } }));

test("live activity renders step counts, publication titles and Google favicons", () => {
  const html = renderActivity("running");
  assert.match(html, /Step 2 of 8/);
  assert.match(html, /Updating live/);
  assert.match(html, /Enhancer grammar/);
  assert.match(html, /google.com\/s2\/favicons\?domain=example.org/);
  assert.match(html, /href="https:\/\/example.org\/paper"/);
});

test("completed activity collapses and empty jobs show an honest waiting state", () => {
  assert.match(renderActivity("completed"), /<details><summary/);
  assert.doesNotMatch(renderActivity("completed"), /Updating live|class="spin"/);
  assert.match(renderActivity("queued", []), /Waiting to start/);
  assert.equal(renderActivity("failed", []), "");
});
