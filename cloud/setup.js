import { readFileSync, existsSync } from "node:fs";
import { database } from "./db.js";
import { seed } from "../server/seed.js";
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
for (const [index, b] of seed.entries())
  await sql`INSERT INTO shelfchat_books(id,title,author,category,format,description,url,created_at) VALUES(${b[0]},${b[1]},${b[2]},${b[3]},'EPUB',${b[6]},${b[5]},${new Date(Date.now() - index * 60000).toISOString()}) ON CONFLICT(id) DO NOTHING`;
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
