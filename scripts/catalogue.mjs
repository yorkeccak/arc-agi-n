import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const root = fileURLToPath(new URL("../", import.meta.url));
const text = z.string().trim().min(1).refine((value) => !value.includes("REPLACE_"), "Replace the template placeholder");
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase-hyphenated ID");
const date = z.iso.date().refine((value) => value <= new Date().toISOString().slice(0, 10), "Use the actual date, not a future date");
const url = z.url().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.hostname !== "example.com" && !parsed.hostname.endsWith(".example.com");
  } catch {
    return false;
  }
}, "Use a real HTTPS source URL without credentials");
const source = z.object({ title: text, url }).strict();

export const atlasSchema = z.object({
  id: slug,
  title: text,
  field: z.enum(["Mathematics", "Physics", "Computer science", "Biology", "Chemistry"]),
  subfield: text,
  summary: text,
  statement: text,
  whyOpen: text,
  smallestStep: text,
  location: z.object({ name: text, longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90) }).strict(),
  tags: z.array(text).min(1),
  tools: z.array(text).min(1),
  sources: z.array(source.extend({
    kind: z.enum(["primary", "survey", "index"]),
    passage: text.optional(), publishedAt: date.optional(), sourceType: text.optional(), doi: text.optional(),
  })).min(1),
  verified: date,
  introduced: z.number().int().optional(),
  agentReadiness: z.enum(["agent-ready", "hybrid", "physical-world"]).optional(),
  executionResources: text.optional(),
  successCriterion: text.optional(),
  starterPrompt: text.optional(),
  agentFit: z.number().min(0).max(100).optional(),
  scale: z.enum(["foothold", "frontier", "monument"]).optional(),
}).strict().superRefine((record, context) => {
  if (!record.agentReadiness) return;
  for (const field of ["executionResources", "successCriterion"]) {
    if (!record[field]) context.addIssue({ code: "custom", path: [field], message: "Required when agentReadiness is provided" });
  }
});

export const breakthroughSchema = z.object({
  id: slug,
  date,
  displayDate: text.optional(),
  title: text,
  field: text,
  kind: z.enum(["Benchmark", "Algorithm", "Construction", "Counterexample", "Proof", "Formalization", "Bound", "Prediction", "Experiment", "Control", "Portfolio"]),
  result: text,
  context: text,
  verificationLevel: text,
  aiRole: text,
  sourceTitle: text,
  sourceUrl: url,
  additionalSources: z.array(source).optional(),
}).strict();

export async function readCollection(collection, dataRoot = resolve(root, "data")) {
  const schema = collection === "atlas" ? atlasSchema : collection === "breakthroughs" ? breakthroughSchema : undefined;
  if (!schema) throw new Error("Unknown catalogue collection");
  const directory = resolve(dataRoot, collection);
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name));
  if (!entries.length) throw new Error(`${collection}: no entries found`);
  const titles = new Set();
  const records = [];
  for (const entry of entries) {
    const file = `${collection}/${entry.name}`;
    if (!entry.isFile()) throw new Error(`${file}: expected a regular JSON file`);
    let value;
    try { value = JSON.parse(await readFile(resolve(directory, entry.name), "utf8")); } catch {
      throw new Error(`${file}: invalid JSON`);
    }
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new Error(`${file}:\n${result.error.issues.map((issue) => `  ${issue.path.join(".") || "record"}: ${issue.message}`).join("\n")}`);
    }
    const record = result.data;
    if (record.id !== basename(entry.name, ".json")) throw new Error(`${file}: id must match the filename`);
    const title = record.title.toLowerCase();
    if (titles.has(title)) throw new Error(`${file}: duplicate title`);
    titles.add(title);
    records.push(record);
  }
  return records;
}

export async function loadCatalogue(dataRoot = resolve(root, "data")) {
  const [atlas, breakthroughs] = await Promise.all([readCollection("atlas", dataRoot), readCollection("breakthroughs", dataRoot)]);
  return {
    problems: atlas.map((problem) => ({
      ...problem,
      agentFit: problem.agentFit ?? 60,
      scale: problem.scale ?? "frontier",
      starterPrompt: problem.starterPrompt ?? `Investigate: ${problem.title}.\n\nQuestion: ${problem.statement}\n\nStart here: ${problem.smallestStep}\n\nRead the cited sources and check for newer results before claiming novelty. State assumptions, reproduce a known result, and keep an independently checkable record of your work. Separate proven statements from numerical evidence and conjecture.`,
    })),
    breakthroughs: breakthroughs.map((item) => ({
      ...item,
      displayDate: item.displayDate ?? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${item.date}T00:00:00Z`)),
    })),
  };
}

async function main() {
  const command = process.argv[2];
  if (!["check", "build"].includes(command)) throw new Error("Usage: node scripts/catalogue.mjs check|build");
  const catalogue = await loadCatalogue();
  if (command === "build") {
    const output = resolve(root, "src/generated/catalogue.json");
    const contents = `${JSON.stringify(catalogue, null, 2)}\n`;
    await mkdir(dirname(output), { recursive: true });
    if (await readFile(output, "utf8").catch(() => "") !== contents) await writeFile(output, contents);
  }
  console.log(`Catalogue valid: ${catalogue.problems.length} open problems, ${catalogue.breakthroughs.length} breakthroughs.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
