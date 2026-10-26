import { randomUUID } from "node:crypto";
import { head, getDownloadUrl } from "@vercel/blob";
import { handleUpload } from "@vercel/blob/client";
import { database, snapshot, rateLimit } from "../cloud/db.js";
import { clean, safeUrl, noteInput } from "../server/validation.js";
import { resolveEditionDownload } from "../cloud/download-source.js";
import { catalogPage, PUBLIC_BOOK } from "../cloud/catalog.js";
import { waitUntil } from "@vercel/functions";
import { claimLookup, performLookup } from "../cloud/jit-search.js";
import { canStreamSource, streamEpub } from "../cloud/epub-stream.js";
const MAX = 25 * 1024 * 1024;
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
async function body(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body))
    return req.body;
  const bytes = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw problem("Request is too large.", 413);
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
      return json(res, 200, { transport: "poll", uploads: "blob" });
    const sql = database();
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
      return json(res, 200, result);
    }
    const detail = route.match(/^books\/([^/]+)$/);
    if (req.method === "GET" && detail) {
      const [book] = await sql.query(
        `SELECT ${PUBLIC_BOOK} FROM shelfchat_books WHERE id=$1`,
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
        await sql`SELECT format,url,size,editions,availability FROM shelfchat_books WHERE id=${stream[1]}`;
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
        await sql`SELECT format,url,editions,availability FROM shelfchat_books WHERE id=${read[1]}`;
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
    if (req.method === "POST" && route === "uploads/token") {
      const b = await body(req);
      const response = await handleUpload({
        request: req,
        body: b,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          await rateLimit(sql, req);
          const intent = JSON.parse(clientPayload || "{}");
          if (!/^[0-9a-f-]{36}$/i.test(intent.id))
            throw problem("Invalid upload request.");
          const rows =
            await sql`UPDATE shelfchat_uploads SET issued=true WHERE id=${intent.id} AND pathname=${pathname} AND issued=false AND consumed=false AND expires_at>now() RETURNING size`;
          if (!rows.length)
            throw problem(
              "Upload request expired. Please choose the file again.",
            );
          return {
            allowedContentTypes: [
              "application/pdf",
              "application/epub+zip",
              "application/octet-stream",
            ],
            maximumSizeInBytes: Math.min(MAX, Number(rows[0].size)),
            addRandomSuffix: false,
            allowOverwrite: false,
            validUntil: Date.now() + 10 * 60 * 1000,
            tokenPayload: JSON.stringify({ id: intent.id }),
          };
        },
        onUploadCompleted: async () => {},
      });
      return json(res, 200, response);
    }
    if (req.method === "POST") {
      await rateLimit(sql, req);
      const b = await body(req);
      if (route === "uploads/prepare") {
        if (b.rights !== true)
          throw problem("Confirm you have permission to share this book.");
        const filename = clean(b.filename, 1, 200, "Filename");
        const format = /\.pdf$/i.test(filename)
          ? "PDF"
          : /\.epub$/i.test(filename)
            ? "EPUB"
            : null;
        if (!format) throw problem("Only PDF and EPUB files are accepted.");
        if (!Number.isInteger(b.size) || b.size < 1 || b.size > MAX)
          throw problem("Maximum file size is 25 MB.");
        const id = randomUUID();
        const pathname = `books/${id}.${format.toLowerCase()}`;
        await sql`INSERT INTO shelfchat_uploads(id,pathname,format,size) VALUES(${id},${pathname},${format},${b.size})`;
        return json(res, 201, { id, pathname });
      }
      if (route === "books") {
        const title = clean(b.title, 1, 150, "Title"),
          author = clean(b.author, 1, 100, "Author");
        if (
          !["Fiction", "Philosophy", "Poetry", "Essays", "Nonfiction"].includes(
            b.category,
          )
        )
          throw problem("Choose a valid category.");
        if (b.rights !== true)
          throw problem("Confirm you have permission to share this book.");
        const description = b.description
          ? clean(b.description, 1, 1200, "Description")
          : "";
        let format = b.format,
          size = 0,
          fileUrl;
        if (b.uploadId) {
          if (!/^[0-9a-f-]{36}$/i.test(b.uploadId))
            throw problem("Invalid upload.");
          const [intent] =
            await sql`SELECT * FROM shelfchat_uploads WHERE id=${b.uploadId} AND consumed=false AND issued=true AND expires_at>now()`;
          if (!intent)
            throw problem("Upload request expired. Please upload again.");
          const uploadUrl = new URL(String(b.blobUrl));
          if (
            uploadUrl.protocol !== "https:" ||
            uploadUrl.hostname !== process.env.BLOB_STORE_HOSTNAME ||
            decodeURIComponent(uploadUrl.pathname) !== "/" + intent.pathname
          )
            throw problem("Unrecognized file URL.");
          const info = await head(uploadUrl.href);
          if (
            info.pathname !== intent.pathname ||
            info.size !== Number(intent.size) ||
            info.size > MAX
          )
            throw problem("Uploaded file size does not match.");
          const fileResponse = await fetch(uploadUrl.href, {
            headers: { Range: "bytes=0-4095" },
            signal: AbortSignal.timeout(15000),
          });
          if (!fileResponse.ok)
            throw problem("Could not validate the uploaded file.");
          const stream = fileResponse.body.getReader();
          const first = await stream.read();
          await stream.cancel();
          const prefix = Buffer.from(first.value || []);
          format = intent.format;
          if (
            format === "PDF" &&
            !prefix.subarray(0, 5).equals(Buffer.from("%PDF-"))
          )
            throw problem("This is not a valid PDF.");
          if (
            format === "EPUB" &&
            (!prefix.subarray(0, 2).equals(Buffer.from("PK")) ||
              !prefix.includes(Buffer.from("application/epub+zip")))
          )
            throw problem("This is not a valid EPUB.");
          fileUrl = uploadUrl.href;
          size = info.size;
        } else {
          fileUrl = safeUrl(b.url);
          if (!["PDF", "EPUB"].includes(format))
            throw problem("Choose PDF or EPUB.");
        }
        const id = b.uploadId || randomUUID();
        const insert = b.uploadId
          ? sql`WITH claimed AS (UPDATE shelfchat_uploads SET consumed=true WHERE id=${b.uploadId} AND consumed=false RETURNING id) INSERT INTO shelfchat_books(id,title,author,category,format,size,description,url) SELECT ${id},${title},${author},${b.category},${format},${size},${description},${fileUrl} FROM claimed RETURNING id`
          : sql`INSERT INTO shelfchat_books(id,title,author,category,format,size,description,url) VALUES(${id},${title},${author},${b.category},${format},${size},${description},${fileUrl}) RETURNING id`;
        const [rows] = await sql.transaction([
          insert,
          sql`INSERT INTO shelfchat_activity(message) VALUES(${`A reader added ${title}`})`,
        ]);
        if (!rows.length)
          throw problem("This upload has already been added.", 409);
        return json(res, 201, { id });
      }
      const noteRoute = route.match(/^books\/([^/]+)\/notes$/);
      if (noteRoute) {
        const n = noteInput(b);
        const id = randomUUID();
        const result =
          await sql`WITH inserted AS (INSERT INTO shelfchat_notes(id,book_id,handle,tag,text) SELECT ${id},id,${n.handle},${n.tag},${n.text} FROM shelfchat_books WHERE id=${noteRoute[1]} RETURNING id) INSERT INTO shelfchat_activity(message) SELECT ${`@${n.handle} left a note in the margins`} FROM inserted RETURNING id`;
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
        await sql`SELECT id,title,format,url,editions,source_url,availability FROM shelfchat_books WHERE id=${download[1]}`;
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
