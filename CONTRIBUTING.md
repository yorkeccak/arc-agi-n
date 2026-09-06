# Contributing

Useful contributions include well-sourced open questions, status corrections, reproducible verification tools, accessibility improvements and focused bug fixes.

## Contribute a catalogue entry

You can add a problem or breakthrough without configuring API keys, starting the app or changing TypeScript.

1. Fork the repository and create a branch.
2. With Node.js 22 or newer and pnpm 10 installed, run `pnpm install --frozen-lockfile`.
3. Copy the relevant template into the matching folder, giving it a unique, descriptive filename:

   | Entry | Copy from | Save in |
   | --- | --- | --- |
   | Open problem | [`data/templates/open-problem.json`](data/templates/open-problem.json) | [`data/atlas/`](data/atlas/) |
   | Breakthrough | [`data/templates/breakthrough.json`](data/templates/breakthrough.json) | [`data/breakthroughs/`](data/breakthroughs/) |

4. Replace every placeholder. Use the [field reference](data/README.md) and neighbouring entries as guides.
5. Run `pnpm catalogue:check` and fix any reported errors.
6. Open a pull request explaining the addition and linking its primary sources.

Each file contains one entry. No registry update is needed: the build discovers the files automatically. Correct an existing entry in place rather than duplicating it. Validation checks the record format; reviewers still need to check the research claims.

For a suggestion without code, [open an issue](https://github.com/yorkeccak/arc-agi-n/issues/new/choose) using **Add an open problem** or **Add a breakthrough**. Include sources so someone else can turn it into a record.

### Open problems

- State the exact question and assumptions, not just a broad topic.
- Link a canonical paper, maintained problem page or other primary source that supports its open status. Check for subsequent work and record the date you checked it.
- Explain what has been established and what remains unresolved. If a claim is disputed or status is uncertain, say so.
- Suggest a bounded first step and a practical way to check progress. Do not promise that a short investigation will solve the full problem.
- Choose map coordinates with a documented connection to the problem's history or research. They should not imply ownership, and should not be arbitrary locations.

### Breakthroughs

- Distinguish a new proof, formalization of an existing proof, improved bound, prediction, experiment or benchmark result.
- Credit the researchers. Explain the actual contribution in `aiRole`, including human work needed to develop or verify it.
- Link the paper, proof artifact, code or experiment where available, not only a social post announcing it.
- Describe the verification that occurred. An announcement or preprint is not independent verification. A benchmark score is not a solved research conjecture.

Write summaries in your own words. Do not copy abstracts, paywalled text or other substantial passages into the catalogue. Do not include secrets, private correspondence or private report URLs.

## Develop locally

Follow the [README setup](README.md#run-locally), then create a branch for your change. Keep pull requests focused and explain the user-visible outcome. Include a regression test where practical; for interface changes, add desktop and mobile screenshots with no personal data.

`pnpm dev` and `pnpm build` prepare the catalogue automatically. Restart `pnpm dev` after editing catalogue files, or run `pnpm catalogue:build` to regenerate the ignored `src/generated/catalogue.json` directly. Never edit or commit that generated file.

```bash
pnpm install --frozen-lockfile
pnpm catalogue:check
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm start
```

With the app running on port 3100, run `pnpm test` in another terminal. Use `TEST_BASE_URL` for a different local origin. The smoke suite does not replace manually checking search, sign-in, prompt copying and report rendering when your change affects those flows.

Use TypeScript, 2-space indentation and semicolons. Prefer small, explicit changes over new abstractions. Match existing patterns, explain non-obvious decisions with concise comments, and avoid unrelated formatting changes.

## Before opening a pull request

- Describe what changed, why, and how you tested it.
- Check the diff for secrets, private URLs, identifying screenshots and unrelated files.
- Keep credentials in ignored environment files. Update `.env.example` only with placeholder values when configuration changes.
- Include the lockfile if dependencies changed, and review their security advisories and licences.
- Update documentation when behaviour or setup changes.
- Identify anything you could not verify, including hosted behaviour or external research claims.

For security issues, follow [SECURITY.md](SECURITY.md) rather than opening a public bug report. By contributing, you agree that your original contributions are available under this repository's [MIT licence](LICENSE).
