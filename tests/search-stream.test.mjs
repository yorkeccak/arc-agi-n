import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/search-stream.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { readSearchResponse, SearchResponseError } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("plain-text rate limits and HTML service failures produce friendly errors", async () => {
  await assert.rejects(readSearchResponse(new Response("Too Many Requests", { status: 429 }), () => {}),
    (error) => error instanceof SearchResponseError && /wait a moment/i.test(error.message));
  await assert.rejects(readSearchResponse(new Response("<html>deployment unavailable</html>", { status: 503 }), () => {}),
    (error) => error instanceof SearchResponseError && /temporarily unavailable/i.test(error.message) && !/html|deployment/i.test(error.message));
});

test("split NDJSON chunks and a final done event without newline complete successfully", async () => {
  const encoder = new TextEncoder();
  const events = [];
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"type":"sta'));
      controller.enqueue(encoder.encode('tus","message":"Reading sources"}\n{"type":"done"}'));
      controller.close();
    },
    cancel() { cancelled = true; },
  });
  await readSearchResponse(new Response(stream), (event) => events.push(event));
  assert.deepEqual(events, [{ type: "status", message: "Reading sources" }, { type: "done" }]);
  assert.equal(stream.locked, false);
  assert.equal(cancelled, false);
});

test("early EOF preserves received events and reports an incomplete search", async () => {
  const events = [];
  const response = new Response('{"type":"status","message":"Reading sources"}\n');
  await assert.rejects(readSearchResponse(response, (event) => events.push(event)), /ended before it finished/);
  assert.equal(events.length, 1);
  assert.equal(response.body.locked, false);
});

test("malformed stream cancels the reader without exposing raw provider text", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<html>Internal upstream failure</html>\n"));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readSearchResponse(new Response(stream), () => {}),
    (error) => error instanceof SearchResponseError && !/html|upstream/i.test(error.message));
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test("provider error events are sanitized and cancel the reader", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"type":"error","message":"<html>provider diagnostic</html>"}\n'));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readSearchResponse(new Response(stream), () => {}),
    (error) => error instanceof SearchResponseError && /results so far/.test(error.message) && !/html|diagnostic/.test(error.message));
  assert.equal(cancelled, true);
});

test("a done event cancels an upstream stream that remains open", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"type":"done"}\n'));
    },
    cancel() { cancelled = true; },
  });
  await readSearchResponse(new Response(stream), () => {});
  assert.equal(cancelled, true);
});
