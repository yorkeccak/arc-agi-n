import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const dependencies = Object.fromEntries(await Promise.all(
  ["react/jsx-runtime", "simple-icons"].map(async (name) => [name, await import(name)]),
));
const source = await readFile(new URL("../src/components/repository-link.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});
const testModule = { exports: {} };
new Function("require", "module", "exports", outputText)((name) => {
  assert.ok(Object.hasOwn(dependencies, name));
  return dependencies[name];
}, testModule, testModule.exports);

test("repository link has the official icon, clear label and private outbound navigation", () => {
  const html = renderToStaticMarkup(createElement(testModule.exports.RepositoryLink));
  assert.match(html, /href="https:\/\/github.com\/yorkeccak\/arc-agi-n"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /aria-label="View ARC-AGI-N on GitHub \(opens in a new tab\)"/);
  assert.match(html, /<span>GitHub<\/span>/);
  assert.ok(html.includes(dependencies["simple-icons"].siGithub.path));
});
