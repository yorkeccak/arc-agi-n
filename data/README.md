# The community catalogue

One JSON file per entry. No database, API key or application-code changes needed.

| Add | Folder | Start with |
| --- | --- | --- |
| An open problem for the globe | [atlas/](atlas/) | [Open-problem template](templates/open-problem.json) |
| A research result for the breakthrough log | [breakthroughs/](breakthroughs/) | [Breakthrough template](templates/breakthrough.json) |

Copy a template into its folder, name it `your-short-id.json`, and make the `id` match the filename without `.json`. Replace every `REPLACE_…` value, the example source URL, and the sample coordinates. Plain JSON means double-quoted strings, no comments and no trailing commas. Existing entries are complete examples.

```bash
pnpm install --frozen-lockfile
pnpm catalogue:check
```

Validation reports the filename and field to fix. It checks required fields, supported categories, real calendar dates, coordinates, duplicate titles, IDs and HTTPS links. It does not establish whether a scientific claim is true or still open: explain that with sources in your pull request.

The build discovers every `.json` entry automatically. Do not edit `src/generated/catalogue.json` or maintain an import list. `pnpm dev` and `pnpm build` refresh that file; restart the dev server after editing catalogue files. To regenerate without starting the app, run `pnpm catalogue:build`.

## Open-problem fields

| Field | What to write |
| --- | --- |
| `id`, `title` | A stable lowercase-hyphenated ID and the problem's name. Keep an existing ID when correcting an entry. |
| `field` | `Mathematics`, `Physics`, `Computer science`, `Biology` or `Chemistry`. Use the closest field and a precise subfield. |
| `subfield`, `summary` | The narrower subject and a plain-language, one-sentence description. |
| `statement` | The exact question, assumptions and quantifiers. |
| `whyOpen` | What is established and what remains unresolved, supported by the cited literature. |
| `smallestStep` | One genuinely small starting task, not a multi-year research programme. |
| `location` | A connected researcher, institution or historical location. Supply `name`, `longitude` (-180 to 180) and `latitude` (-90 to 90); explain the connection in your PR. |
| `tags`, `tools` | Nonempty lists of topics and useful methods or software. |
| `sources` | At least one source with `title`, `url` and `kind`: `primary`, `survey` or `index`. Prefer papers and maintained expert problem lists. |
| `verified` | `YYYY-MM-DD`: when you actually checked the open status, not the paper's publication date. |
| `agentReadiness` | Recommended: `agent-ready`, `hybrid` or `physical-world`. Be honest about experiments and access requirements. |
| `executionResources`, `successCriterion` | Required when `agentReadiness` is provided: needed data, compute or equipment, and what counts as useful progress. Otherwise optional. |

Optional: `introduced` if you can source the year; `starterPrompt` for a custom prompt. Otherwise a starting prompt is built from the question and first step. Existing entries also have `scale` (`foothold`, `frontier`, `monument`) and an editorial `agentFit` value. Contributors can omit these; they are not probabilities of solving a problem.

Sources may additionally include `passage` (a short exact quotation), `publishedAt` (`YYYY-MM-DD`), `sourceType` and `doi`. Write your own summaries, not copied abstracts.

## Breakthrough fields

| Field | What to write |
| --- | --- |
| `id`, `title` | A stable lowercase-hyphenated ID and a specific result, not a promotional headline. |
| `date` | `YYYY-MM-DD`: the result's publication or announcement date. The readable display date is automatic. |
| `field` | The research area. |
| `kind` | `Benchmark`, `Algorithm`, `Construction`, `Counterexample`, `Proof`, `Formalization`, `Bound`, `Prediction`, `Experiment`, `Control` or `Portfolio`. |
| `result` | Exactly what changed, including units, conditions and the previous result where relevant. |
| `context` | Prior researchers and work, limitations, and what remains open. |
| `verificationLevel` | What was checked, who checked it, and whether that was independent, peer reviewed or only reported by the authors. |
| `aiRole` | What the system contributed and what humans did. Distinguish discovery, screening, computation, formalization and validation. |
| `sourceTitle`, `sourceUrl` | The primary paper, artifact or research announcement. |
| `additionalSources` | Optional list of `{ "title": "…", "url": "https://…" }` for independent checks, code or supporting papers. |

A formalization is not a new proof of a previously unsolved theorem. A better bound is not a full resolution. A promising candidate is not an experimentally validated discovery. Make those distinctions explicit.

If a listed open problem is resolved, update or remove its atlas entry and add a breakthrough record when appropriate, linking the resolution and describing verification. Smaller corrections are equally welcome.

Prefer not to edit JSON? [Open an issue](https://github.com/yorkeccak/arc-agi-n/issues/new/choose) with the question or result and sources. See [Contributing](../CONTRIBUTING.md) for the full workflow.
