import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const loadTypeScript = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
};

const { checkRateLimit } = await loadTypeScript("../src/lib/rate-limit.ts");
const { validatePaidRequest } = await loadTypeScript("../src/lib/request-security.ts");
const request = (headers = {}) => new Request("https://arc-agi-n.com/api/search", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
});

test("untrusted cookies and forwarding headers cannot reset the rate limit", () => {
  const previous = { vercel: process.env.VERCEL, trust: process.env.TRUST_PROXY_HEADERS };
  delete process.env.VERCEL;
  delete process.env.TRUST_PROXY_HEADERS;
  try {
    assert.equal(checkRateLimit(request({ cookie: "unsolved_access=forged-one" }), "cookie-test", 1, 60_000).allowed, true);
    assert.equal(checkRateLimit(request({
      cookie: "unsolved_access=forged-two",
      "x-real-ip": "192.0.2.2",
      "cf-connecting-ip": "192.0.2.3",
      "x-forwarded-for": "192.0.2.4",
    }), "cookie-test", 1, 60_000).allowed, false);
  } finally {
    for (const [key, value] of [["VERCEL", previous.vercel], ["TRUST_PROXY_HEADERS", previous.trust]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("trusted proxies use only a valid X-Real-IP address", () => {
  const previous = process.env.TRUST_PROXY_HEADERS;
  process.env.TRUST_PROXY_HEADERS = "true";
  try {
    assert.equal(checkRateLimit(request({ "x-real-ip": "192.0.2.10" }), "proxy-test", 1, 60_000).allowed, true);
    assert.equal(checkRateLimit(request({
      "x-real-ip": "192.0.2.10",
      "cf-connecting-ip": "192.0.2.11",
      "x-forwarded-for": "192.0.2.12",
      cookie: "unsolved_access=another-forgery",
    }), "proxy-test", 1, 60_000).allowed, false);
    assert.equal(checkRateLimit(request({ "x-real-ip": "192.0.2.13" }), "proxy-test", 1, 60_000).allowed, true);
    assert.equal(checkRateLimit(request({ "x-real-ip": "not-an-ip" }), "invalid-proxy-test", 1, 60_000).allowed, true);
    assert.equal(checkRateLimit(request({ "x-real-ip": "also-not-an-ip" }), "invalid-proxy-test", 1, 60_000).allowed, false);
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY_HEADERS;
    else process.env.TRUST_PROXY_HEADERS = previous;
  }
});

test("paid request guard allows same-origin JSON and origin-less CLI requests", () => {
  assert.equal(validatePaidRequest(request()), undefined);
  assert.equal(validatePaidRequest(request({ origin: "https://arc-agi-n.com", "Content-Type": "application/json; charset=utf-8" })), undefined);
});

test("paid request guard rejects foreign origins, cross-site requests and non-JSON bodies", () => {
  assert.equal(validatePaidRequest(request({ origin: "https://unrelated.example" })).status, 403);
  assert.equal(validatePaidRequest(request({ origin: "null" })).status, 403);
  assert.equal(validatePaidRequest(request({ "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(validatePaidRequest(request({ "Content-Type": "text/plain" })).status, 415);
});

test("hosted search forwards cancellation to both upstream request types", async () => {
  const source = await readFile(new URL("../src/app/api/search/route.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const helpers = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) &&
    ["answerViaOAuth", "searchViaOAuth"].includes(node.name?.text));
  assert.equal(helpers.length, 2);
  const { outputText } = ts.transpileModule(helpers.map((node) => node.getText(parsed)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  const signals = [];
  const mockFetch = async (_url, options) => {
    signals.push(options.signal);
    return { ok: true, json: async () => ({ results: [] }) };
  };
  const { answerViaOAuth, searchViaOAuth } = new Function("fetch", "process", "problemSchema", "weakSourceDomains",
    `${outputText}; return { answerViaOAuth, searchViaOAuth };`)(mockFetch, { env: {} }, {}, []);
  const controller = new AbortController();
  await searchViaOAuth("test", "test-token", controller.signal);
  await answerViaOAuth("test", "test-token", "test", controller.signal);
  controller.abort();
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
});
