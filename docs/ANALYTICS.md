# Analytics

Analytics is optional and disabled by default. Self-hosted copies do not send events to the original project's dashboard.

## Enable on your Vercel project

1. Open **Analytics** in your Vercel project and enable Web Analytics.
2. Set `NEXT_PUBLIC_ANALYTICS_ENABLED=true` for the production environment.
3. Redeploy. This public setting is compiled into the client bundle.
4. Visit the deployment, browse the atlas and copy a prompt. Check that visits and custom events appear in the project's Analytics dashboard. Browser extensions can block collection.

Leave the setting unset for local development and previews. Custom events require a Vercel plan that supports them. Review the current [limits and pricing](https://vercel.com/docs/analytics/limits-and-pricing) and usage before enabling high-volume collection. This integration does not enable Speed Insights, session recording or another analytics provider.

## What is measured

Vercel supplies aggregate visitors, page views, referrers, countries, devices, browsers and operating systems. These are anonymous traffic statistics, not a directory of named visitors. The app does not identify accounts in analytics.

| Events | Question answered | Properties |
| --- | --- | --- |
| `search_started` | Where do searches start? | Field, typed/example/refine/retry |
| `search_completed`, `search_failed`, `search_stopped` | Do searches finish and return problems? | Completion counts and duration; failure duration |
| `atlas_browsed`, `surprise_clicked`, `breakthroughs_opened`, `field_selected` | Which discovery controls get used? | Field where applicable |
| `problem_opened` | Do people inspect problems? | Field, atlas/search origin |
| `prompt_copied`, `prompt_copy_failed`, `prompt_preview_opened`, `agent_open_clicked` | Do people take a problem into an app? | Copy method; app category and whether prefilled |
| `research_requested`, `research_auth_required`, `research_created`, `research_create_failed`, `research_effort_selected` | Where does research conversion succeed or fail? | Effort, sign-in state, field/origin, uncertain creation outcome |
| `sign_in_started`, `sign_in_completed`, `sign_in_failed`, `sign_out_completed` | Does authentication work? | Whether sign-in resumes research |
| `report_status_viewed`, `history_report_opened` | Do people return to reports? | Status, effort when available |
| `report_download_clicked`, `report_link_copied`, `source_opened` | Are reports and sources useful? | Source surface only |

Count successful copies only after the clipboard operation succeeds, and research creation only after the server accepts it. An app-link click does not prove the desktop app opened. A report status is counted once per status per mounted report, not on each poll. Report completion is observed only when someone views the report, not as a background job-completion metric. Authentication resuming a research request can produce another `research_requested` event; use `research_created` for accepted jobs.

Compare search completions against starts, problem opens against searches, prompt copies against problem opens, and research creations against requests. These are aggregate event comparisons, not cross-day identified-user funnels. Use the built-in traffic breakdowns to compare referral channels and devices.

## Data boundaries

- Event properties use an explicit runtime allowlist of enums, booleans and bounded counts. Unexpected keys and values are discarded.
- No raw search text, prompts, problem titles, names, emails, account IDs, job IDs, source URLs, errors, tokens or credentials are sent as custom properties.
- Page URLs lose all query parameters and fragments, including campaign parameters. Report IDs become `/research/report`, callback paths become `/auth/callback`, and unknown paths become `/other`. Referrer domains still provide acquisition context.
- An origin-only referrer policy keeps private same-origin paths out of request referrers.
- Tracking failures never block the underlying action. No keystroke tracking or polling-event stream is installed.
- A one-use session-storage flag carries a successful sign-in across its redirect. It contains only `1`, never an account identifier, and is removed on the next page load.

See [Vercel's privacy documentation](https://vercel.com/docs/analytics/privacy-policy) for visitor counting and retention. Disable collection by removing the environment flag and redeploying. Review this allowlist before adding an event; never pass a whole request, account or report object.
