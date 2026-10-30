# Core trust migration and operations

## Applying
The idempotent cloud/schema.sql migration runs in the existing deployment build transaction. It relaxes tag-length checks to allow an empty optional tag; adds hidden_at to margins, is_hidden to books, visible/readable inventory counters and statement-level maintenance triggers; and creates reports, submissions, moderation-events and daily-metrics tables with RLS. There are no new public database policies: API routes use existing server credentials. Reports and submissions are not exposed through public catalog or snapshot queries.

All existing books remain published. No bulk delete or moderation decision is executed against founder content by this release. The new direct-file/public-book-creation routes return 503/410 rather than accepting unreviewed public uploads. Existing Blob files and download URLs remain intact. New source-link submissions stay in their own private pending table until an authenticated operator explicitly reviews rights and verifies an eligible readable file.

## Operator workflow
Use the existing gitignored operator environment file; do not copy the bearer token into frontend configuration or URLs.

    node --env-file=.env.harvest.local scripts/moderate.mjs --action queue
    node --env-file=.env.harvest.local scripts/moderate.mjs --action hide_margin --id POST_UUID
    node --env-file=.env.harvest.local scripts/moderate.mjs --action restore_margin --id POST_UUID
    node --env-file=.env.harvest.local scripts/moderate.mjs --action hide_book --id BOOK_ID
    node --env-file=.env.harvest.local scripts/moderate.mjs --action resolve_report --id REPORT_UUID
    node --env-file=.env.harvest.local scripts/moderate.mjs --action reject_submission --id SUBMISSION_UUID --note "Review reason"

Approval is a publishing action. Review the source, rights statement and distribution basis before explicitly invoking --action approve_submission --id SUBMISSION_UUID --rights-reviewed. The API rechecks supported file bytes and atomically marks the submission approved and creates its catalog row. It does not prove legal ownership automatically. A failed/unapproved file remains private and pending. Approval currently supports the existing trusted provider file hosts; arbitrary author-hosted EPUB/PDF delivery needs the next private-storage/author-ownership phase.

Moderation hides are reversible. Community reads exclude hidden posts immediately; catalog caches may retain metadata briefly (15s fresh / 30s stale), while book detail/file routes enforce visibility at request time. Reports do not automatically censor targets. There is no automatic 24/7 moderation staff. Reports have 30-day expiry and are removed earlier when an expired source margin is deleted. Existing daily cron also prunes expired rate-limit and stale presence records. Moderation events retain only action, target ID and timestamp. Private report details and submission rights statements are not copied into a public reading-history feed.

## Receipt access
Submission creation returns a random 256-bit receipt once. Neon stores its hash; status reads require that receipt as a bearer credential. Missing/wrong credentials get 404, never another contributor's pending metadata. The browser saves receipts locally. This is a capability for submission status, not a verified author account, public profile, recovery service or completed author dashboard. Clearing browser storage can lose access. Editing and cross-device recovery are not yet implemented.

## Metrics
Daily aggregate events start with this release: new community posts, received reports, submissions and download requests. Insert triggers prevent duplicate post retries/reports from inflating counts. No raw search terms, visitor identifiers, handles or reading completion claims are stored in this metrics table. Operator queue output contains the last 14 days; there is no public fabricated dashboard. Build probes suppress metrics within their own transaction and leave no visible test records.

## Rollback
Keep an existing deployment as a fallback, but do not roll back to an API that ignores is_hidden/hidden_at after using moderation: that would expose hidden content. Roll back UI assets independently or deploy a compatibility API retaining visibility, optional-tag validation and the submission gate. Leave additive tables/columns in place; do not drop reports, pending submissions, metrics or owner hashes. Do not restore the old required-tag constraints while empty tags exist. Old clients attempting public uploads receive a clear error; they must reload into the reviewed submission flow. Use a reviewed migration and backup before any later data removal.

## Required configuration and blockers
Existing DATABASE_URL, CRON_SECRET and CATALOG_IMPORT_TOKEN_SHA256 remain server-only; no new paid service or secret is required for this pass. Existing BLOB_READ_WRITE_TOKEN/hostname are retained only for already-published files. Private file uploads require a separately configured private store and proper owned author workflow; never relabel the current public store as private. The founder has not supplied a public legal/contact identity. In-app reports are usable, but formal legal notice/contact requirements, operational response and jurisdiction-specific policy review remain launch blockers.

Official references: https://vercel.com/docs/vercel-blob/private-storage and https://vercel.com/docs/vercel-blob/security explain why public storage is unsuitable for private manuscripts. Neon restore/history settings are provider-managed and must be verified in the project console; public post expiry is not a promise to erase backups.
