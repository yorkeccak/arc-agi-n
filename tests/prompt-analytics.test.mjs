import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/components/prompt-handoff.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});
const dependencies = Object.fromEntries(await Promise.all(
  ["react/jsx-runtime", "lucide-react", "simple-icons"].map(async (name) => [name, await import(name)]),
));
function setup(writeText, expanded = false) {
  const events = [];
  let stateIndex = 0;
  const mocks = {
    ...dependencies,
    react: { useEffect() {}, useRef: () => ({ current: null }), useState: (initial) => [stateIndex++ === 1 ? expanded : initial, () => {}] },
    "@/lib/analytics": { trackEvent: (...args) => events.push(args) },
    "@/lib/solver-brief": { buildAgentLinks: () => [{ name: "Cursor", analyticsId: "cursor", href: "https://cursor.com/link/prompt?text=private", prefilled: true }] },
  };
  const testModule = { exports: {} };
  new Function("require", "module", "exports", "navigator", outputText)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
    return mocks[name];
  }, testModule, testModule.exports, { clipboard: { writeText } });
  const tree = testModule.exports.PromptHandoff({ prompt: "Private prompt" });
  function find(node, className) {
    if (!node || typeof node !== "object") return undefined;
    if (node.props?.className === className) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = find(child, className);
      if (found) return found;
    }
  }
  return { events, find: (className) => find(tree, className) };
}

test("copy success is tracked only after the clipboard promise resolves", async () => {
  let finish;
  const { events, find } = setup(() => new Promise((resolve) => { finish = resolve; }));
  find("copy-prompt-button").props.onClick();
  assert.deepEqual(events, []);
  finish();
  await Promise.resolve();
  assert.deepEqual(events, [["prompt_copied", { method: "button" }]]);
});

test("clipboard failures do not count as copies", async () => {
  const { events, find } = setup(async () => { throw new Error("Clipboard blocked"); });
  find("copy-prompt-button").props.onClick();
  await Promise.resolve();
  assert.deepEqual(events, [["prompt_copy_failed"]]);
});

test("app handoffs record the target, never its private prompt URL", async () => {
  const { events, find } = setup(async () => {}, true);
  find("agent-launch-links").props.children[0].props.onClick();
  await Promise.resolve();
  assert.deepEqual(events, [
    ["agent_open_clicked", { target: "cursor", prefilled: true }],
    ["prompt_copied", { method: "app_link" }],
  ]);
});
