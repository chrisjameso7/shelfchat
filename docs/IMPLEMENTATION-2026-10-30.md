# ShelfChat implementation checkpoint — 30 October 2026

## Scope completed
This pass implements the audit's core reader experience, honest discovery, and trust foundation. It preserves the existing catalog, reader, downloads, and ephemeral community while removing the forced arrival identity modal and making identity tags optional. The shared design uses matte neutral surfaces, legible metadata, responsive real covers with typography fallbacks, larger touch targets and concise copy. Collections show actual populated categories/tags, search defaults to relevance, and catalog totals distinguish indexed/public/readable records.

Reports are private, rate-limited, deduplicated and available to the authenticated operator. Books and community posts support reversible hiding; detail, reader, stream and download routes enforce book visibility. New contributions are source-link submissions stored privately as pending, with browser-held private receipt access and explicit operator review before publishing. Direct public file uploads are paused because the existing store is public. Existing published files remain available.

Added privacy, terms, community, copyright and submission pages; aggregate daily action metrics; shorter public activity history; less frequent polling; and bounded expiry cleanup. No fake activity, catalog quantities, author verification, reading-completion statistics or demo posts were introduced.

## Verification
- Existing 45-test suite passed after visibility and submission fixes. A further regression test confirms valid browser UUIDs and stable retry receipts; all five trust tests passed.
- Browser verification at 390px: no forced identity wall, posting without a tag, report receipt, relevance sorting, book reporting/rights information, private pending submission status, privacy route, no horizontal overflow. No browser JavaScript errors. Desktop and mobile screenshots inspected.
- TypeScript and production bundle checks, followed by Vercel's real-Neon migration probes and production checks, are required before considering the release deployed. See the final delivery checkpoint for their outcome.
- Build probes test real posting retry SQL, lifecycle constraints, hidden content, pending submissions and inventory consistency within transactions, without leaving public test posts or inflated metrics.

## Deliberately deferred / blocked
This is not the full future author platform. Verified author accounts, profiles, ownership recovery, manuscript editing, private binary uploads, cross-device receipts, payments and sponsored placements remain unimplemented. Arbitrary author-hosted delivery also needs the next owned/private-storage phase; current approval uses trusted supported file providers. No plans or payment buttons advertise those missing features.

The founder has no public operator/contact identity yet. In-app reporting works, but formal copyright notices and jurisdiction-specific policy review remain launch blockers. Operator review is manual, not a promise of continuous moderation. A pending submission is not proof of ownership. Browser receipt loss is not recoverable in this phase.

## Cost and operations
No paid plan, provider, dependency, database or storage service was added. Existing Neon/Vercel/Blob resources remain in use. Lower polling and short public-response caches reduce requests; aggregate metrics and private review rows still use storage/compute. External file availability and regional distribution rights remain source dependent. Database/provider backup retention is separate from public 72-hour post expiry. Do not promise instant backup erasure.

## Rollback and next phase
See TRUST-MIGRATION.md for the operator CLI, exact migration behavior and rollback constraints. Keep additive schema and visibility gates when rolling back; old APIs would expose hidden rows. Do not drop private submissions, reports or owner hashes. Next: supply a reachable legal contact, establish a review routine, then design owned author accounts and a genuinely private file store before reopening binary submissions.

Official storage references: [Private Blob](https://vercel.com/docs/vercel-blob/private-storage), [Blob security](https://vercel.com/docs/vercel-blob/security). The existing public store must not be presented as private.
