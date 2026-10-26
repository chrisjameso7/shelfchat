# Scaling ShelfChat to two million records

The implementation supports a large catalog; it does **not** ship two million book files or pretend that metadata is a downloadable edition. The library contains attributable public-domain editions and real authorized source lookups. BookTok labels are editorial picks, not a live ranking or a claim about current sales.

## Capacity and rollout

Use a long-lived Node 22 worker or your terminal for bulk jobs, never a public API route or the Vercel build. Supply `DATABASE_URL` through a protected worker secret or a local ignored environment file. Do not put the database connection string in Vite variables.

Before a full import, inspect the Neon project's storage and compute allowance. Two million rows, descriptions, indexes, WAL/history and author lookup data need materially more storage than a small free database. Import a representative 10,000-record sample into an isolated branch and inspect:

```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT pg_size_pretty(pg_total_relation_size('shelfchat_books'));
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM shelfchat_books
WHERE search_document @@ websearch_to_tsquery('simple','dark academia')
ORDER BY created_at DESC,id DESC LIMIT 25;
```

Extrapolate sample storage, allow headroom, verify the plan, then run the full job. No billing upgrade is performed by these scripts. Benchmark mixed searches, rare tags, first/deep cursors and concurrent writes on the actual Neon compute. A streaming dry run verifies parser throughput and memory, not database latency or production capacity.

The idempotent schema is applied by `npm run db:setup`. Initial indexes are created before the large import. On an already populated multi-million-row deployment, add/rebuild indexes with `CREATE INDEX CONCURRENTLY` outside a transaction during a planned migration; the normal fresh-database migration is not an online index maintenance tool.

## Supported metadata

JSONL (one object per line), CSV with headers and JSON arrays are streamed; `.gz` is supported. For `{ "books": [...] }`, use `--format json --array-path books`. CSV `tags` uses `|`; `editions` is a JSON string. JSON records use:

```json
{
  "id": "publisher-stable-id",
  "title": "An authorized edition",
  "author": "An author",
  "description": "Book description",
  "category": "Fiction",
  "availability": "downloadable",
  "rights": "permission",
  "licenseUrl": "https://publisher.example/permissions",
  "sourceUrl": "https://publisher.example/books/example",
  "format": "EPUB",
  "editions": {
    "EPUB": {"url": "https://files.example/book.epub", "size": 900000},
    "PDF": {"url": "https://files.example/book.pdf", "size": 1800000}
  },
  "tags": ["booktok", "romantasy"],
  "publishedYear": 2025
}
```

Downloadable records require an explicit `rights` value (`public-domain`, `open-license`, or `permission`). Public-domain/open-license records also require a license URL. This records the operator's rights assertion; it does not independently establish copyright status. Only import files you are authorized to distribute.

For metadata-only records, set `availability: "discovery"`, supply a legitimate `sourceUrl`, and omit editions. The UI offers source editions and community notes without download/read buttons. A discovery update cannot remove an existing authorized edition or reset its counter, original timestamp, or comments. IDs must be stable across feed refreshes: different IDs are different catalog records. The importer deterministically hashes source/title/author if no ID is supplied; it does not deduplicate different publishers' editions by fuzzy title.

Bounds: title 150, author 100, description 1200 characters; at most 30 tags of 60 characters. Categories: Fiction, Philosophy, Poetry, Essays, Nonfiction. The general importer rejects oversized metadata rather than silently truncating it. Rejections are written to a JSONL report containing record number, ID and reason.

```powershell
node --env-file=.env.local scripts/import-library.mjs --file data/books.jsonl.gz --format jsonl --dry-run --batch 1000
node --env-file=.env.local scripts/import-library.mjs --file data/books.jsonl.gz --format jsonl --batch 500 --limit 2000000
# Resume an interrupted real import (same unchanged input and checkpoint):
node --env-file=.env.local scripts/import-library.mjs --file data/books.jsonl.gz --format jsonl --batch 500 --limit 2000000 --resume
```

