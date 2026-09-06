import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, { dependencies = {}, env = {}, logs = [] } = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const testModule = { exports: {} };
  const logger = Object.fromEntries(["info", "warn", "error"].map((level) => [level, (...args) => logs.push({ level, args })]));
  new Function("require", "module", "exports", "process", "console", outputText)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), name);
    return dependencies[name];
  }, testModule, testModule.exports, { env }, logger);
  return testModule.exports;
}

const diagnostics = await load("../src/lib/search-diagnostics.ts");
const dependencies = {
  "@/lib/search-diagnostics": diagnostics,
  "@/lib/request-security": await load("../src/lib/request-security.ts"),
  "@/lib/rate-limit": { checkRateLimit: () => ({ allowed: true }) },
  "next/server": { NextResponse: Response },
};
const failure = { reason: "incomplete_stream", request_id: "11111111-1111-4111-8111-111111111111", http_status: 200, duration_ms: 1234, source_count: 2, problem_count: 0, online: true };
const request = (body = failure, headers = {}) => new Request("https://arc-agi-n.com/api/search/failure", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

test("failure classification logs no error text, arbitrary names, stacks or provider bodies", () => {
  for (const [error, expected] of [
    [{ statusCode: 429, message: "secret", responseBody: "private" }, { reason: "rate_limit", http_status: 429 }],
    [{ statusCode: 503 }, { reason: "http_error", http_status: 503 }],
    [{ name: "AI_RetryError", lastError: { statusCode: 429, responseBody: "private" } }, { reason: "rate_limit", http_status: 429 }],
    [{ name: "TimeoutError" }, { reason: "timeout" }],
    [{ name: "AI_NoObjectGeneratedError", text: "private" }, { reason: "invalid_output" }],
    [{ name: "TypeError", cause: "secret" }, { reason: "network_error" }],
    [{ name: "private question", statusCode: "secret", message: "private" }, { reason: "unknown" }],
  ]) assert.deepEqual(diagnostics.searchFailureDetails(error), expected);
  const cycle = { name: "AI_RetryError" };
  cycle.lastError = cycle;
  assert.deepEqual(diagnostics.searchFailureDetails(cycle), { reason: "unknown" });
});

test("client diagnostic endpoint accepts only bounded allowlisted values", async () => {
  const logs = [];
  const { POST } = await load("../src/app/api/search/failure/route.ts", { dependencies, env: { NEXT_PUBLIC_ANALYTICS_ENABLED: "true" }, logs });
  const response = await POST(request({ ...failure, query: "private", email: "private@example.org", stack: "secret", url: "/research/private" }));
  assert.equal(response.status, 204);
  assert.deepEqual(logs, [{ level: "warn", args: ["[search] client_failure", failure] }]);
  for (const change of [{ reason: "private" }, { request_id: "private" }, { duration_ms: -1 }, { source_count: 101 }, { online: "private" }, { http_status: 999 }]) {
    assert.equal((await POST(request({ ...failure, ...change }))).status, 400);
  }
  assert.equal(logs.length, 1);
});

test("diagnostic endpoint is disabled by default and rejects cross-site, oversized and rate-limited reports", async () => {
  const logs = [];
  const disabled = await load("../src/app/api/search/failure/route.ts", { dependencies, logs });
  assert.equal((await disabled.POST(request())).status, 204);
  const enabled = await load("../src/app/api/search/failure/route.ts", { dependencies, env: { NEXT_PUBLIC_ANALYTICS_ENABLED: "true" }, logs });
  assert.equal((await enabled.POST(request(failure, { origin: "https://other.example" }))).status, 403);
  assert.equal((await enabled.POST(request(failure, { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await enabled.POST(request(failure, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await enabled.POST(request({ ...failure, padding: "x".repeat(3000) }))).status, 413);
  const limited = await load("../src/app/api/search/failure/route.ts", { dependencies: { ...dependencies, "@/lib/rate-limit": { checkRateLimit: () => ({ allowed: false, retryAfter: 20 }) } }, env: { NEXT_PUBLIC_ANALYTICS_ENABLED: "true" }, logs });
  assert.equal((await limited.POST(request())).status, 429);
  assert.equal(logs.length, 0);
});

test("search request IDs correlate lifecycle logs without logging input or raw errors", async () => {
  const logs = [];
  const { POST } = await load("../src/app/api/search/route.ts", {
    dependencies: { ...dependencies, "@/lib/search-discovery": { runDiscovery: async ({ onSource, onDiagnostic }) => {
      onSource({ title: "private source", url: "https://private.example" });
      onDiagnostic({ event: "provider_failed", stage: "synthesis", reason: "rate_limit", http_status: 429 });
      throw Object.assign(new Error("secret provider text"), { statusCode: 429, responseBody: "private" });
    } } },
    env: { VALYU_API_KEY: "test-key", OPENAI_API_KEY: "test-key" }, logs,
  });
  const response = await POST(request({ query: "private question" }));
  const id = response.headers.get("x-search-request-id");
  assert.equal(diagnostics.searchRequestId(id), id);
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).type, "error");
  assert.deepEqual(logs.map((entry) => entry.args[0]), ["[search] started", "[search] provider", "[search] failed"]);
  assert.ok(logs.every((entry) => entry.args[1].request_id === id));
  assert.equal(logs.at(-1).args[1].source_count, 1);
  assert.equal(logs.at(-1).args[1].reason, "rate_limit");
  assert.doesNotMatch(JSON.stringify(logs), /private|secret|test-key/);
});

test("rejected search requests include a correlation ID without invoking discovery", async () => {
  const logs = [];
  const { POST } = await load("../src/app/api/search/route.ts", { dependencies: { ...dependencies, "@/lib/search-discovery": { runDiscovery: () => assert.fail("Unexpected provider call") } }, logs });
  const response = await POST(request({ query: "x" }));
  assert.equal(response.status, 400);
  assert.ok(diagnostics.searchRequestId(response.headers.get("x-search-request-id")));
  assert.equal(logs[0].args[0], "[search] rejected");
});
