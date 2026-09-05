# Hosting

ARC-AGI-N is a Next.js application with two deployment modes. Most personal deployments should use self-hosted mode: no sign-in, one server-side API key, and no database to manage.

## Self-hosted deployment

Start with the [README setup](../README.md#run-locally). Import your fork into Vercel as a Next.js project using pnpm, or build and run it on a Node.js 22+ host.

Set the local configuration in your host's environment settings, with these changes:

```env
NEXT_PUBLIC_APP_MODE=self-hosted
NEXT_PUBLIC_SITE_URL=https://research.example.com
NEXT_PUBLIC_APP_URL=https://research.example.com
```

Add your `VALYU_API_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN` and a strong `RESEARCH_TOKEN_SECRET`. Optional `DEEPRESEARCH_ALERT_EMAIL` enables the provider's standard completion email. The app displays a signed report link when a task starts; that link is an access capability and should remain private.

All search and research requests use the deployment owner's API account. Add access controls and provider-side spending limits before allowing other people to use the instance.

## Optional OAuth mode

OAuth mode is for operators offering a multi-user service. The globe, curated records and live search remain public. Search uses the deployment's `VALYU_API_KEY`; only DeepResearch requires Valyu sign-in and uses the signed-in user's organisation and credits.

Register an OAuth client with the provider and configure the exact callback URL for your domain:

```env
NEXT_PUBLIC_APP_MODE=valyu
NEXT_PUBLIC_SITE_URL=https://research.example.com
NEXT_PUBLIC_APP_URL=https://research.example.com
NEXT_PUBLIC_MAPBOX_TOKEN=pk_your_mapbox_public_token
VALYU_API_KEY=your_valyu_api_key
NEXT_PUBLIC_VALYU_SUPABASE_URL=https://auth.valyu.ai
NEXT_PUBLIC_VALYU_CLIENT_ID=your_client_id
VALYU_CLIENT_SECRET=your_client_secret
VALYU_APP_URL=https://platform.valyu.ai
NEXT_PUBLIC_REDIRECT_URI=https://research.example.com/auth/valyu/callback
RESEARCH_TOKEN_SECRET=replace_with_a_random_64_character_hex_value
```

Replace the example origin with your domain. Keep preview and production credentials separate, and register only the callback URLs you need. Do not expose `VALYU_CLIENT_SECRET` or `VALYU_API_KEY` through public variables.

The owner API key is required in both modes. Public search spends that account's credits without visitor authentication, so configure edge abuse protection and provider-side spending limits before launch. DeepResearch sign-in does not limit public search spending.

## Deployment checks

- Public environment variables are embedded at build time. Rebuild after changing the mode, domain or other public configuration.
- Restrict the Mapbox public token to your deployment origins and required scopes.
- On Vercel, rate limiting uses the platform's `X-Real-IP` header. On other hosts, enable `TRUST_PROXY_HEADERS=true` only behind a trusted proxy that overwrites `X-Real-IP`.
- Built-in rate limits are best-effort and process-local. They are not distributed abuse protection or a billing cap.
- Verify the production origin, sign-in and sign-out when applicable, a search, prompt copying, research creation, report return links and PDF access after deploying.
- Keep secrets and signed report links out of logs, screenshots and public issues. See [SECURITY.md](../SECURITY.md).
