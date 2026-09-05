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

test("access challenges are excluded from visible sources and synthesis grounding", async () => {
  const blockedTitles = ["Checking your browser - reCAPTCHA", "Access denied", "Just a moment...", "Attention Required! | Cloudflare", "Client Challenge"];
  const { POST } = await loadSearch({ VALYU_API_KEY: "test-deployment-key" }, async (url, options) => {
    if (url.endsWith("/search")) {
      return Response.json({ success: true, results: [
        ...blockedTitles.map((title, index) => ({ title, url: `https://www.nature.com/articles/blocked-${index}`, content: "Please verify you are human." })),
        { title: "Cloud feedback uncertainty", url: "https://www.nature.com/articles/valid-paper", content: "Cloud feedback remains uncertain." },
      ] });
    }
    const query = JSON.parse(options.body).query;
    for (const title of blockedTitles) assert.equal(query.includes(title), false);
    assert.match(query, /Cloud feedback uncertainty/);
    return new Response('data: {"success":true,"contents":{"problems":[]}}\n\n');
  });
  const response = await POST(createRequest("search", { query: "Open problems in climate science" }));
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.filter((event) => event.type === "source").map((event) => event.lead.title), ["Cloud feedback uncertainty"]);
});

test("explicit open-status passages must still match a retrieved paper", async () => {
  const paperUrl = "https://arxiv.org/pdf/2502.19278.pdf";
  const observedPassage = "The problem of outcomes is still open: After the basis is chosen and quantum superpositions are suppressed";
  const candidate = (url, passage) => ({
    title: "Problem of outcomes in quantum measurements",
    question: "Why does a measurement yield a single definite outcome?",
    whyOpen: "The review describes the outcome problem as open.",
    firstStep: "Reproduce a published decoherence example with QuTiP.",
    field: "Physics",
    subfield: "Quantum foundations",
    sourceEvidence: [{ url, passage }],
    agentReadiness: "agent-ready",
    executionResources: "Python and QuTiP",
    successCriterion: "A reproducible comparison against the published baseline.",
  });
  for (const [sourceUrl, sourceText, passage, expected] of [
    [paperUrl, observedPassage, observedPassage, 1],
    [paperUrl, observedPassage.replace("is still open", "is open"), observedPassage.replace("is still open", "is open"), 1],
    [paperUrl, "The retrieved paper discusses a different topic entirely.", observedPassage, 0],
    ["https://arxiv.org/list/quant-ph/new", observedPassage, observedPassage, 0],
  ]) {
    const { POST } = await loadSearch({ VALYU_API_KEY: "test-deployment-key" }, async (url, options) => {
      if (url.endsWith("/search")) {
        return Response.json({ success: true, results: [{
          title: "The Quantum Measurement Problem: A Review of Recent Trends",
          url: sourceUrl,
          source_type: "academic paper",
          content: sourceText,
        }] });
      }
      if (sourceUrl.includes("/list/")) assert.equal(JSON.parse(options.body).query.includes(sourceUrl), false);
      return new Response(`data: ${JSON.stringify({ success: true, contents: { problems: [candidate(sourceUrl, passage)] } })}\n\n`);
    });
    const response = await POST(createRequest("search", { query: "Open problems in quantum physics" }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.type === "problem").length, expected);
  }
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
