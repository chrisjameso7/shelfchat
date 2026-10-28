# ShelfChat

An open shelf for restless minds. Vite + React + TypeScript + Tailwind. Vercel production uses a serverless API, Neon Postgres and Vercel Blob. Local development also supports the original Express/SQLite backend.

## Run locally

Requires Node 22.13 or later and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to port 3001. Identity is stored under `shelfchat.identity.v1` in browser localStorage. It is an editable display identity, not an authenticated or unique account. Anonymous browsing and downloading remain available when the welcome dialog is dismissed.

```sh
npm test
npm run build
npm start
```

Production serves both the SPA and API from port 3001, including direct `/book/:id` navigation. Do not deploy just `dist` to static hosting: the shared API is required.

## Deploy on Vercel

The GitHub-connected Vercel project is `shelfchat`. `vercel.json` serves the SPA, rewrites `/api/*` to `api/index.js`, and runs `npm run vercel-build`. That build inspects the database, applies the idempotent schema in `cloud/schema.sql`, imports attributable public-domain books without overwriting existing records, and builds the frontend.

Required server environment variables:

- `DATABASE_URL`: provisioned by the Neon Marketplace integration.
- `BLOB_READ_WRITE_TOKEN`: provisioned by the Vercel Blob connection.
- `BLOB_STORE_HOSTNAME`: the exact public hostname of the connected Blob store.

Keep all three server-side; do not add a `VITE_` prefix. Production and preview use the connected Neon database. Use a separate Neon branch/project if you want isolated preview data. The database connection uses the database owner; RLS is enabled with no public policies, and clients only access data through the validated server API. Never expose the database owner connection string.

Files upload directly from the browser to Blob with short-lived, size-limited tokens tied to single-use database intents. The API validates the uploaded file's signature, exact path and size before adding it to the catalog. The application accepts anonymous contributions intentionally; configure moderation and cleanup for abandoned uploads before operating at scale. Download counters measure initiated downloads, including redirects to external providers.

The cloud community feed refreshes every 10 seconds, immediately after your own contributions, and when you return to the tab. Online count measures browser sessions seen in the last 45 seconds. It does not use instance-local connection counts. Rate limiting is stored in Postgres and shared across function instances.

```sh
npm ci
# After loading the real cloud variables in your shell:
npm run db:setup
npm run build
```

## Deploy the standalone server

Use a long-running Node host or Docker with **one instance and a persistent volume** mounted at `/app/data`. SQLite and uploaded files must survive redeploys. Set `PORT` and `DATA_DIR` through the host; `.env.example` documents configuration. Node does not auto-load `.env` here. Configure HTTPS and your `shelfchat.app` DNS with the host. The Docker image runs as an unprivileged user; the mounted volume must be writable by UID 1000.

```sh
docker build -t shelfchat .
docker run -p 3001:3001 -v shelfchat-data:/app/data shelfchat
```

For a reverse proxy, disable buffering on `/api/events` and allow connections longer than 25 seconds. Set `TRUST_PROXY` to the exact number of trusted proxies only if required for rate limiting. Online count measures active browser connections, so multiple tabs count separately. Counters for external files record a download request; the app cannot confirm completion at an external provider.

Back up the SQLite database using SQLite's backup API (or stop the process and copy the entire data directory, including WAL files), together with `data/files`. Multi-instance deployment requires moving the database, files and event fan-out to shared services.

## Features and structure

- `src/App.tsx`: catalog search, category/format filters, sorting, book routing, Marginalia and activity.
- `src/components`: accessible native dialog forms, editable local identity and contributions.
- `server/index.js`: validated API, upload storage, prepared SQL, download responses, rate limiting, security headers and live SSE snapshots.
- Catalog data comes from attributable imports, authorized source lookups, or community contributions; no demo books or fabricated counters are generated.
- `server/*.test.js`: input validation and integration coverage for uploads, downloads, counters, notes and live connections.
- `.github/workflows/ci.yml`: clean install, tests and production build.

API: `GET /api/snapshot`, `GET /api/events`, `GET /api/health`, `POST /api/books` (multipart), `POST /api/books/:id/notes` (JSON), `GET /api/books/:id/download`.

## Public-domain catalog import

`cloud/archive-books.json` contains 1,000 distinct historical book records sourced from institutional collections at Internet Archive. Each record includes a source page, an explicit Creative Commons public-domain designation, publication year, and PDF and EPUB file URLs, sizes and source checksums. The EPUBs are OCR-derived and their typography can vary. Files remain hosted by Internet Archive, and download availability depends on that service.

The catalog displays 24 books per page; search and format/category filters cover the entire collection. A single book page offers each available format separately. `GET /api/books/:id/download?format=PDF` or `?format=EPUB` selects the file while retaining the book's shared download counter and Marginalia. The cloud API checks the source's file signature and can try two alternate Archive hosts before redirecting, so a broken source host does not immediately lead to a dead link. If all copies are unavailable, it returns a temporary-unavailability error without incrementing the counter.

Cloud setup imports this manifest once using stable IDs and `ON CONFLICT DO NOTHING`, verifies all 1,000 records have both formats, and preserves existing contributions, notes and download counters. Subsequent cloud refreshes send only activity and counters when the catalog version is unchanged, avoiding repeated transfers of the full library. The standalone SQLite server imports the same manifest automatically; integration tests set `SHELFCHAT_SKIP_ARCHIVE_IMPORT=1` to keep their isolated fixtures small.

