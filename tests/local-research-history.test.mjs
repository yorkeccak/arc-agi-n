import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/local-research-history.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { readLocalResearchHistory } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const storage = (entries) => ({ length: entries.length, key: (index) => entries[index][0], getItem: (key) => entries.find(([name]) => name === key)?.[1] });
const saved = (id, value) => [`arc-agi-n:report:${id}`, JSON.stringify(value)];

test("local history keeps only matching private report links and sorts newest first", () => {
  const jobs = readLocalResearchHistory(storage([
    saved("first-job", { title: "First", status: "completed", createdAt: "2026-09-04", reportPath: "/research/first-job?access=private-link" }),
    saved("second-job", { title: "Second", status: "running", createdAt: "2026-09-05", reportPath: "/research/second-job?access=private-link&unexpected=1" }),
    saved("no-access", { title: "Hosted context", reportPath: "/research/no-access" }),
    saved("wrong-path", { title: "Wrong", reportPath: "/research/someone-else?access=private-link" }),
    saved("external-job", { title: "External", reportPath: "https://example.org/research/external-job?access=private-link" }),
    saved("unsafe-job", { title: "Unsafe", reportPath: "javascript:alert(1)" }),
    saved("broken-job", null),
    ["arc-agi-n:report:malformed", "{"],
    ["unrelated-storage", "value"],
  ]));
  assert.deepEqual(jobs.map((job) => job.id), ["second-job", "first-job"]);
  assert.equal(jobs[0].reportPath, "/research/second-job?access=private-link");
});

test("old title-only context is not exposed as a broken self-hosted report link", () => {
  assert.deepEqual(readLocalResearchHistory(storage([saved("legacy-job", { title: "Old report" })])), []);
});
