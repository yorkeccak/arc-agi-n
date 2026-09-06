import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const dependencies = Object.fromEntries(await Promise.all(
  ["react", "react/jsx-runtime", "lucide-react"].map(async (name) => [name, await import(name)]),
));
const source = await readFile(new URL("../src/components/account-menu.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});
const testModule = { exports: {} };
new Function("require", "module", "exports", outputText)((name) => {
  assert.ok(Object.hasOwn(dependencies, name));
  return dependencies[name];
}, testModule, testModule.exports);
const render = (user) => renderToStaticMarkup(createElement(testModule.exports.AccountMenu, {
  user, onSignIn() {}, async onSignOut() {},
}));
const user = { id: "test", name: "Test Reader", email: "reader@example.com" };

test("signed-in header renders an avatar without a visible name or sign-out sentence", () => {
  const html = render({ ...user, picture: "https://example.com/avatar.jpg" });
  assert.match(html, /class="account-avatar"/);
  assert.match(html, /aria-label="Account: Test Reader"/);
  assert.match(html, /src="https:\/\/example.com\/avatar.jpg"/);
  assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.doesNotMatch(html, /Sign out|reader@example.com/);
});

test("missing or unsafe avatar URL falls back to initials", () => {
  for (const picture of [undefined, "http://example.com/avatar.jpg", "javascript:alert(1)"]) {
    const html = render({ ...user, picture });
    assert.match(html, /<span>TR<\/span>/);
    assert.doesNotMatch(html, /<img/);
  }
});

test("signed-out header has a labelled sign-in control", () => {
  const html = render(undefined);
  assert.match(html, /aria-label="Sign in for DeepResearch"/);
  assert.doesNotMatch(html, /account-options|Sign out/);
});