To rebuild the manifest from cached source metadata, run `node scripts/build-archive-import.mjs /path/to/archive-cache 1000`. The cache directory's parent must contain `archive-candidates.json`, ordered by source popularity. The builder rejects restricted items, missing formats, duplicate title/author pairs, missing publication years, and records without the expected public-domain designation. The source discovery uses English texts published no later than 1929 in the `americana`, `toronto`, `library_of_congress`, `cornell`, `smithsonian`, and `cdl` collections, with both PDF and EPUB formats indexed. Metadata requests should identify the client, be cached, limit concurrency, and respect rate limits.

Uploads accept PDF/EPUB up to 25 MB with signature validation, or public HTTPS links. Contributors must affirm sharing rights. Rendered text is escaped by React. This anonymous contribution model intentionally has no account ownership or impersonation protection. Before a public launch at scale, establish moderation/takedown operations, malware scanning and quotas appropriate to your host. File signature checks are not malware scanning. Public-domain status varies by jurisdiction; review source rights for your audience. External links depend on the provider's availability.

Cloud resources are provisioned separately through Vercel Marketplace. The repository does not purchase or configure a custom domain automatically.

## Large catalogs and browser reader

See [the two-million-record operations guide](docs/catalog-at-scale.md) for streaming JSON/CSV imports, Open Library dump preparation, resumable checkpoints, rights metadata, indexed cursor pagination, database sizing, and EPUB/PDF browser reading. The repository does not bundle two million files; discovery records and downloadable editions are explicitly distinct.

## Source ingestion and on-demand search

See [the ingestion and JIT runbook](docs/ingestion-and-jit.md) for the background worker, provider limits, resume checkpoints, durable search cache, readable-first catalog, EPUB streams and storage budgets.

## Editorial discovery and 75,000-book growth target

The four atmosphere chips query the existing full-text and tag indexes. Their subject rules live in `shared/vibes.js`; explicit matching tags also qualify. These are editorial subject associations, not claims about a book's exact mood. Filters compose with search, availability, format and category. Changing atmosphere resets cursor pagination, and filtered misses do not start unrelated external lookups.

The hero labels 45,000+ as a library goal until the measured inventory reaches that threshold. The real database count is displayed separately. The 75,000 figure is a growth target, never a seeded or fabricated inventory.

Run `npm run catalog:grow` on a long-running Node 22 worker with its server-only `DATABASE_URL` configured. This resumes the authorized Gutenberg/Archive harvester, examining up to 75,000 source items in batches of 500, with a 750 MiB database guard. Examined items are not guaranteed to be accepted or unique; only eligible public-domain EPUB/PDF editions are committed. Source availability, rate limits and duplicate books determine the final count. Re-running resumes committed progress; it does not add placeholder records. Do not run this long ingestion inside a deployment build or browser request. Monitor checkpoint accepted/rejected counts and actual Neon storage before raising the target.

### Running the production import without exporting database credentials

`npm run catalog:grow:remote` runs a long-lived local operator worker. Configure `SHELFCHAT_IMPORT_ENDPOINT` and a random 32-byte hexadecimal `SHELFCHAT_IMPORT_TOKEN` in the gitignored `.env.harvest.local`; configure only its SHA-256 verifier as the sensitive production Vercel variable `CATALOG_IMPORT_TOKEN_SHA256`. Never put the operator token in frontend/VITE variables. The production endpoint authorizes before accessing Neon and accepts only bounded batches of attributable public-domain editions from Gutenberg/Archive provider hosts. It accepts metadata, never SQL. Rotate the token to revoke a worker.

The worker commits 25 books at a time, checkpoints only after successful production writes, resumes failed work, and stops on authorization, source blocking or capacity errors. Retries are idempotent and preserve community data. Its target is 75,000 examined source records; rejected/duplicate records do not inflate inventory. The endpoint stops conservatively before 75,000 total records or 750 MB measured database storage. A local background run requires this computer to remain awake and connected. Progress is in `data/remote-75000.checkpoint.json`; operator stdout reports each production commit and measured total. Do not run two workers against the same checkpoint. No scheduled task or paid worker is provisioned automatically.

### Reading-edition quality and cleanup

The production bulk worker verifies actual PDF signatures or the EPUB ZIP/mimetype header before committing a book, retaining only passing editions. A failed network request is retried rather than treated as proof a book is broken. On-demand cloud search uses the same file verification before caching a resolved book. A signature check is an availability/format screen, not proof that every page in a third-party file renders correctly.

Run `node --env-file=.env.harvest.local scripts/audit-readable.mjs` to audit existing records through the authenticated maintenance endpoint. It deletes metadata-only records immediately; for broken external files it requires two local failures plus a fresh server recheck, and deletes only if the stored revision is unchanged. Temporary failures, 403/429 responses and unapproved hosts are retained as uncertain. Local audit progress is checkpointed under `data/`. It never deletes Blob files; it removes unusable catalog records and their associated notes through the existing foreign-key cascade. Bulk source files remain at their external providers and do not consume Blob storage. User-uploaded Blob files already undergo format-signature checks on submission.
