# Contributing

Useful contributions include well-sourced open questions, status corrections, reproducible verification tools, accessibility improvements and focused bug fixes.

## Add or correct a problem

Open an issue or pull request with:

1. The exact question, assumptions and field.
2. A canonical paper, problem page or other primary source.
3. Evidence of its current status and the date you checked it.
4. What has already been established and what remains unresolved.
5. A bounded first step and a practical way to check progress.

Curated records live in `src/lib/problems.ts`. Research milestones live in `src/lib/breakthroughs.ts`. Follow neighbouring records for the required fields. Map coordinates should reflect a documented historical or intellectual connection, not imply exclusive ownership.

For a claimed breakthrough, distinguish a proof, formalization, improved bound, experiment and benchmark result. Link the artifact or paper, explain the verification that actually occurred, and credit the original researchers. A preprint or announcement should not be presented as independent verification.

## Develop locally

Follow the [README setup](README.md#run-locally), then create a branch for your change. Keep pull requests focused and explain the user-visible outcome. Include a regression test where practical; for interface changes, add desktop and mobile screenshots with no personal data.

```bash
pnpm install --frozen-lockfile
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
