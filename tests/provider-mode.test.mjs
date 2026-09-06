import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Execute the real handlers with isolated environment and provider boundaries.
const loadModule = async (path, { env = {}, dependencies = {}, fetch: mockFetch = () => {
  throw new Error("Unexpected network request in a no-credit test");
} } = {}) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const testModule = { exports: {} };
  const require = (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected module boundary: ${name}`);
    return dependencies[name];
  };
  new Function("require", "module", "exports", "process", "fetch", outputText)(require, testModule, testModule.exports, { env }, mockFetch);
  return testModule.exports;
};

const requestSecurity = await loadModule("../src/lib/request-security.ts");
const sharedDependencies = {
  "next/server": { NextResponse: Response },
  "@/lib/request-security": requestSecurity,
  "@/lib/rate-limit": { checkRateLimit: () => ({ allowed: true, retryAfter: 0 }) },
};
const createRequest = (path, body, options = {}) => new Request(`https://arc-agi-n.com/api/${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...options.headers },
  body: JSON.stringify(body),
  signal: options.signal,
});
const loadSearch = (env, runDiscovery = async () => 0, dependencies = {}) => loadModule("../src/app/api/search/route.ts", {
  env,
  dependencies: {
    ...sharedDependencies,
    "@/lib/search-discovery": { runDiscovery },
    ...dependencies,
  },
});

test("self-hosted is the default and only valyu selects hosted research", async () => {
  for (const [mode, expected] of [[undefined, true], ["self-hosted", true], ["unknown", true], ["valyu", false]]) {
    const { isSelfHostedMode, appMode } = await loadModule("../src/lib/app-mode.ts", { env: { NEXT_PUBLIC_APP_MODE: mode } });
    assert.equal(isSelfHostedMode(), expected);
    assert.equal(appMode, expected ? "self-hosted" : "valyu");
  }
});

const searchEnv = { VALYU_API_KEY: "test-deployment-key", OPENAI_API_KEY: "test-model-key" };
const readEvents = async (response) => (await response.text()).trim().split("\n").filter(Boolean).map(JSON.parse);

test("search is public and uses deployment keys in every mode", async () => {
  for (const mode of [undefined, "self-hosted", "valyu"]) {
    const calls = [];
    const { POST } = await loadSearch({ ...searchEnv, NEXT_PUBLIC_APP_MODE: mode }, async (options) => { calls.push(options); });
    for (const headers of [{}, { cookie: "unsolved_access=untrusted-cookie" }]) {
      const response = await POST(createRequest("search", { query: "Open problems in quantum physics" }, { headers }));
      assert.equal(response.status, 200);
      assert.equal((await readEvents(response)).at(-1).type, "done");
    }
    assert.equal(calls.length, 2);
    for (const options of calls) {
      assert.equal(options.apiKey, searchEnv.VALYU_API_KEY);
      assert.equal(options.openaiKey, searchEnv.OPENAI_API_KEY);
      assert.equal(options.query, "Open problems in quantum physics");
      assert.equal(options.accessToken, undefined);
    }
  }
});

test("public search requires both deployment keys and cannot fall back to OAuth", async () => {
  for (const env of [{}, { VALYU_API_KEY: searchEnv.VALYU_API_KEY }, { OPENAI_API_KEY: searchEnv.OPENAI_API_KEY }]) {
    const { POST } = await loadSearch({ ...env, NEXT_PUBLIC_APP_MODE: "valyu" }, async () => assert.fail("Missing credentials must not start discovery"));
    const response = await POST(createRequest("search", { query: "Open problems in physics" }, { headers: { cookie: "unsolved_access=untrusted-cookie" } }));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /test-model-key|test-deployment-key|untrusted-cookie/);
  }
});

test("search streams sources and individual problems before discovery finishes", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const lead = { title: "Quantum measurement review", url: "https://arxiv.org/abs/2502.19278", snippet: "The general question remains unsolved.", source: "arxiv.org", relevance: 1 };
  const problem = { title: "Measurement outcomes", question: "Why one outcome?", sourceUrls: [lead.url] };
  const { POST } = await loadSearch(searchEnv, async ({ onStatus, onSource, onProblem }) => {
    onStatus("Reading retrieved papers");
    onSource(lead);
    onProblem(problem);
    await pending;
  });
  const response = await POST(createRequest("search", { query: "Open problems in quantum physics" }));
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let partial = "";
  while (!partial.includes('"type":"problem"')) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    partial += decoder.decode(value);
  }
  assert.doesNotMatch(partial, /"type":"done"/);
  const earlyEvents = partial.trim().split("\n").map(JSON.parse);
  assert.deepEqual(earlyEvents.find((event) => event.type === "source").lead, lead);
  assert.equal(earlyEvents.find((event) => event.type === "problem").problem.title, problem.title);
  finish();
  let remainder = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    remainder += decoder.decode(value);
  }
  assert.match(remainder, /"type":"done"/);
});

test("provider failures emit a sanitized error without reporting success", async () => {
  for (const detail of ["provider-private-detail", "credits test-deployment-key", "timed out test-model-key"]) {
    const { POST } = await loadSearch({ ...searchEnv, NODE_ENV: "production" }, async () => { throw new Error(detail); });
    const response = await POST(createRequest("search", { query: "Open problems in physics" }));
    const output = await response.text();
    const events = output.trim().split("\n").map(JSON.parse);
    assert.equal(events.at(-1).type, "error");
    assert.equal(events.some((event) => event.type === "done"), false);
    assert.doesNotMatch(output, /provider-private-detail|test-deployment-key|test-model-key/);
  }
});

