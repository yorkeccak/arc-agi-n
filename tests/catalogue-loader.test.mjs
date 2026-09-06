import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { atlasSchema, breakthroughSchema, loadCatalogue, readCollection } from "../scripts/catalogue.mjs";

const problem = {
  id: "test-problem",
  title: "Test problem",
  field: "Mathematics",
  subfield: "Number theory",
  summary: "A test question.",
  statement: "Does the stated bound hold for every integer?",
  whyOpen: "The general case is unresolved.",
  smallestStep: "Reproduce the published small cases.",
  location: { name: "London", longitude: -0.12, latitude: 51.5 },
  tags: ["bounds"],
  tools: ["Exact arithmetic"],
  sources: [{ title: "A source", url: "https://arxiv.org/abs/2502.19278", kind: "primary" }],
  verified: "2026-01-02",
};

const breakthrough = {
  id: "test-result",
  date: "2026-01-02",
  title: "A new bound",
  field: "Mathematics",
  kind: "Bound",
  result: "A restricted bound improved.",
  context: "The general question remains open.",
  verificationLevel: "The authors checked an exact certificate.",
  aiRole: "Search proposed candidates; the authors verified them.",
  sourceTitle: "A source",
  sourceUrl: "https://arxiv.org/abs/2502.19278",
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "catalogue-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all(["atlas", "breakthroughs"].map((name) => mkdir(join(directory, name))));
  await writeRecord(directory, "atlas", problem);
  await writeRecord(directory, "breakthroughs", breakthrough);
  return directory;
}

async function writeRecord(directory, collection, record, filename = record.id) {
  await writeFile(join(directory, collection, `${filename}.json`), JSON.stringify(record));
}

test("new files are discovered without a registry and receive display defaults", async (t) => {
  const directory = await fixture(t);
  await writeRecord(directory, "atlas", { ...problem, id: "another-problem", title: "Another problem" });
  await writeRecord(directory, "breakthroughs", { ...breakthrough, id: "another-result", title: "Another result" });
  await writeFile(join(directory, "atlas", "README.md"), "Contribution instructions");
  const catalogue = await loadCatalogue(directory);
  assert.deepEqual(catalogue.problems.map(({ id }) => id), ["another-problem", "test-problem"]);
  assert.deepEqual(catalogue.breakthroughs.map(({ id }) => id), ["another-result", "test-result"]);
  for (const item of catalogue.problems) {
    assert.equal(item.agentFit, 60);
    assert.equal(item.scale, "frontier");
    assert.ok(item.starterPrompt.includes(item.title));
    assert.ok(item.starterPrompt.includes(item.statement));
    assert.ok(item.starterPrompt.includes(item.smallestStep));
  }
  assert.equal(catalogue.breakthroughs[0].displayDate, "02 Jan 2026");
});

test("explicit display values are preserved, including zero fit", async (t) => {
  const directory = await fixture(t);
  await writeRecord(directory, "atlas", { ...problem, agentFit: 0, scale: "monument", starterPrompt: "A specific starting prompt." });
  await writeRecord(directory, "breakthroughs", { ...breakthrough, displayDate: "January 2026" });
  const catalogue = await loadCatalogue(directory);
  assert.equal(catalogue.problems[0].agentFit, 0);
  assert.equal(catalogue.problems[0].scale, "monument");
  assert.equal(catalogue.problems[0].starterPrompt, "A specific starting prompt.");
  assert.equal(catalogue.breakthroughs[0].displayDate, "January 2026");
});

