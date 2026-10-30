# ShelfChat

A reader-first public-domain library with a browser reader, book marginalia and a temporary community room.

## Current stack
React 19 / TypeScript / Vite / React Router / Tailwind and CSS tokens; Vercel Node functions; Neon Postgres; SQLite/Express for local development. EPUB.js is lazy-loaded and its content is sandboxed. Existing published contributions use Vercel Blob. External source files stay at their providers.

## Run locally
Use Node 22 and npm. Run `npm ci`, then `npm run dev`. The API defaults to port 3001; Vite proxies `/api`. Local metadata and files live in the gitignored `data/` directory. No production database credentials are needed for local SQLite development. `npm test` runs the Node test suites; `npm run build` checks TypeScript and builds Vite.

Local catalog initialization imports the 1,000-record attributable Archive manifest. It does not seed community messages or fabricate online users. The test-only legacy upload fixture is enabled only by `SHELFCHAT_TEST_ALLOW_UPLOADS=1`; never set that in a public environment.

## Reader and community behavior
Catalog queries use bounded keyset pagination and full-text search in production. Text searches default to relevance, with an exact-title bonus. Explicit recent/download/title sorts remain available. Collection choices use populated public records; mood filters are deterministic subject rules in `shared/vibes.js`, not personalization. Inventory distinguishes indexed/public/readable metadata counts. A download count is a request, not a completed read.

Browser handles are optional for browsing and unverified. The identity tag is optional. Public community posts are text-only, at most 500 characters, and expire from API results after 72 hours. SQL enforces their lifetime. Physical cleanup happens on feed reads and a daily authenticated cron; backups may retain prior states. Book-specific marginalia remains separate and persistent. Posting has a 15-second client deadline and idempotent retry IDs. Source failures are not silently treated as proof a book is permanently invalid.

Presence is an approximate count of visitor IDs active within two minutes, not verified humans. Public activity comes from recorded events, not simulated messages. Client polling is bounded and visibility-aware. Catalog/collection responses use short shared caches; community and private receipt responses are not shared-cacheable.

## Reports and contributions
Book/post Report controls create private operator reports with daily keyed duplicate hashes; they do not publish the reporter's IP or automatically remove content. Operators use the authenticated moderation API/CLI described in `docs/TRUST-MIGRATION.md`. Visibility changes are reversible and applied to catalog/detail/read/download paths.

New contributions use existing HTTPS source links and a specific rights statement. They remain in a private pending table, outside the catalog, until an operator reviews permission and verifies an eligible reading file. Submission receipts grant private status access and are stored as hashes server-side. The browser saves its receipt before submitting so a lost response can be retried without creating a new submission. Receipts are capabilities, not verified author accounts. Private file upload storage, public author profiles, editing and recovery across devices are not implemented. New public Blob uploads and automatic public book creation are intentionally closed; existing books/files remain available.

There are no subscriptions, paid placements, billing provider, commercial book delivery or fake author analytics in this version. Operator metrics are daily aggregate new posts/reports/submissions/download requests, beginning with this release. They do not contain search terms, handles or personal reading histories. Test probes suppress metric recording and never leave visible demo posts.

## Deploy and configure
Production deploys from GitHub main through Vercel. `vercel-build` runs the idempotent schema/setup verification, then the frontend build. Production credentials remain server-only:

- `DATABASE_URL`: Neon connection.
- `CRON_SECRET`: authenticates `/api/cron/margins-cleanup` (daily, midnight UTC).
- `CATALOG_IMPORT_TOKEN_SHA256`: verifier for the private operator/import token.
- `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_HOSTNAME`: retained for previously published Blob files.
- `CATALOG_LOOKUPS_ENABLED`: optional on-demand-source lookup switch.
- `CATALOG_STORAGE_BUDGET_MB`: ingestion headroom guard, not a provider billing limit.

Never put database, Blob, receipt or operator credentials in a `VITE_` variable or commit an environment file. An integration-created public Neon auth URL is unused and does not mean author authentication is implemented. No new service or paid-plan upgrade is part of this release.

## Authorized catalog workers
`npm run catalog:import` streams JSON/JSONL/CSV and gzip inputs in bounded PostgreSQL batches; use its `--dry-run`, `--checkpoint` and `--resume` options. `npm run catalog:harvest` uses the supported provider metadata feeds. `npm run catalog:grow:remote` loads the gitignored operator environment file, verifies reading-file signatures, commits batches through the authenticated API and resumes checkpoints. It runs on the operator's computer, so that machine must remain awake and online. Targets are source-record limits, not guarantees of that many distinct readable books.

`node --env-file=.env.harvest.local scripts/audit-readable.mjs` audits reading-file availability, retaining transient/uncertain failures and requiring repeat checks before pruning. `node --env-file=.env.harvest.local scripts/moderate.mjs --action queue` reads the private review queue and recent aggregate metrics. Publishing/removal actions require deliberate operator review; see the operations document.

## Documentation and limits
- `docs/AUDIT-2026-10-30.md`: observed starting state and audit risks.
- `docs/DESIGN-SYSTEM.md`: tokens and product-interface rules.
- `docs/TRUST-MIGRATION.md`: data changes, operator workflow, retention and safe rollback.

Policy pages describe actual current behavior, not legal compliance. The founder has not yet supplied a public legal/contact identity. Formal takedown contact, regular moderation coverage, backup/restore exercises, heavier load testing and an owned private author platform remain work before a broad public launch.
