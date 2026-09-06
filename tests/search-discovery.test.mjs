import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as ai from "ai";
import { MockLanguageModelV3 } from "ai/test";
import * as zod from "zod";
import ts from "typescript";

const moduleSource = await readFile(new URL("../src/lib/search-discovery.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(moduleSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const loadDiscovery = ({ model, fetch: mockFetch = () => assert.fail("Unexpected network request"), onModel = () => {} } = {}) => {
  const dependencies = {
    "server-only": {},
    "@ai-sdk/openai": { createOpenAI: ({ apiKey }) => ({ responses: (name) => {
      onModel({ apiKey, name });
      return model;
    } }) },
    ai,
    zod,
    "@/lib/research-token": { issueResearchToken: () => "test-signature" },
  };
  const require = (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected module boundary: ${name}`);
    return dependencies[name];
  };
  const testModule = { exports: {} };
  new Function("require", "module", "exports", "process", "fetch", outputText)(require, testModule, testModule.exports, { env: {} }, mockFetch);
  return testModule.exports;
};

const passage = "The general question remains unsolved, despite a proof for the restricted case.";
const source = { id: "s1", title: "Quantum measurement review", url: "https://arxiv.org/pdf/2502.19278.pdf", content: passage };
const candidate = {
  title: "Measurement outcomes",
  question: "Why do quantum measurements have a definite outcome?",
  whyOpen: "A restricted result does not settle the general question.",
  field: "Physics",
  subfield: "Quantum foundations",
  firstStep: "Reproduce an established decoherence example.",
  agentReadiness: "agent-ready",
  executionResources: "Python and QuTiP",
  successCriterion: "A reproducible comparison against the published result.",
  evidence: [{ sourceId: "s1", passage }],
};

test("source IDs ground candidates without URL matching or open-status phrase rules", () => {
  const { problemSchema, toDiscoveredProblem } = loadDiscovery();
  for (const content of [passage, "It is not yet clear whether the limiting construction exists.", "A survey of open questions and a proof of one special case."]) {
    const problem = toDiscoveredProblem(problemSchema.parse({ ...candidate, evidence: [{ sourceId: "s1", passage: content }] }), new Map([["s1", { ...source, content }]]));
    assert.deepEqual(problem.sourceUrls, [source.url]);
    assert.deepEqual(problem.sourceEvidence, [{ url: source.url, passage: content }]);
    assert.equal(problem.evidenceStrength, "provisional");
    assert.equal(problem.researchToken, "test-signature");
  }
});

test("unknown source IDs never become invented citations", () => {
  const { toDiscoveredProblem } = loadDiscovery();
  const sources = new Map([["s1", source]]);
  assert.equal(toDiscoveredProblem({ ...candidate, evidence: [{ sourceId: "https://invented.example/paper", passage }] }, sources), undefined);
  const mixed = toDiscoveredProblem({ ...candidate, evidence: [{ sourceId: "missing", passage }, ...candidate.evidence, ...candidate.evidence] }, sources);
  assert.deepEqual(mixed.sourceUrls, [source.url]);
});

test("unsupported quotations are omitted without deleting a sourced question", () => {
  const { toDiscoveredProblem } = loadDiscovery();
  for (const excerpt of ["", "A fabricated quotation that was never retrieved."]) {
    const problem = toDiscoveredProblem({ ...candidate, evidence: [{ sourceId: "s1", passage: excerpt }] }, new Map([["s1", source]]));
    assert.equal(problem.title, candidate.title);
    assert.deepEqual(problem.sourceEvidence, [{ url: source.url, passage: "" }]);
  }
  const normalized = toDiscoveredProblem({ ...candidate, evidence: [{ sourceId: "s1", passage: "The general\nquestion remains unsolved" }] }, new Map([["s1", source]]));
  assert.equal(normalized.sourceEvidence[0].passage, "The general question remains unsolved");
});

const usage = { inputTokens: { total: 20, noCache: 20 }, outputTokens: { total: 20, text: 20 } };
const streamResult = (chunks, reason = "stop") => ({
  stream: ai.simulateReadableStream({
    chunks: [{ type: "stream-start", warnings: [] }, ...chunks, { type: "finish", finishReason: { unified: reason, raw: reason }, usage }],
    initialDelayInMs: null,
    chunkDelayInMs: null,
  }),
});
const toolResult = (count = 1) => streamResult(Array.from({ length: count }, (_, index) => ({
  type: "tool-call", toolCallId: `call-${index}`, toolName: "valyuSearch", input: JSON.stringify({ query: `quantum physics open questions ${index}` }),
})), "tool-calls");
const outputResult = (elements) => streamResult([
  { type: "text-start", id: "answer" },
  { type: "text-delta", id: "answer", delta: JSON.stringify({ elements }) },
  { type: "text-end", id: "answer" },
]);
const executeDiscovery = async ({ elements = [candidate], results = [source], searches = 1, status = 200 } = {}) => {
  const model = new MockLanguageModelV3({ doStream: [toolResult(searches), outputResult(elements)] });
  const calls = [];
  const events = [];
  let selectedModel;
  const { runDiscovery } = loadDiscovery({
    model,
    onModel: (value) => { selectedModel = value; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ success: status === 200, results }, { status });
    },
  });
  const result = await runDiscovery({
    query: "Open problems in quantum physics", field: "Physics", apiKey: "test-search-key", openaiKey: "test-model-key",
    signal: new AbortController().signal,
    onStatus: (message) => events.push({ type: "status", message }),
    onSource: (lead) => events.push({ type: "source", lead }),
    onProblem: (problem) => events.push({ type: "problem", problem }),
  });
  return { result, model, calls, events, selectedModel };
};

test("real SDK executes retrieval then structured discovery using the requested model settings", async () => {
  const { result, model, calls, events, selectedModel } = await executeDiscovery();
  assert.equal(result, 1);
  assert.deepEqual(selectedModel, { apiKey: "test-model-key", name: "gpt-5.6-luna" });
  assert.equal(model.doStreamCalls.length, 2);
  assert.equal(model.doStreamCalls[0].providerOptions.openai.reasoningEffort, "medium");
  assert.equal(model.doStreamCalls[0].providerOptions.openai.store, false);
  assert.equal(model.doStreamCalls[0].toolChoice.type, "required");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.valyu.ai/v1/search");
  assert.equal(calls[0].options.headers["x-api-key"], "test-search-key");
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.search_type, undefined);
  assert.equal(payload.is_tool_call, true);
  assert.equal(payload.response_length, 12_000);
  assert.equal(Number.isInteger(payload.response_length), true);
  assert.ok(payload.response_length > 0);
  assert.equal(events.filter((event) => event.type === "source").length, 1);
  assert.equal(events.filter((event) => event.type === "problem").length, 1);
  assert.ok(events.findIndex((event) => event.type === "source") < events.findIndex((event) => event.type === "problem"));
});

test("tool execution enforces the four-search budget even for parallel calls", async () => {
  const { calls, result } = await executeDiscovery({ searches: 6 });
  assert.equal(calls.length, 4);
  assert.equal(result, 1);
});

test("structured elements reach the client before the final model response completes", { timeout: 2_000 }, async () => {
  let outputController;
  let firstProblem;
  const receivedFirst = new Promise((resolve) => { firstProblem = resolve; });
  const model = new MockLanguageModelV3({ doStream: [toolResult(), {
    stream: new ReadableStream({
      start(controller) {
        outputController = controller;
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "answer" });
        controller.enqueue({ type: "text-delta", id: "answer", delta: `{"elements":[${JSON.stringify(candidate)},{` });
      },
    }),
  }] });
  const { runDiscovery } = loadDiscovery({ model, fetch: async () => Response.json({ success: true, results: [source] }) });
  const problems = [];
  let finished = false;
  const discovery = runDiscovery({
    query: "Open problems in quantum physics", apiKey: "test-search-key", openaiKey: "test-model-key",
    signal: new AbortController().signal, onStatus: () => {}, onSource: () => {},
    onProblem: (problem) => { problems.push(problem); firstProblem(); },
  }).then((count) => { finished = true; return count; });
  await receivedFirst;
  assert.equal(problems.length, 1);
  assert.equal(finished, false);
  outputController.enqueue({ type: "text-delta", id: "answer", delta: `${JSON.stringify({ ...candidate, title: "A second open question" }).slice(1)}]}` });
  outputController.enqueue({ type: "text-end", id: "answer" });
  outputController.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
  outputController.close();
  assert.equal(await discovery, 2);
});

test("unsafe URLs are not emitted or exposed as sources to the model", async () => {
  const { events, model } = await executeDiscovery({ results: [
    { ...source, url: "javascript:alert(1)" },
    { ...source, url: "https://username:password@example.com/paper" },
    { ...source, url: "not a URL" },
    source,
    source,
  ] });
  const leads = events.filter((event) => event.type === "source").map((event) => event.lead);
  assert.deepEqual(leads.map((lead) => lead.url), [source.url]);
  const modelContext = JSON.stringify(model.doStreamCalls[1].prompt);
  assert.doesNotMatch(modelContext, /javascript:|username:password|not a URL/);
});

test("failed retrieval and wholly ungrounded output are errors, not successful empty searches", async () => {
  await assert.rejects(executeDiscovery({ elements: [], status: 503 }), /Discovery did not finish/);
  await assert.rejects(executeDiscovery({ elements: [{ ...candidate, evidence: [{ sourceId: "invented", passage }] }] }), /Discovery did not finish/);
});

test("successful retrieval can legitimately return no matching questions", async () => {
  const { result, events } = await executeDiscovery({ elements: [], results: [] });
  assert.equal(result, 0);
  assert.equal(events.some((event) => event.type === "problem"), false);
});
