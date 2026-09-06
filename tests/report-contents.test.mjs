import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const dependencies = Object.fromEntries(await Promise.all(["react", "react/jsx-runtime", "lucide-react"].map(async (name) => [name, await import(name)])));
dependencies["./report-contents.module.css"] = { default: new Proxy({}, { get: (_, key) => String(key) }) };
const source = await readFile(new URL("../src/components/report-contents.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
const mod = { exports: {} };
new Function("require", "module", "exports", outputText)((name) => {
  assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
  return dependencies[name];
}, mod, mod.exports);
const { collectReportOutline, ReportContents } = mod.exports;
const node = (tagName, textContent, id = "") => ({ tagName, textContent, id, querySelector: () => ({ alt: "Computed bound by matrix order" }) });

test("outline follows rendered headings and figures without changing existing deep links", () => {
  const nodes = [node("H2", "Current frontier", "5-current-frontier-bounds"), node("H3", "Bounds", "bounds"), node("FIGURE", ""), node("H2", "Next steps", "next-steps")];
  const entries = collectReportOutline({ querySelectorAll: (selector) => {
    assert.equal(selector, "h1, h2, h3, figure.report-figure");
    return nodes;
  } });
  assert.deepEqual(entries.map(({ id, depth, figure }) => ({ id, depth, figure })), [
    { id: "5-current-frontier-bounds", depth: 0, figure: false },
    { id: "bounds", depth: 1, figure: false },
    { id: "report-outline-3", depth: 2, figure: true },
    { id: "next-steps", depth: 0, figure: false },
  ]);
  assert.equal(entries[2].title, "Computed bound by matrix order");
  assert.equal(nodes[0].id, "5-current-frontier-bounds");
  assert.equal(entries[0].element, undefined);
});

const entries = [{ id: "status", title: "Status", depth: 0, figure: false }, { id: "bounds", title: "Bounds", depth: 1, figure: false }];
test("desktop contents highlights the current section and exposes collapse and anchors", () => {
  const html = renderToStaticMarkup(createElement(ReportContents, { entries, activeId: "bounds" }));
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /href="#bounds"[^>]*aria-current="location"/);
  assert.match(html, /padding-left:24px/);
  assert.doesNotMatch(html, />0[12]</);
});

test("mobile contents starts compact and labels the current section", () => {
  const html = renderToStaticMarkup(createElement(ReportContents, { entries, activeId: "bounds", mobile: true }));
  assert.match(html, /aria-label="Mobile report contents"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Bounds/);
  assert.doesNotMatch(html, /href=/);
  assert.equal(renderToStaticMarkup(createElement(ReportContents, { entries: entries.slice(0, 1), activeId: "status" })), "");
});
