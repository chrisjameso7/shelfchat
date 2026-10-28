import { probeEdition } from "./file-verification.js";
export async function maintainCatalog(
  sql,
  payload,
  { probe = probeEdition } = {},
) {
  if (payload.action === "cleanup") {
    const removed = await sql.query(
      "DELETE FROM shelfchat_books WHERE availability='discovery' OR ((url IS NULL OR url='') AND editions='{}'::jsonb) RETURNING id",
      [],
    );
    return { removed: removed.length };
  }
  if (payload.action === "page") {
    const books = await sql.query(
      "SELECT id,format,url,editions,last_synced_at::text AS revision,created_at::text AS created FROM shelfchat_books WHERE id>$1 ORDER BY id LIMIT 10",
      [String(payload.cursor || "").slice(0, 180)],
    );
    return { books };
  }
  if (payload.action === "prune" && typeof payload.id === "string") {
    const [book] = await sql.query(
      "SELECT id,format,url,editions,last_synced_at::text AS revision,created_at::text AS created FROM shelfchat_books WHERE id=$1",
      [payload.id],
    );
    if (!book) return { removed: 0 };
    if (book.revision !== payload.revision || book.created !== payload.created)
      return { removed: 0, reason: "changed" };
    const editions = Object.keys(book.editions || {}).length
      ? book.editions
      : { [book.format]: { url: book.url } };
    for (const [format, file] of Object.entries(editions))
      if ((await probe(file, format)).status !== "invalid")
        return { removed: 0, reason: "readable-or-uncertain" };
    const removed = await sql.query(
      "DELETE FROM shelfchat_books WHERE id=$1 AND last_synced_at IS NOT DISTINCT FROM $2::timestamptz AND created_at=$3::timestamptz RETURNING id",
      [book.id, book.revision, book.created],
    );
    return { removed: removed.length };
  }
  throw Object.assign(Error("Unknown maintenance action"), { status: 400 });
}
