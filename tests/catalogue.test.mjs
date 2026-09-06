import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { loadCatalogue } from "../scripts/catalogue.mjs";

const catalogue = await loadCatalogue();

function loadData(name) {
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const testModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((path) => {
    assert.equal(path, "@/generated/catalogue.json");
    return JSON.parse(readFileSync(new URL("../src/generated/catalogue.json", import.meta.url), "utf8"));
  }, testModule, testModule.exports);
  return testModule.exports;
}

const { problems, fields, problemById } = loadData("problems");
const { breakthroughs } = loadData("breakthroughs");

function checkSource(source) {
  assert.ok(source.title.trim());
  const url = new URL(source.url);
  assert.equal(url.protocol, "https:");
  assert.equal(url.username + url.password, "");
  assert.doesNotMatch(source.url, /pubmed\.ncbi\.nlm\.nih\.gov\/PMC|hadamard\.ca/);
}

test("application exports match the contributor catalogue", () => {
  assert.deepEqual(problems, catalogue.problems);
  assert.deepEqual(breakthroughs, catalogue.breakthroughs);
});

test("catalogue has distinct complete problems with usable map locations and sources", () => {
  assert.ok(problems.length > 0);
  assert.equal(problemById.size, problems.length);
  for (const problem of problems) {
    assert.match(problem.id, /^[a-z0-9-]+$/);
    assert.ok(fields.includes(problem.field));
    for (const key of ["title", "statement", "whyOpen", "smallestStep", "starterPrompt"]) {
      assert.ok(problem[key]?.trim(), `${problem.id}: missing ${key}`);
    }
    assert.match(problem.verified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(problem.introduced === undefined || Number.isInteger(problem.introduced));
    assert.ok(Math.abs(problem.location.latitude) <= 90);
    assert.ok(Math.abs(problem.location.longitude) <= 180);
    assert.ok(problem.sources.length > 0);
    problem.sources.forEach(checkSource);
  }
});

test("a problem with a published solution claim is not offered as an open seed", () => {
  assert.equal(problemById.has("moving-sofa"), false);
});

test("seeds that specify readiness explain resources and how to judge a first result", () => {
  const detailed = problems.filter((problem) => problem.agentReadiness);
  assert.ok(detailed.length > 0);
  for (const problem of detailed) {
    assert.ok(problem.executionResources?.trim(), problem.id);
    assert.ok(problem.successCriterion?.trim(), problem.id);
    assert.ok(["agent-ready", "hybrid", "physical-world"].includes(problem.agentReadiness), problem.id);
  }
});

test("breakthroughs keep distinct records and distinguish results from verification", () => {
  assert.ok(breakthroughs.length > 0);
  assert.equal(new Set(breakthroughs.map((item) => item.id)).size, breakthroughs.length);
  assert.equal(new Set(breakthroughs.map((item) => item.title)).size, breakthroughs.length);
  for (const item of breakthroughs) {
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const key of ["result", "context", "verificationLevel", "aiRole"]) assert.ok(item[key]?.trim(), item.title);
    checkSource({ title: item.sourceTitle, url: item.sourceUrl });
    item.additionalSources?.forEach(checkSource);
  }
});
