import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadHistory({ selfHosted = false, token = "test-user-token", refreshed, allowed = true, fetch: mockFetch = () => {
  throw new Error("Unexpected provider request");
} } = {}) {
  const source = await readFile(new URL("../src/app/api/deepresearch/history/route.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const refreshCalls = [];
  const dependencies = {
    "next/server": { NextResponse: Response },
    "@/lib/app-mode": { isSelfHostedMode: () => selfHosted },
    "@/lib/rate-limit": { checkRateLimit: () => ({ allowed, retryAfter: 20 }) },
    "@/lib/research-effort": { parseResearchEffort: (value) => ["fast", "standard", "heavy"].includes(value) ? value : undefined },
    "@/lib/valyu-session": { getValyuAccessToken: async (forceRefresh) => {
      refreshCalls.push(Boolean(forceRefresh));
      return forceRefresh ? refreshed : token;
    } },
  };
  const testModule = { exports: {} };
  new Function("require", "module", "exports", "process", "fetch", outputText)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, testModule, testModule.exports, { env: { VALYU_API_KEY: "owner-key-never-used" } }, mockFetch);
  return { ...testModule.exports, refreshCalls };
}

const request = (query = "") => new Request(`https://arc-agi-n.com/api/deepresearch/history${query}`);
const job = (overrides = {}) => ({
  deepresearch_id: "task_123456",
  query: "Build a rigorous research plan for the open problem: Hadamard matrices.\n\nExact statement: test",
  status: "completed",
  created_at: 1_788_604_200,
  ...overrides,
});
const assertPrivate = (response) => {
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("vary"), "Cookie");
};

test("history refuses anonymous and self-hosted owner-key listing", async () => {
  for (const [options, status] of [[{ token: null }, 401], [{ selfHosted: true }, 403]]) {
    const { GET } = await loadHistory(options);
    const response = await GET(request());
    assert.equal(response.status, status);
    assertPrivate(response);
  }
});

test("history uses only the session OAuth proxy and sanitizes app-specific records", async () => {
  const { GET } = await loadHistory({ fetch: async (url, options) => {
    assert.equal(url, "https://platform.valyu.ai/api/oauth/proxy");
    assert.equal(options.headers.Authorization, "Bearer test-user-token");
    assert.equal(options.headers["x-api-key"], undefined);
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), { path: "/v1/deepresearch/list?limit=100", method: "GET" });
    return Response.json([
      job({ api_key_id: "private-key-id", output: "private full report", cost: 200, mode: "standard" }),
      job({ deepresearch_id: "other_123456", query: "Unrelated legacy account research", title: "Private business report" }),
      job({ deepresearch_id: "../escape", metadata: { source: "arc-agi-n" } }),
      job({ deepresearch_id: "newer_123456", title: "Report title", query: "", created_at: "2026-09-05T16:00:00Z", metadata: { source: "arc-agi-n", problem_title: "Collatz", effort: "heavy", email: "private@example.test" } }),
      null,
    ]);
  } });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assertPrivate(response);
  const data = await response.json();
  assert.equal(data.truncated, false);
  assert.equal(data.jobs.length, 2);
  assert.equal(data.jobs[0].title, "Collatz");
  assert.equal(data.jobs[0].effort, "heavy");
  assert.equal(data.jobs[1].title, "Hadamard matrices");
  assert.equal(data.jobs[1].effort, "standard");
  for (const entry of data.jobs) {
    assert.deepEqual(Object.keys(entry).sort(), ["createdAt", "effort", "id", "status", "title"]);
  }
  assert.doesNotMatch(JSON.stringify(data), /private|api_key|owner-key|test-user-token/);
});

test("history requests never reuse another user's result or credentials", async () => {
  for (const user of ["alice", "bob"]) {
    const { GET } = await loadHistory({ token: user, fetch: async (_, options) => {
      assert.equal(options.headers.Authorization, `Bearer ${user}`);
      return Response.json([job({ deepresearch_id: `${user}_123456`, title: user })]);
    } });
    assert.equal((await (await GET(request())).json()).jobs[0].title, user);
  }
});

test("history rejects client key IDs, paths and pagination parameters", async () => {
  const { GET } = await loadHistory();
  for (const query of ["?api_key_id=other", "?limit=1000", "?cursor=../other", "?path=/v1/search"]) {
    const response = await GET(request(query));
    assert.equal(response.status, 400);
    assertPrivate(response);
  }
});

test("history refreshes an expired OAuth token exactly once", async () => {
  let calls = 0;
  const { GET, refreshCalls } = await loadHistory({ refreshed: "refreshed-user-token", fetch: async (_, options) => {
    calls += 1;
    assert.equal(options.headers.Authorization, `Bearer ${calls === 1 ? "test-user-token" : "refreshed-user-token"}`);
    return calls === 1 ? new Response(null, { status: 401 }) : Response.json([]);
  } });
  assert.equal((await GET(request())).status, 200);
  assert.deepEqual(refreshCalls, [false, true]);
  assert.equal(calls, 2);
});

test("history fails closed when OAuth refresh fails or remains unauthorized", async () => {
  for (const refreshed of [undefined, "still-expired"]) {
    let calls = 0;
    const { GET } = await loadHistory({ refreshed, fetch: async () => {
      calls += 1;
      return new Response(null, { status: 401 });
    } });
    const response = await GET(request());
    assert.equal(response.status, 401);
    assert.equal(calls, refreshed ? 2 : 1);
    assertPrivate(response);
  }
});

test("history bounds and deduplicates results without inventing pagination", async () => {
  const rows = Array.from({ length: 105 }, (_, index) => job({ deepresearch_id: `task_${String(index).padStart(6, "0")}` }));
  rows[1] = rows[0];
  const { GET } = await loadHistory({ fetch: async () => Response.json({ success: true, data: rows }) });
  const data = await (await GET(request())).json();
  assert.equal(data.truncated, true);
  assert.equal(data.jobs.length, 99);
  assert.equal(data.nextCursor, undefined);
});

test("history returns safe errors for provider failures and malformed data", async () => {
  const responses = [
    () => new Response("upstream credential secret", { status: 500 }),
    () => Response.json({ success: false, error: "sensitive failure", data: [] }),
    () => Response.json({ tasks: [] }),
    () => new Response("not-json"),
    () => { throw new Error("private upstream details"); },
  ];
  for (const fetch of responses) {
    const { GET } = await loadHistory({ fetch });
    const response = await GET(request());
    assert.equal(response.status, 502);
    assertPrivate(response);
    assert.equal((await response.json()).error, "Could not load research history. Try again shortly.");
  }
});

test("history rate limit does not contact provider", async () => {
  const { GET } = await loadHistory({ allowed: false });
  const response = await GET(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "20");
  assertPrivate(response);
});

test("history drops invalid optional metadata and keeps unknown states explicit", async () => {
  const { GET } = await loadHistory({ fetch: async () => Response.json([job({ mode: "max", status: "secret-state", created_at: "bad-date", completed_at: {}, title: "x".repeat(400) })]) });
  const data = await (await GET(request())).json();
  assert.equal(data.jobs[0].status, "unknown");
  assert.equal(data.jobs[0].createdAt, undefined);
  assert.equal(data.jobs[0].completedAt, undefined);
  assert.equal(data.jobs[0].effort, undefined);
  assert.equal(data.jobs[0].title.length, 300);
});
