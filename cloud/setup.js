import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { database } from "./db.js";
const sql = database();
const existing =
  await sql`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
console.log(
  "Inspected existing schema:",
  existing.map((r) => r.tablename).join(", ") || "(empty)",
);
const statements = readFileSync(
  new URL("./schema.sql", import.meta.url),
  "utf8",
)
  .split("-- statement")
  .map((x) => x.trim())
  .filter(Boolean);
await sql.transaction(statements.map((text) => sql.query(text, [])));
const checks =
  await sql`SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'shelfchat_%'`;
if (checks.some((r) => !r.rowsecurity))
  throw new Error("RLS verification failed.");
console.log(
  "ShelfChat database ready. RLS enabled on",
  checks.length,
  "tables.",
);
const archiveFile = new URL("./archive-books.json", import.meta.url);
if (existsSync(archiveFile)) {
  const manifest = JSON.parse(readFileSync(archiveFile, "utf8"));
  if (manifest.books.length !== 1000)
    throw new Error("The archive import must contain exactly 1000 books.");
  const added =
    await sql`INSERT INTO shelfchat_books(id,title,author,category,format,size,description,url,editions,source_url,license_url,published_year,created_at)
 SELECT item->>'id',item->>'title',item->>'author',item->>'category',item->>'format',(item->>'size')::bigint,item->>'description',item->'editions'->'EPUB'->>'url',item->'editions',item->>'sourceUrl',item->>'licenseUrl',(item->>'publishedYear')::integer,${manifest.retrievedAt}::timestamptz-ordinality*interval '1 second'
 FROM jsonb_array_elements(${JSON.stringify(manifest.books)}::jsonb) WITH ORDINALITY AS data(item,ordinality)
 ON CONFLICT(id) DO NOTHING RETURNING id`;
  const [verified] =
    await sql`SELECT count(*)::integer AS count FROM shelfchat_books WHERE id IN (SELECT item->>'id' FROM jsonb_array_elements(${JSON.stringify(manifest.books.map((b) => ({ id: b.id })))}::jsonb) item) AND editions ? 'PDF' AND editions ? 'EPUB'`;
  if (verified.count !== 1000)
    throw new Error("Archive import verification failed.");
  console.log(
    `Archive verified: 1000 books, 2000 PDF/EPUB files; ${added.length} new books added.`,
  );
}

const retired = JSON.parse(
  readFileSync(new URL("./editorial-tags.json", import.meta.url), "utf8"),
);
for (const b of retired)
  await sql`DELETE FROM shelfchat_books WHERE id=${b.id} AND availability='discovery' AND source_url=${"https://openlibrary.org/search?q=" + encodeURIComponent(b.title + " " + b.author)}`;
await sql`DELETE FROM shelfchat_activity a USING shelfchat_notes n WHERE n.book_id='88fcbbbe-971b-43c7-9c88-fb977235d210' AND a.message='@'||n.handle||' left a note in the margins' AND abs(extract(epoch FROM(a.created_at-n.created_at)))<5`;
await sql`DELETE FROM shelfchat_books WHERE id='88fcbbbe-971b-43c7-9c88-fb977235d210' AND title='A Note from the Reading Room' AND author='ShelfChat'`;
await sql`DELETE FROM shelfchat_activity WHERE message IN ('A reader added A Note from the Reading Room','A reader picked up A Note from the Reading Room')`;
const { catalogPage } = await import("./catalog.js");
const page = await catalogPage(
  sql,
  new URLSearchParams({ availability: "downloadable", limit: "2" }),
);
if (
  page.books.length !== 2 ||
  !page.nextCursor ||
  page.books.some((b) => b.availability !== "downloadable")
)
  throw Error("Readable catalog verification failed.");
const next = await catalogPage(
  sql,
  new URLSearchParams({
    availability: "downloadable",
    limit: "2",
    cursor: page.nextCursor,
  }),
);
const combined = await catalogPage(
  sql,
  new URLSearchParams({ availability: "downloadable", limit: "4" }),
);
if (
  JSON.stringify([...page.books, ...next.books].map((b) => b.id)) !==
  JSON.stringify(combined.books.map((b) => b.id))
)
  throw Error("Catalog cursor skipped records with equal timestamps.");
if (next.books.some((b) => page.books.some((a) => a.id === b.id)))
  throw Error("Catalog cursor returned duplicate rows.");
const search = await catalogPage(
  sql,
  new URLSearchParams({
    q: page.books[0].title
      .match(/[\p{L}\p{N}]+/gu)
      .slice(0, 3)
      .join(" "),
    availability: "downloadable",
  }),
);
if (!search.books.some((b) => b.id === page.books[0].id))
  throw Error("Indexed catalog search verification failed.");
console.log(
  "Neon search, cursor pagination, readable availability and catalog count verified:",
  page.total,
);
const { storageReport } = await import("./storage-report.js");
console.log(
  "ShelfChat storage estimate:",
  JSON.stringify(await storageReport(sql)),
);

const { claimLookup, lookupIdentity, sourceSlot } = await import(
  "./jit-search.js"
);
await sourceSlot(sql, "https://www.gutenberg.org/", AbortSignal.timeout(5000));
console.log("Neon provider request gate verified.");
const diagnostic = "ShelfChat lookup coordination " + randomUUID();
try {
  const claims = await Promise.all([
    claimLookup(sql, diagnostic),
    claimLookup(sql, diagnostic),
  ]);
  if (claims.filter((c) => c.dispatch).length !== 1)
    throw Error("Search lookup claims were not deduplicated.");
  console.log("Neon lookup lease coalescing verified.");
} finally {
  await sql`DELETE FROM shelfchat_search_jobs WHERE key=${lookupIdentity(diagnostic).key}`;
}

// Build-time checks use already-expired rows inside one transaction; no demo posts enter the feed.
const marginProbeId = randomUUID();
const [, removedMargins] = await sql.transaction([
  sql`INSERT INTO shelfchat_margins(id,handle,tag,text,created_at,expires_at) VALUES(${marginProbeId},'schema_probe','test','Expired lifecycle verification',now()-interval '73 hours',now()-interval '1 hour')`,
  sql`DELETE FROM shelfchat_margins WHERE id=${marginProbeId} AND expires_at<=now() RETURNING id`,
]);
if (!removedMargins.some((row) => row.id === marginProbeId))
  throw Error("Margins expiry purge failed.");
try {
  await sql`INSERT INTO shelfchat_margins(id,handle,tag,text,expires_at) VALUES(${randomUUID()},'schema_probe','test','Invalid lifecycle verification',now()+interval '74 hours')`;
  throw Error("Margins lifecycle constraint did not reject a custom expiry.");
} catch (error) {
  if (error.code !== "23514") throw error;
}
console.log("Margins 72-hour database constraint and expiry cleanup verified.");

// Exercise the real posting/upsert SQL without leaving test content in the public feed.
const { createMargin } = await import("./margins.js");
const postProbeId = randomUUID(),
  postQueries = [];
const capturePosts = {
  query: async (text, values) => {
    postQueries.push(sql.query(text, values));
    return [{ id: values[0] }];
  },
};
const probePost = {
  requestId: postProbeId,
  handle: "posting_probe",
  tag: "test",
  text: "Posting transaction verification",
};
await createMargin(capturePosts, probePost);
await createMargin(capturePosts, probePost);
const [firstPost, repeatedPost] = await sql.transaction([
  ...postQueries,
  sql`DELETE FROM shelfchat_margins WHERE id=${postProbeId} RETURNING id`,
]);
if (
  firstPost[0].id !== repeatedPost[0].id ||
  new Date(firstPost[0].expiresAt).getTime() !==
    new Date(repeatedPost[0].expiresAt).getTime()
)
  throw Error("Margin retries were not idempotent.");
console.log(
  "Production margin posting and retry SQL verified without visible test posts.",
);