test("request cancellation aborts discovery without a misleading error or completion", async () => {
  let discoverySignal;
  const { POST } = await loadSearch(searchEnv, async ({ signal }) => {
    discoverySignal = signal;
    await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const controller = new AbortController();
  const response = await POST(createRequest("search", { query: "Open problems in physics" }, { signal: controller.signal }));
  controller.abort();
  const events = await readEvents(response);
  assert.equal(discoverySignal.aborted, true);
  assert.equal(events.some((event) => event.type === "error" || event.type === "done"), false);
});

test("closing the response stream aborts upstream discovery", async () => {
  let discoverySignal;
  const { POST } = await loadSearch(searchEnv, async ({ signal }) => {
    discoverySignal = signal;
    await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const response = await POST(createRequest("search", { query: "Open problems in physics" }));
  await response.body.cancel();
  assert.equal(discoverySignal.aborted, true);
});

test("invalid queries, fields, and oversized bodies never start paid discovery", async () => {
  const { POST } = await loadSearch(searchEnv, async () => assert.fail("Invalid request reached discovery"));
  for (const body of [{}, { query: " " }, { query: "x" }, { query: 12 }, { query: "x".repeat(501) }, { query: "physics", field: "unknown" }, { query: "physics", field: {} }, null]) {
    assert.equal((await POST(createRequest("search", body))).status, 400);
  }
  assert.equal((await POST(createRequest("search", { query: "physics", padding: "x".repeat(12_000) }))).status, 413);
  assert.equal((await POST(new Request("https://arc-agi-n.com/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).status, 400);
});

test("cross-site requests and non-JSON requests never start discovery", async () => {
  const { POST } = await loadSearch(searchEnv, async () => assert.fail("Unsafe request reached discovery"));
  for (const headers of [{ origin: "https://other.example" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await POST(createRequest("search", { query: "physics" }, { headers }))).status, 403);
  }
  assert.equal((await POST(createRequest("search", { query: "physics" }, { headers: { "content-type": "text/plain" } }))).status, 415);
});

test("rate limiting stops discovery and returns a retry delay", async () => {
  const { POST } = await loadSearch(searchEnv, async () => assert.fail("Rate-limited request reached discovery"), {
    "@/lib/rate-limit": { checkRateLimit: () => ({ allowed: false, retryAfter: 37 }) },
  });
  const response = await POST(createRequest("search", { query: "physics" }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "37");
});

const canonicalProblem = {
  id: "test-problem",
  title: "Test open problem",
  statement: "A test question",
  sources: [],
  tools: [],
};

const loadResearch = async (mode, accessToken) => {
  const env = { NEXT_PUBLIC_APP_MODE: mode, VALYU_API_KEY: "test-deployment-key" };
  const calls = [];
  const { POST } = await loadModule("../src/app/api/deepresearch/route.ts", {
    env,
    fetch: async (url, options) => {
      calls.push({ kind: "oauth", url, options });
      return Response.json({ deepresearch_id: "test-task", status: "queued" });
    },
    dependencies: {
      ...sharedDependencies,
      "@/lib/app-mode": await loadModule("../src/lib/app-mode.ts", { env }),
      "@/lib/network": { withDeadline: (promise) => promise },
      "@/lib/problems": { problems: [canonicalProblem] },
      "@/lib/report-access": { issueReportAccessToken: () => undefined },
      "@/lib/research-token": { verifyResearchToken: () => undefined },
      "@/lib/research-effort": await loadModule("../src/lib/research-effort.ts"),
      "@/lib/valyu-session": { getValyuAccessToken: async () => accessToken, getValyuUser: async () => undefined },
      "valyu-js": { Valyu: class {
        constructor(key) {
          calls.push({ kind: "api-key", key });
          this.deepresearch = { create: async (options) => {
            calls.push({ kind: "research", options });
            return { success: true, deepresearch_id: "test-task" };
          } };
        }
      } },
    },
  });
  return { POST, calls };
};

test("hosted DeepResearch still requires sign-in even when the deployment key exists", async () => {
  const { POST, calls } = await loadResearch("valyu");
  const response = await POST(createRequest("deepresearch", { problem: canonicalProblem }));
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("hosted DeepResearch uses the signed-in account and never the deployment key", async () => {
  const { POST, calls } = await loadResearch("valyu", "test-user-token");
  const response = await POST(createRequest("deepresearch", { problem: canonicalProblem }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "oauth");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-user-token");
  assert.equal(calls[0].options.headers["x-api-key"], undefined);
});

test("default self-hosted DeepResearch uses the deployment key without sign-in", async () => {
  const { POST, calls } = await loadResearch(undefined);
  const response = await POST(createRequest("deepresearch", { problem: canonicalProblem }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { kind: "api-key", key: "test-deployment-key" });
  assert.equal(calls[1].options.mode, "fast");
});

test("research effort defaults to fast and is forwarded in both deployment modes", async () => {
  for (const mode of [undefined, "valyu"]) {
    for (const effort of [undefined, "fast", "standard", "heavy"]) {
      const { POST, calls } = await loadResearch(mode, "test-user-token");
      const response = await POST(createRequest("deepresearch", { problem: canonicalProblem, effort }));
      assert.equal(response.status, 200);
      const providerRequest = mode === "valyu" ? JSON.parse(calls[0].options.body).body : calls[1].options;
      assert.equal(providerRequest.mode, effort || "fast");
      assert.deepEqual(providerRequest.tools, { code_execution: true, charts: true });
      assert.equal((await response.json()).effort, effort || "fast");
    }
  }
});

test("invalid research effort is rejected before creating a paid task", async () => {
  for (const effort of ["max", "xhigh", null, 5, {}, ""]) {
    const { POST, calls } = await loadResearch("valyu", "test-user-token");
    const response = await POST(createRequest("deepresearch", { problem: canonicalProblem, effort }));
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  }
});
