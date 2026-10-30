import { createHash, timingSafeEqual } from "node:crypto";
import { normalize, insertBatch } from "../scripts/import-library.mjs";
import { isLiterary } from "../shared/library-scope.js";
export function authorizeImport(
  header,
  verifier = process.env.CATALOG_IMPORT_TOKEN_SHA256,
) {
  if (
    !/^[a-f0-9]{64}$/.test(verifier || "") ||
    !/^Bearer [a-f0-9]{64}$/.test(header || "")
  )
    return false;
  return timingSafeEqual(
    createHash("sha256").update(header.slice(7)).digest(),
    Buffer.from(verifier, "hex"),
  );
}
export function importRecords(input) {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    throw Object.assign(Error("Supply 1–100 book records."), { status: 400 });
  return input.map((raw) => {
    const b = normalize(raw);
    const source = new URL(b.sourceUrl || "https://invalid.invalid");
    const provider = ["www.gutenberg.org", "gutenberg.org"].includes(
      source.hostname,
    )
      ? "gutenberg"
      : source.hostname === "archive.org"
        ? "archive"
        : null;
    if (
      !provider ||
      b.rights !== "public-domain" ||
      b.availability !== "downloadable"
    )
      throw Object.assign(
        Error(
          "Import accepts attributable public-domain reading editions only.",
        ),
        { status: 400 },
      );
    for (const edition of Object.values(b.editions))
      for (const link of [edition.url, ...(edition.fallbackUrls || [])]) {
        const host = new URL(link).hostname;
        if (
          provider === "gutenberg"
            ? !["www.gutenberg.org", "gutenberg.org"].includes(host)
            : !(
                host === "archive.org" ||
                /^(?:ia|dn)\d+[a-z0-9.-]*\.archive\.org$/.test(host)
              )
        )
          throw Object.assign(
            Error("Edition host does not match the approved provider."),
            { status: 400 },
          );
      }
    return b;
  });
}
export async function commitImport(sql, input) {
  const books = importRecords(input).filter(isLiterary);
  if (!books.length) return { committed: 0, skipped: input.length };
  const [usage] = await sql.query(
    "SELECT pg_database_size(current_database())::float8 AS bytes, (SELECT book_count::float8 FROM shelfchat_catalog_stats WHERE id=true) AS count",
    [],
  );
  if (
    Number(usage.bytes) + Buffer.byteLength(JSON.stringify(books)) * 3 >
      750_000_000 ||
    Number(usage.count) + books.length > 75000
  )
    throw Object.assign(
      Error(
        "Import capacity reached. Review storage and catalog target before continuing.",
      ),
      { status: 409 },
    );
  const query = insertBatch(books);
  await sql.query(query.text, query.values);
  const [after] = await sql.query(
    "SELECT book_count::float8 AS count FROM shelfchat_catalog_stats WHERE id=true",
    [],
  );
  return { committed: books.length, total: Number(after.count) };
}
