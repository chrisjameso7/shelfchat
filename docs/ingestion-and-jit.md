# Authorized ingestion and just-in-time search

ShelfChat ingests attributable public-domain files and operator-authorized feeds. Public visibility is not itself permission to distribute a book. It does not scrape pirate indexes, rotate identities to evade blocking, bypass lending/login restrictions, or invent file URLs for mainstream copyrighted titles.

## Background source worker

```powershell
# Preview metadata without touching Neon; use separate preview/live checkpoints.
npm run catalog:harvest -- --sources gutenberg,archive --max-items 100 --dry-run --checkpoint data/preview.checkpoint.json --output data/preview.jsonl

# Run on a long-lived Node 22 worker with a protected DATABASE_URL.
node --env-file=.env.local scripts/harvest-library.mjs --sources gutenberg,archive --max-items 10000 --batch 500 --checkpoint data/live.checkpoint.json
node --env-file=.env.local scripts/harvest-library.mjs --sources gutenberg,archive --max-items 10000 --batch 500 --checkpoint data/live.checkpoint.json --resume
```

The job uses Gutenberg's machine-readable OPDS pages and Internet Archive's cursor-based search/metadata APIs. It does not harvest human-facing HTML search pages. Gutenberg records need the source's explicit public-domain statement and acquisition link; the smallest published EPUB is preferred for faster reading, with up to two alternatives retained. Eight legacy Gutenberg IDs map to existing genuine books so their comments and counters remain attached.

Archive scanning is restricted to selected library collections and historical editions from 1500–1929, with an explicit Creative Commons public-domain mark/CC0 URL. Private, restricted, dark, missing-license, unsupported-format and malformed records are skipped. Only provider-listed public PDF/EPUB files and provider-published storage mirrors are retained. Source rights assertions are stored for review; they do not establish rights in every jurisdiction. Modern publisher-authorized or open-license feeds can use the existing JSON/CSV importer with explicit `rights` and `licenseUrl` fields.

Requests use one identifying User-Agent. The worker defaults to 2 seconds between requests and never goes below 2 seconds for Gutenberg / 1 second for Archive. `--interval` can increase the interval; `--user-agent` sets a stable contact string. `Retry-After` is honored, transient errors use bounded exponential retry, and 401/403 stops the job. A provider asking for more than a 60-second pause stops the process with a resumable checkpoint rather than holding the worker or ignoring the instruction. Each response is capped at 8 MB and each request times out. Run one worker per provider/checkpoint; do not multiply workers to circumvent source limits. For whole Gutenberg/Open Library catalogs, prefer official bulk dumps and the streaming importer rather than millions of HTTP page requests.

The worker bounds each insert at 1,000 rows / about 1 MB and uses one parameterized `INSERT ... VALUES ... ON CONFLICT` per batch. Repeated source IDs update metadata and editions while preserving downloads, original timestamps and marginalia. It preserves existing authorized editions when a metadata-only update arrives. Separate provider editions may remain separate records; it does not claim universal fuzzy deduplication across unrelated publishers.

Checkpoints are atomically replaced after commit. A failed write leaves the previous checkpoint intact; replay is safe through stable IDs. The checkpoint records pending page items, item position, source cursor, mode and a fingerprint of the source/database/output configuration. `--max-items` is a cumulative examined-item limit, including rejected items, across resumes. Increase it to continue a completed limited run. To synchronize the catalog again from the start, use a fresh checkpoint. A checkpoint `.lock` prevents concurrent writers; after a hard kill, remove that lock only after verifying no worker remains. Exported JSONL is append-only and can contain replayed IDs after a crash; the importer deduplicates IDs. Rejection reports contain source/item/reason without secrets.

The default database storage budget is 750 MB, leaving headroom below the connected 1 GB Free allowance. `--storage-budget-mb` changes the worker guard after an operator reviews actual capacity; it does not change billing or raise the provider quota. The worker checks database size before each batch and estimates additional index overhead. It stops before the configured budget rather than filling the database indiscriminately. `CATALOG_STORAGE_BUDGET_MB` provides the equivalent JIT guard. Provider size metering and WAL/history can differ from SQL allocation measurements; this is a conservative application guard, not a quota guarantee.

## JIT search

`GET /api/catalog?q=...` always queries Neon first. A nonempty result is returned immediately without contacting an external source. On an empty first page, a query of at least four characters can claim a lookup; cursor continuations and editorial tag filters do not dispatch external jobs. Setting `CATALOG_LOOKUPS_ENABLED=0` disables external lookups while preserving local search.

Lookup leases live in `shelfchat_search_jobs`, coalescing the same normalized query across Vercel instances. Polling existing jobs does not consume the new-job rate limit. Only the request that acquires the lease schedules `performLookup()` with Vercel `waitUntil`; the response returns `lookup: {status: "pending", retryAfterMs: 1500}` immediately. The frontend reuses the existing status area and polls until real records are available. It never fabricates temporary book cards. External network latency is visible on a first lookup; zero latency cannot be guaranteed.

The bounded lookup checks Gutenberg first and stops after an eligible title matches. Archive is a fallback; a slower second provider does not delay a successful first-provider match. Search strings are encoded/escaped as data. Eligible metadata, cover URL, source/license evidence, editions, and published alternatives are inserted into the existing books table, immediately becoming available through normal search, detail, download and reader routes. Titles without an eligible authorized file are not turned into fake downloadable records.

The lookup budget is 20 seconds. Pending leases expire after 45 seconds to recover from a crashed function. Source misses are cached for six hours; upstream/capacity errors for two minutes, so failures are not mistaken for permanent absence. Job completion updates are guarded by a unique token. Cached books persist beyond the lookup TTL. An idempotent replay cannot reset community counters. Old expired jobs are cleaned in bounded chunks. New jobs share the existing per-IP write limiter, and source request slots are coordinated in Postgres across function instances. The tables have RLS enabled and remain server-only. SQLite development mode uses the same source resolver, permanent book storage, and a bounded in-process lookup queue.

## Reading and UI

The catalog defaults to **Read & download**. **All titles** and **Discovery only** remain explicit options for real imported discovery metadata. The editorial black surfaces and cover layout are unchanged; stored cover URLs are available to API consumers without adding image widgets or ads.

Gutenberg and some Archive file hosts do not send browser CORS headers. Their EPUBs use `/api/books/:id/stream`, which looks up an authorized edition by book ID; there is no URL parameter or general-purpose proxy. It accepts only named provider hosts, validates redirects before following them, checks ZIP magic bytes, tries provider-published alternatives, applies a 40 MB cap / 35-second timeout, streams with backpressure, and cancels upstream work when the browser closes. PDF frames and CORS-compatible/Blob files retain direct source URLs. EPUB scripts remain disabled; reader position and anonymous identity remain local to the browser.

Demo/starter insertion is removed. The 16 manually seeded discovery-only entries and the known welcome/demo book are retired by exact identifiers/provenance guards; associated demo marginalia is removed by its book foreign key. Genuine imported books, actual download counts and community posts on real books are preserved. No synthetic online activity or download counts are produced.

## Verification

Run `npm test`, `npm run build`, and `npm audit --omit=dev`. Tests cover source rights/access filtering, mirror host restrictions, retry/backoff, failed-write resume, persistent insert parameters, cache hit/miss handling, upstream failures, and EPUB streaming/redirect guards. Deployment setup also verifies real Neon cursor paging, full-text search and concurrent lookup lease claims, then deletes the diagnostic lease and logs aggregate database sizing. No diagnostic books are inserted.