Dry-run and real-run checkpoints cannot be mixed. Give them separate `--checkpoint` paths or remove the dry-run checkpoint before a fresh real run. `--strict` stops on the first invalid record. The default skips rejected rows and reports counts. `--limit` is the number of source records examined, including rejects. Checkpoint identity uses the resolved input path, size, modification time, format and array path. Do not edit input while importing, and do not run two workers against the same checkpoint.

Each batch contains at most 1,000 rows / about 1 MB of metadata, 17 parameters per row (well below PostgreSQL's parameter limit). One parameterized `INSERT INTO ... VALUES (...) ON CONFLICT` commits atomically. Duplicate IDs in a batch are consolidated. A checkpoint is atomically renamed only after the batch commits. A crash between commit and checkpoint is safe: replay upserts the same IDs without incrementing downloads. Retried operations are limited to transient database/network failures. Each job has bounded memory and natural backpressure; it does not retain all records or promise a fixed throughput. After loading, run `ANALYZE shelfchat_books` so query planning reflects the new distribution.

## Open Library bulk source

Use the official [monthly dumps](https://openlibrary.org/developers/dumps), rather than harvesting the live search API. Metadata provides discovery; it does not grant download rights to the underlying books. Download authors and works dumps to `data/` with an ordinary resumable download tool, then:

```powershell
node scripts/prepare-openlibrary.mjs --authors data/authors.txt.gz --works data/works.txt.gz --index data/authors.sqlite --output data/openlibrary.jsonl --limit 2000000
node scripts/import-library.mjs --file data/openlibrary.jsonl --format jsonl --dry-run --checkpoint data/ol-dry.checkpoint.json
node --env-file=.env.local scripts/import-library.mjs --file data/openlibrary.jsonl --format jsonl --limit 2000000 --checkpoint data/ol-live.checkpoint.json
```

The adapter joins authors through a disk-backed SQLite index; it doesn't keep millions of author names in RAM. Works without resolved author names are skipped. It reports truncation of descriptions/long titles/authors to ShelfChat's documented bounds. Output creation uses `wx` to avoid overwriting an earlier export. Reuse the author index by omitting `--authors`. Tags come from source subjects or the explicitly curated title/author list. Exact matching is conservative: BookTok is never assigned automatically to every fantasy or romance book.

## Serving and reading

`GET /api/catalog` returns at most 48 rows (24 by default), total catalog count, and an opaque next cursor. Filters: `q`, `category`, `format`, `tag`, `availability`; sorts: `newest`, `popular`, `title`. Search uses a GIN-backed PostgreSQL text index with word-based search semantics defined by `websearch_to_tsquery`, not a two-million-row client filter. Cursors use indexed `(sort_column,id)` comparisons; there is no deep OFFSET. Cursors are tied to the active search. Changing download counts can move a book during a popularity walk; pagination is live, not a frozen export snapshot.

The heartbeat no longer transmits the catalog, global download maps, or all notes. Book detail requests query an ID directly and retrieve up to 100 recent marginalia notes. Visible catalog pages refresh every 30 seconds and detail notes every 10 seconds. Metadata-only titles participate in search and community discussion. The SQLite server is the lightweight local development mode; the large catalog runs on Neon.

`GET /api/books/:id/read?format=EPUB|PDF` resolves an authorized edition without incrementing downloads. Files go directly from their source/Blob URLs to the browser. EPUB ZIPs must be fetched before rendering (they do not support true page-by-page network streaming); downloads are canceled on close and capped at 40 MB compressed / 150 MB expanded / 10,000 ZIP members. The EPUB reader is lazy-loaded, scripts are disabled in sandboxed frames, and it supports contents, page/section navigation, scroll mode, text sizing and local progress. Identity storage is untouched. PDFs use the browser's embedded viewer with a persistent download fallback. External providers can block CORS, frame embedding or inline PDF display; such editions remain downloadable when their source permits it. A bounded provider-only stream serves EPUBs whose hosts block browser fetches; there is no arbitrary-URL proxy.
