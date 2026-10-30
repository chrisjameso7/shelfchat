import { probeEdition } from "../cloud/file-verification.js";
import { randomUUID } from "node:crypto";
import { getDownloadUrl } from "@vercel/blob";
import { database, snapshot, rateLimit } from "../cloud/db.js";
import { noteInput } from "../server/validation.js";
import { resolveEditionDownload } from "../cloud/download-source.js";
import { catalogPage, PUBLIC_BOOK } from "../cloud/catalog.js";
import { FEATURED_IDS } from "../shared/featured.js";
import { waitUntil } from "@vercel/functions";
import { claimLookup, performLookup } from "../cloud/jit-search.js";
import { canStreamSource, streamEpub } from "../cloud/epub-stream.js";
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function problem(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}
async function body(req, maxBytes = 16384) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > maxBytes)
      throw problem("Request is too large.", 413);
    return req.body;
  }
  const bytes = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw problem("Request is too large.", 413);
    bytes.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(bytes).toString() || "{}");
  } catch {
    throw problem("Invalid JSON request.");
  }
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const url = new URL(req.url, "https://shelfchat.app");
  const route = String(
    req.query?.route ||
      url.searchParams.get("route") ||
      url.pathname.replace(/^\/api\/?/, ""),
  ).replace(/^\/+|\/+$/g, "");
  try {
    if (req.method === "GET" && route === "config")
      return json(res, 200, { transport: "poll", uploads: "review-links" });
    if (
      req.method === "POST" &&
      ["admin/import", "admin/catalog-maintenance"].includes(route)
    ) {
      const { authorizeImport, commitImport } = await import(
        "../cloud/admin-import.js"
      );
      if (!authorizeImport(req.headers.authorization))
        throw problem("Unauthorized import.", 401);
      const payload = await body(req, 512 * 1024);
      if (route === "admin/catalog-maintenance") {
        const { maintainCatalog } = await import(
          "../cloud/catalog-maintenance.js"
        );
        return json(res, 200, await maintainCatalog(database(), payload));
      }
      return json(res, 200, await commitImport(database(), payload.books));
    }
    if (req.method === "GET" && route === "cron/margins-cleanup") {
      const { cronAuthorized, PURGE_MARGINS } = await import(
        "../cloud/margins.js"
      );
      if (!cronAuthorized(req.headers.authorization))
        throw problem("Unauthorized cleanup.", 401);
      const sql = database();
      let removed = 0;
      for (let batch = 0; batch < 20; batch++) {
        const rows = await sql.query(PURGE_MARGINS, []);
        removed += rows.length;
        if (rows.length < 1000) break;
      }
      await sql.transaction([
        sql`DELETE FROM shelfchat_presence WHERE seen_at<now()-interval '10 minutes'`,
        sql`DELETE FROM shelfchat_rate_limits WHERE expires_at<now()`,
        sql`DELETE FROM shelfchat_reports WHERE id IN(SELECT id FROM shelfchat_reports WHERE expires_at<=now() LIMIT 1000)`,
      ]);
      return json(res, 200, { removed });
    }
    if (req.method === "POST" && route === "admin/moderation") {
      const { authorizeImport } = await import("../cloud/admin-import.js");
      if (!authorizeImport(req.headers.authorization))
        throw problem("Unauthorized moderation.", 401);
      const { moderate } = await import("../cloud/trust.js");
      return json(res, 200, await moderate(database(), await body(req)));
    }
    const sql = database();
    if (req.method === "GET" && route === "featured") {
      const books = await sql.query(
        `SELECT ${PUBLIC_BOOK} FROM shelfchat_books WHERE id=ANY($1::text[]) AND NOT is_hidden AND availability='downloadable' ORDER BY array_position($1::text[],id)`,
        [FEATURED_IDS],
      );
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=60");
      return json(res, 200, { books });
    }
    if (req.method === "POST" && route === "reports") {
      await rateLimit(sql, req);
      const { createReport, reporterHash } = await import("../cloud/trust.js");
      return json(
        res,
        202,
        await createReport(sql, await body(req), reporterHash(req)),
      );
    }
    if (req.method === "POST" && route === "submissions") {
      await rateLimit(sql, req);
      const { createSubmission } = await import("../cloud/trust.js");
      return json(res, 201, await createSubmission(sql, await body(req)));
    }
    const submissionRoute = route.match(/^submissions\/([a-f0-9-]{36})$/i);
    if (req.method === "GET" && submissionRoute) {
      const { ownSubmission } = await import("../cloud/trust.js");
      return json(
        res,
        200,
        await ownSubmission(sql, submissionRoute[1], req.headers.authorization),
      );
    }
    if (req.method === "GET" && route === "collections") {
      const [tags, categories] = await Promise.all([
        sql.query(
          "SELECT tag,count(*)::integer AS count FROM shelfchat_books b CROSS JOIN LATERAL unnest(b.tags) tag WHERE NOT is_hidden AND availability='downloadable' GROUP BY tag HAVING count(*)>0 ORDER BY tag LIMIT 150",
          [],
        ),
        sql.query(
          "SELECT category,count(*)::integer AS count FROM shelfchat_books WHERE NOT is_hidden AND availability='downloadable' GROUP BY category ORDER BY category",
          [],
        ),
      ]);
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=300, stale-while-revalidate=600",
      );
      return json(res, 200, { tags, categories });
    }
    if (route === "margins") {
      const { marginsFeed, createMargin } = await import("../cloud/margins.js");
      if (req.method === "GET")
        return json(
          res,
          200,
          await marginsFeed(sql, url.searchParams.get("cursor")),
        );
      if (req.method === "POST") {
        await rateLimit(sql, req);
        return json(res, 201, await createMargin(sql, await body(req)));
      }
      throw problem("Method not allowed.", 405);
    }
    if (req.method === "GET" && route === "catalog") {
      const result = await catalogPage(sql, url.searchParams);
      const q = (url.searchParams.get("q") || "").trim();
      if (
        !result.books.length &&
        q.length >= 4 &&
        !url.searchParams.get("cursor") &&
        !url.searchParams.get("tag") &&
        !url.searchParams.get("vibe") &&
        process.env.CATALOG_LOOKUPS_ENABLED !== "0"
      ) {
        const lookup = await claimLookup(sql, q, {
          beforeClaim: () => rateLimit(sql, req),
        });
        if (lookup?.dispatch)
          waitUntil(
            performLookup(sql, lookup).catch(() =>
              console.warn("Catalog background lookup failed"),
            ),
          );
        if (lookup)
          result.lookup = {
            status: lookup.status,
            retryAfterMs: lookup.retryAfterMs,
          };
      }
      if (!result.lookup)
        res.setHeader(
          "Cache-Control",
          "public, s-maxage=15, stale-while-revalidate=30",
        );
      return json(res, 200, result);
    }
    const detail = route.match(/^books\/([^/]+)$/);
    if (req.method === "GET" && detail) {
      const [book] = await sql.query(
        `SELECT ${PUBLIC_BOOK} FROM shelfchat_books WHERE id=$1 AND NOT is_hidden`,
        [detail[1]],
      );
      if (!book) throw problem("Book not found.", 404);
      const notes =
        await sql`SELECT id,book_id AS "bookId",handle,tag,text,created_at AS "createdAt" FROM shelfchat_notes WHERE book_id=${detail[1]} ORDER BY created_at DESC LIMIT 100`;
      return json(res, 200, { book, notes });
    }
    const stream = route.match(/^books\/([^/]+)\/stream$/);
    if (req.method === "GET" && stream) {
      await rateLimit(sql, req);
      const [book] =
        await sql`SELECT format,url,size,editions,availability FROM shelfchat_books WHERE id=${stream[1]} AND NOT is_hidden`;
      if (!book || book.availability !== "downloadable")
        throw problem("Reading edition not found.", 404);
      const edition =
        book.editions.EPUB ||
        (book.format === "EPUB"
          ? { url: book.url, size: Number(book.size) }
          : null);
      if (!edition || !canStreamSource(edition.url))
        throw problem("This edition cannot use the reading stream.", 404);
      return await streamEpub(res, edition);
    }
    const read = route.match(/^books\/([^/]+)\/read$/);
    if (req.method === "GET" && read) {
      await rateLimit(sql, req);
      const [book] =
        await sql`SELECT format,url,editions,availability FROM shelfchat_books WHERE id=${read[1]} AND NOT is_hidden`;
      if (!book) throw problem("Book not found.", 404);
      if (book.availability !== "downloadable")
        throw problem("No authorized reading edition is available.", 404);
      const format = url.searchParams.get("format") || book.format;
      if (
        !["EPUB", "PDF"].includes(format) ||
        (format !== book.format && !book.editions[format])
      )
        throw problem("Format not available.", 404);
      const edition = book.editions[format] || { url: book.url };
      if (format === "EPUB" && canStreamSource(edition.url))
        return json(res, 200, {
          url: `/api/books/${encodeURIComponent(read[1])}/stream`,
          format,
          size: edition.size || 0,
        });
      const source = await resolveEditionDownload(edition, format);
      const inline = new URL(source);
      inline.searchParams.delete("download");
      return json(res, 200, {
        url: inline.href,
        format,
        size: edition.size || 0,
      });
    }
    if (req.method === "GET" && route === "health") {
      await sql`SELECT 1`;
      return json(res, 200, { ok: true, storage: "neon+blob" });
    }
    if (req.method === "GET" && route === "snapshot")
      return json(
        res,
        200,
        await snapshot(
          sql,
          url.searchParams.get("visitor"),
          url.searchParams.get("catalogVersion"),
        ),
      );
    if (
      req.method === "POST" &&
      ["uploads/token", "uploads/prepare"].includes(route)
    )
      throw problem(
        "Private file submissions are not configured. Submit a source link for review.",
        503,
      );
    if (req.method === "POST") {
      await rateLimit(sql, req);
      const b = await body(req);
      if (route === "books")
        throw problem(
          "Use the submission form. New books require review.",
          410,
        );
      const noteRoute = route.match(/^books\/([^/]+)\/notes$/);
      if (noteRoute) {
        const n = noteInput(b);
        const id = randomUUID();
        const result =
          await sql`WITH inserted AS (INSERT INTO shelfchat_notes(id,book_id,handle,tag,text) SELECT ${id},id,${n.handle},${n.tag},${n.text} FROM shelfchat_books WHERE id=${noteRoute[1]} AND NOT is_hidden RETURNING id) SELECT id FROM inserted`;
        if (!result.length) throw problem("Book not found.", 404);
        return json(res, 201, { id });
      }
    }
    const download = route.match(/^books\/([^/]+)\/download$/);
    if (req.method === "GET" && download) {
      await rateLimit(sql, req);
      const requested = url.searchParams.get("format");
      if (requested && !["PDF", "EPUB"].includes(requested))
        throw problem("Choose PDF or EPUB.");
      const [book] =
        await sql`SELECT id,title,format,url,editions,source_url,availability FROM shelfchat_books WHERE id=${download[1]} AND NOT is_hidden`;
      if (!book) throw problem("Book not found.", 404);
      if (book.availability !== "downloadable")
        throw problem("No authorized download is available.", 404);
      if (requested && requested !== book.format && !book.editions[requested])
        throw problem("Format not available.", 404);
      const kind = requested || book.format;
      const edition = book.editions[kind] || { url: book.url };
      const destination = await resolveEditionDownload(edition, kind);
      await sql`WITH updated AS (UPDATE shelfchat_books SET downloads=downloads+1 WHERE id=${book.id} RETURNING title) INSERT INTO shelfchat_activity(message) SELECT 'A reader picked up '||title FROM updated`;
      res.statusCode = 302;
      const target = new URL(destination);
      res.setHeader(
        "Location",
        target.hostname === process.env.BLOB_STORE_HOSTNAME
          ? getDownloadUrl(target.href)
          : target.href,
      );
      return res.end();
    }
    return json(res, 404, { error: "Endpoint not found." });
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    console.error(
      "ShelfChat API error:",
      error.status ? error.message : "Backend operation failed",
    );
    return json(res, error.status || 500, {
      error: error.status
        ? error.message
        : "The reading room is temporarily unavailable. Please try again.",
    });
  }
}
