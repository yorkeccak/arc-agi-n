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
const loadSearch = (env, fetch) => loadModule("../src/app/api/search/route.ts", {
  env,
  fetch,
  dependencies: {
    ...sharedDependencies,
    "@/lib/research-token": { issueResearchToken: () => "test-signature" },
  },
});

test("self-hosted is the default and only valyu selects hosted research", async () => {
  for (const [mode, expected] of [[undefined, true], ["self-hosted", true], ["unknown", true], ["valyu", false]]) {
    const { isSelfHostedMode, appMode } = await loadModule("../src/lib/app-mode.ts", { env: { NEXT_PUBLIC_APP_MODE: mode } });
    assert.equal(isSelfHostedMode(), expected);
    assert.equal(appMode, expected ? "self-hosted" : "valyu");
  }
});

test("search is public and uses only the deployment key in every mode", async () => {
  for (const mode of [undefined, "self-hosted", "valyu"]) {
    const calls = [];
    const { POST } = await loadSearch({ NEXT_PUBLIC_APP_MODE: mode, VALYU_API_KEY: "test-deployment-key" }, async (url, options) => {
      calls.push({ url, options });
      return url.endsWith("/search")
        ? Response.json({ success: true, results: [] })
        : new Response('data: {"success":true,"contents":{"problems":[]}}\n\ndata: [DONE]\n\n');
    });
    for (const headers of [{}, { cookie: "unsolved_access=untrusted-cookie" }]) {
      const response = await POST(createRequest("search", { query: "Open problems in quantum physics" }, { headers }));
      assert.equal(response.status, 200);
      assert.match(await response.text(), /"type":"done"/);
    }
    assert.equal(calls.length, 6);
    for (const { url, options } of calls) {
      assert.ok(url.startsWith("https://api.valyu.ai/v1/"));
      assert.equal(options.headers["x-api-key"], "test-deployment-key");
      assert.equal(options.headers.Authorization, undefined);
      if (url.endsWith("/search")) {
        const payload = JSON.parse(options.body);
        assert.equal(payload.is_tool_call, true);
        assert.ok(Array.isArray(payload.excluded_sources));
        assert.equal(payload.exclude_sources, undefined);
      }
    }
  }
});

test("public search cannot fall back to OAuth when its deployment key is absent", async () => {
  const { POST } = await loadSearch({ NEXT_PUBLIC_APP_MODE: "valyu" });
  const response = await POST(createRequest("search", { query: "Open problems in physics" }, {
    headers: { cookie: "unsolved_access=untrusted-cookie" },
  }));
  assert.equal(response.status, 503);
});

test("provider failures produce a sanitized error rather than successful empty results", async () => {
  for (const failure of [
    'data: {"success":false,"error":"provider-private-detail"}\n\n',
    'data:{"type":"error","message":"provider-private-detail"}\n\n',
    'data: {"error":{"message":"provider-private-detail"}}\n\n',
    'event: error\ndata: provider-private-detail\n\n',
  ]) {
    const { POST } = await loadSearch({ VALYU_API_KEY: "test-deployment-key", NODE_ENV: "production" }, async (url) => {
      return url.endsWith("/search")
        ? Response.json({ success: true, results: [] })
        : new Response(`${failure}data: [DONE]\n\n`);
    });
    const response = await POST(createRequest("search", { query: "Open problems in physics" }));
    const output = await response.text();
    const events = output.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.at(-1), { type: "error", message: "Live research search failed. Try again." });
    assert.equal(events.some((event) => event.type === "done"), false);
    assert.doesNotMatch(output, /provider-private-detail/);
  }
});

test("cancelling evidence search aborts both requests and never starts Answer", async () => {
  const signals = [];
  const { POST } = await loadSearch({ VALYU_API_KEY: "test-deployment-key" }, async (url, options) => {
    assert.ok(url.endsWith("/search"), "Answer must not start after cancellation");
    signals.push(options.signal);
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  });
  const controller = new AbortController();
  const response = await POST(createRequest("search", { query: "Open problems in physics" }, { signal: controller.signal }));
  assert.equal(signals.length, 2);
  controller.abort();
  await response.text();
  assert.ok(signals.every((signal) => signal.aborted));
});

test("cancelling Answer stops the direct API stream", async () => {
  let answerSignal;
  let notifyAnswer;
  const answerStarted = new Promise((resolve) => { notifyAnswer = resolve; });
  const { POST } = await loadSearch({ VALYU_API_KEY: "test-deployment-key" }, async (url, options) => {
    if (url.endsWith("/search")) return Response.json({ success: true, results: [] });
    answerSignal = options.signal;
    notifyAnswer();
    return new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true });
      },
    }));
  });
  const controller = new AbortController();
  const response = await POST(createRequest("search", { query: "Open problems in physics" }, { signal: controller.signal }));
  await answerStarted;
  controller.abort();
  await response.text();
  assert.equal(answerSignal.aborted, true);
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
      "@/lib/valyu-session": { getValyuAccessToken: async () => accessToken, getValyuUser: async () => undefined },
      "valyu-js": { Valyu: class {
        constructor(key) {
          calls.push({ kind: "api-key", key });
          this.deepresearch = { create: async () => ({ success: true, deepresearch_id: "test-task" }) };
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
  assert.deepEqual(calls, [{ kind: "api-key", key: "test-deployment-key" }]);
});
