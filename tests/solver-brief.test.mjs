import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/solver-brief.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { buildSolverBrief, buildAgentLinks } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const problem = {
  title: "An open question",
  starterPrompt: "Reproduce a known result, then explore a new approach.",
  sources: [{ title: "Primary paper", url: "https://example.org/paper", passage: "This remains open." }],
  executionResources: "A laptop and public data",
  successCriterion: "A reproducible counterexample",
};

test("brief opens with the invitation and preserves sources, constraints and evidence standards", () => {
  const prompt = buildSolverBrief(problem);
  assert.ok(prompt.startsWith(`Take a stab at this problem: ${problem.title}`));
  for (const content of [problem.starterPrompt, problem.sources[0].url, problem.executionResources, problem.successCriterion, "keep going", "time and compute budget", "do not present a numerical search as proof"]) {
    assert.ok(prompt.includes(content), content);
  }
});

test("existing source ledger is not duplicated", () => {
  const prompt = buildSolverBrief({ ...problem, starterPrompt: `Read ${problem.sources[0].url}` });
  assert.equal(prompt.split(problem.sources[0].url).length - 1, 1);
});

test("supported links prefill exactly the same prompt without submission or workspace parameters", () => {
  const prompt = 'Take a stab at this problem: ζ(s), x & y? #1 + "quotes"';
  for (const target of buildAgentLinks(prompt).filter((target) => target.prefilled)) {
    const url = new URL(target.href);
    assert.equal(url.searchParams.get("q") || url.searchParams.get("prompt") || url.searchParams.get("text"), prompt);
    assert.equal([...url.searchParams.keys()].length, 1);
  }
  const web = buildAgentLinks(prompt).find((target) => target.name === "ChatGPT");
  assert.equal(web.href, "https://chatgpt.com/");
  assert.equal(web.prefilled, false);
});

test("oversize prompts fall back to manual paste instead of silently truncating", () => {
  const targets = buildAgentLinks("ζ".repeat(15000));
  assert.ok(targets.every((target) => !target.prefilled));
  assert.ok(targets.every((target) => !new URL(target.href).search));
});