test("schemas reject missing fields, unknown keys, invalid IDs, dates and source URLs", () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  for (const [schema, record, dateKey, urlKey] of [
    [atlasSchema, problem, "verified", "sources"],
    [breakthroughSchema, breakthrough, "date", "sourceUrl"],
  ]) {
    for (const patch of [
      { title: "   " }, { title: "REPLACE_WITH_TITLE" }, { title: undefined },
      { id: "Invalid ID" }, { unexpected: true },
      { [dateKey]: "2026-02-30" }, { [dateKey]: tomorrow },
    ]) assert.equal(schema.safeParse({ ...record, ...patch }).success, false, JSON.stringify(patch));
    for (const url of ["http://arxiv.org/abs/1", "https://user:password@arxiv.org/abs/1", "https://example.com/source", "not a URL"]) {
      const patch = urlKey === "sources" ? { sources: [{ ...problem.sources[0], url }] } : { sourceUrl: url };
      assert.equal(schema.safeParse({ ...record, ...patch }).success, false, url);
    }
  }
  assert.equal(atlasSchema.safeParse({ ...problem, location: { ...problem.location, longitude: 181 } }).success, false);
  assert.equal(atlasSchema.safeParse({ ...problem, sources: [] }).success, false);
  assert.equal(atlasSchema.safeParse({ ...problem, sources: [{ ...problem.sources[0], unexpected: true }] }).success, false);
  assert.equal(breakthroughSchema.safeParse({ ...breakthrough, additionalSources: [{ title: "More", url: "http://arxiv.org" }] }).success, false);
});

test("readiness classifications require resources and a success criterion", () => {
  const classified = { ...problem, agentReadiness: "agent-ready" };
  const resources = { executionResources: "A laptop" };
  const criterion = { successCriterion: "An independently checked bound" };
  assert.equal(atlasSchema.safeParse(problem).success, true);
  for (const patch of [{}, resources, criterion]) {
    assert.equal(atlasSchema.safeParse({ ...classified, ...patch }).success, false);
  }
  assert.equal(atlasSchema.safeParse({ ...classified, ...resources, ...criterion }).success, true);
});

test("contribution templates fail unchanged and pass after their placeholders are filled", async () => {
  for (const [filename, schema, record] of [
    ["open-problem", atlasSchema, { ...problem, agentReadiness: "agent-ready", executionResources: "A laptop", successCriterion: "An independently checked bound" }],
    ["breakthrough", breakthroughSchema, { ...breakthrough, additionalSources: [] }],
  ]) {
    const template = JSON.parse(await readFile(new URL(`../data/templates/${filename}.json`, import.meta.url), "utf8"));
    assert.equal(schema.safeParse(template).success, false, filename);
    const populated = Object.fromEntries(Object.keys(template).map((key) => [key, record[key]]));
    assert.equal(schema.safeParse(populated).success, true, filename);
  }
});

test("malformed files, mismatched IDs and duplicate titles give actionable errors", async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, "atlas", "test-problem.json"), "{invalid");
  await assert.rejects(readCollection("atlas", directory), /atlas\/test-problem\.json: invalid JSON/);
  await writeRecord(directory, "atlas", { ...problem, id: "different-id" }, "test-problem");
  await assert.rejects(readCollection("atlas", directory), /id must match the filename/);
  await writeRecord(directory, "atlas", { ...problem, verified: "invalid" });
  await assert.rejects(readCollection("atlas", directory), /atlas\/test-problem\.json:[\s\S]*verified:/);
  await writeRecord(directory, "atlas", problem);
  await writeRecord(directory, "atlas", { ...problem, id: "duplicate", title: " TEST PROBLEM " });
  await assert.rejects(readCollection("atlas", directory), /duplicate title/);
});

test("catalogues reject linked files, empty collections and unknown collection names", async (t) => {
  const directory = await fixture(t);
  await symlink(join(directory, "atlas", "test-problem.json"), join(directory, "atlas", "linked.json"));
  await assert.rejects(readCollection("atlas", directory), /linked\.json: expected a regular JSON file/);
  await rm(join(directory, "breakthroughs", "test-result.json"));
  await assert.rejects(readCollection("breakthroughs", directory), /breakthroughs: no entries found/);
  await assert.rejects(readCollection("unknown", directory), /Unknown catalogue collection/);
});
