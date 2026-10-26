import { readFileSync } from "node:fs";
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
