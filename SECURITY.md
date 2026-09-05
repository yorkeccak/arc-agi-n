# Security

## Report a vulnerability privately

Do not post exploit details, credentials, private report URLs or personal data in a public issue.

Check the repository's [Security tab](https://github.com/yorkeccak/arc-agi-n/security). If GitHub offers **Report a vulnerability**, use it to submit a private report. If that option is unavailable, open an issue containing only a request for a private disclosure channel. Do not include the vulnerability details until a private channel is established.

Include the affected commit, deployment mode, a minimal reproduction, the expected and actual behaviour, and the potential impact. Redact credentials, session cookies, personal information and report access tokens. Test only on deployments and accounts you control.

Security fixes target the current default branch. There is no maintained support schedule for older snapshots.

## Deployment checklist

- Store secrets in an ignored local environment file or your hosting provider's secret settings. Never commit API keys, OAuth client secrets, cookies or signing keys, even to a private repository.
- Never prefix a secret with `NEXT_PUBLIC_`. Next.js embeds those values in client assets. A Mapbox public token is intended for the browser; restrict its scopes and allowed origins.
- Use a strong, stable `RESEARCH_TOKEN_SECRET`. Rotating it invalidates existing signed capabilities, including affected report links.
- Register exact HTTPS OAuth callback URLs. Keep production and preview credentials separate and remove unused callbacks.
- Treat signed research links as private access capabilities. Do not paste them into public issues, analytics events, screenshots or shared logs.
- Search uses the deployment owner's `VALYU_API_KEY` in both modes and does not require sign-in. Hosted DeepResearch uses the signed-in user's organisation and credits; self-hosted DeepResearch uses the owner's key.
- Public search can spend the deployment owner's credits. Apply edge abuse protection and provider-side spending controls in both modes. Restrict access to self-hosted instances when they are not intended for public use.
- Process-local rate limits are best-effort, not a distributed spending limit. OAuth protection on DeepResearch does not protect the public search budget.
- Vercel uses the platform's `X-Real-IP` header. On other hosts, enable `TRUST_PROXY_HEADERS` only when your trusted proxy overwrites that header. Do not enable it on a directly exposed server.
- Keep dependencies current and run the available checks before release. Review changes to authentication, paid API calls, report access and external URL handling with particular care.

Queries and research requests are sent to the configured provider. Do not submit confidential material unless that use is appropriate for your provider account and deployment. External sources and generated reports are untrusted content, not instructions to execute.

If a secret is exposed, revoke or rotate it at the provider immediately. Removing it from a file or rewriting Git history does not revoke access.
