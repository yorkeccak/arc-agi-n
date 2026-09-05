import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const dependencies = Object.fromEntries(await Promise.all([
  "react", "react/jsx-runtime", "lucide-react", "react-markdown", "rehype-katex", "remark-gfm", "remark-math",
].map(async (name) => [name, await import(name)])));
const loadComponent = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const testModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, testModule, testModule.exports);
  return testModule.exports;
};
dependencies["@/components/source-favicon"] = await loadComponent("../src/components/source-favicon.tsx");
const { ResearchDocument } = await loadComponent("../src/components/research-document.tsx");
const render = (content, sources = []) => renderToStaticMarkup(createElement(ResearchDocument, { content, sources }));

test("inline citation groups render one Google favicon and correct link per source", () => {
  const html = render("Order **668** [[2,3]]", [
    { sourceId: 2, title: "Construction tables", url: "https://www.hadamard.ca/table" },
    { sourceId: 3, title: "A primary paper", url: "https://arxiv.org/abs/1234.5678" },
  ]);
  assert.equal((html.match(/class="inline-citation"/g) || []).length, 2);
  assert.equal((html.match(/google.com\/s2\/favicons/g) || []).length, 2);
  assert.match(html, /domain=hadamard.ca/);
  assert.match(html, /domain=arxiv.org/);
  assert.match(html, /href="https:\/\/www.hadamard.ca\/table"/);
  assert.match(html, /aria-label="Source 2: Construction tables"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("ordinary links and unresolved citations do not gain misleading source icons", () => {
  const html = render("Read [the paper](https://example.org/paper). Unknown source [[99]].");
  assert.doesNotMatch(html, /google.com\/s2\/favicons/);
  assert.match(html, /class="unresolved-citation"/);
  assert.match(html, /Source URL was not returned/);
});

test("linked numeric citations retain their destination without a source ledger", () => {
  const html = render("A result [7](https://example.org/result?version=2).");
  assert.match(html, /href="https:\/\/example.org\/result\?version=2"/);
  assert.match(html, /domain=example.org/);
  assert.match(html, /aria-label="Source 7: example.org"/);
});
