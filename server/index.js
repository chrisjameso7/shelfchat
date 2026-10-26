import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clean, safeUrl, noteInput } from "./validation.js";
import { seed } from "./seed.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
mkdirSync(path.join(dataDir, "files"), { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "shelfchat.sqlite"));
db.exec(
  `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL,category TEXT NOT NULL,format TEXT NOT NULL,size INTEGER NOT NULL DEFAULT 0,downloads INTEGER NOT NULL DEFAULT 0,description TEXT NOT NULL,createdAt TEXT NOT NULL,url TEXT,file TEXT); CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,bookId TEXT NOT NULL REFERENCES books(id),handle TEXT NOT NULL,tag TEXT NOT NULL,text TEXT NOT NULL,createdAt TEXT NOT NULL); CREATE INDEX IF NOT EXISTS notes_book ON notes(bookId,createdAt); CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY,message TEXT NOT NULL,createdAt TEXT NOT NULL);`,
);
const insert = db.prepare(
  "INSERT INTO books(id,title,author,category,format,size,description,createdAt,url,file) VALUES(?,?,?,?,?,?,?,?,?,?)",
);
const columns = db
  .prepare("PRAGMA table_info(books)")
  .all()
  .map((c) => c.name);
for (const [column, type] of Object.entries({
  tags: "TEXT NOT NULL DEFAULT '[]'",
  availability: "TEXT NOT NULL DEFAULT 'downloadable'",
  editions: "TEXT NOT NULL DEFAULT '{}'",
  source_url: "TEXT",
  license_url: "TEXT",
  published_year: "INTEGER",
}))
  if (!columns.includes(column))
    db.exec(`ALTER TABLE books ADD COLUMN ${column} ${type}`);
if (!db.prepare("SELECT id FROM books LIMIT 1").get())
  for (const [index, b] of seed.entries())
    insert.run(
      b[0],
      b[1],
      b[2],
      b[3],
      "EPUB",
      0,
      b[6],
      new Date(Date.now() - index * 60000).toISOString(),
      b[5],
      null,
    );
const archiveFile = path.join(root, "cloud", "archive-books.json");
if (
  process.env.SHELFCHAT_SKIP_ARCHIVE_IMPORT !== "1" &&
  existsSync(archiveFile)
) {
  const manifest = JSON.parse(readFileSync(archiveFile, "utf8"));
  const imported = db.prepare(
    "INSERT OR IGNORE INTO books(id,title,author,category,format,size,description,createdAt,url,file,editions,source_url,license_url,published_year) VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)",
  );
  for (const [index, b] of manifest.books.entries())
    imported.run(
      b.id,
      b.title,
      b.author,
      b.category,
      b.format,
      b.size,
      b.description,
      new Date(
        new Date(manifest.retrievedAt).getTime() - index * 1000,
      ).toISOString(),
      b.editions.EPUB.url,
      JSON.stringify(b.editions),
      b.sourceUrl,
      b.licenseUrl,
      b.publishedYear,
    );
}
if (process.env.SHELFCHAT_SKIP_ARCHIVE_IMPORT !== "1") {
  const discovery = JSON.parse(
    readFileSync(path.join(root, "cloud", "discovery-books.json"), "utf8"),
  );
  const add = db.prepare(
    "INSERT OR IGNORE INTO books(id,title,author,category,format,size,description,createdAt,url,availability,tags,source_url) VALUES(?,?,?,?,'EPUB',0,'',?,NULL,'discovery',?,?)",
  );
  for (const b of discovery)
    add.run(
      b.id,
      b.title,
      b.author,
      b.category,
      new Date().toISOString(),
      JSON.stringify(b.tags),
      "https://openlibrary.org/search?q=" +
        encodeURIComponent(b.title + " " + b.author),
    );
}
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY)
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'"],
        "connect-src": ["'self'", "https:", "blob:"],
        "frame-src": ["'self'", "https:", "blob:"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "upgrade-insecure-requests":
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  }),
);
app.use(express.json({ limit: "12kb" }));
const writes = rateLimit({
  windowMs: 60000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "A little too fast. Please try again in a minute." },
});
const uploads = multer({
  dest: path.join(dataDir, "files"),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (!/\.(pdf|epub)$/i.test(file.originalname))
      return cb(new Error("Only PDF and EPUB files are accepted."));
    cb(null, true);
  },
});
const clients = new Set();
const snapshot = () => ({
  books: db
    .prepare(
      "SELECT id,title,author,category,format,size,downloads,description,createdAt,editions,source_url AS sourceUrl,license_url AS licenseUrl,published_year AS publishedYear FROM books ORDER BY createdAt DESC",
    )
    .all()
    .map((b) => ({
      ...b,
      editions: Object.fromEntries(
        Object.entries(JSON.parse(b.editions)).map(([kind, value]) => [
          kind,
          { size: value.size },
        ]),
      ),
    })),
  notes: db
    .prepare("SELECT * FROM notes ORDER BY createdAt DESC LIMIT 2000")
    .all(),
  activity: db
    .prepare("SELECT * FROM activity ORDER BY createdAt DESC LIMIT 12")
    .all(),
  online: clients.size,
});
function broadcast() {
  const message = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(message);
}
function activity(message) {
  db.prepare("INSERT INTO activity VALUES(?,?,?)").run(
    randomUUID(),
    message,
    new Date().toISOString(),
  );
  db.exec(
    "DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY createdAt DESC LIMIT 100)",
  );
  broadcast();
}
app.get("/api/config", (_req, res) =>
  res.json({ transport: "sse", uploads: "local" }),
);
function publicBook(b) {
  if (!b) return null;
  const { url, file, source_url, license_url, published_year, ...safe } = b;
  return {
    ...safe,
    sourceUrl: source_url,
    licenseUrl: license_url,
    publishedYear: published_year,
    tags: JSON.parse(b.tags),
    editions: Object.fromEntries(
      Object.entries(JSON.parse(b.editions)).map(([k, v]) => [
        k,
        { size: v.size },
      ]),
    ),
  };
}
app.get("/api/catalog", (req, res, next) => {
  try {
    const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 24));
    const sorts = {
      newest: ["createdAt", "DESC"],
      title: ["lower(title)", "ASC"],
      popular: ["downloads", "DESC"],
    };
    const [column, direction] = sorts[req.query.sort] || sorts.newest;
    const clauses = [],
      params = [];
    if (req.query.q) {
      clauses.push("(title LIKE ? OR author LIKE ? OR description LIKE ?)");
      params.push(
        ...Array(3).fill("%" + String(req.query.q).slice(0, 160) + "%"),
      );
    }
    if (req.query.category) {
      clauses.push("category=?");
      params.push(req.query.category);
    }
    if (req.query.format) {
      clauses.push(
        "availability='downloadable' AND (format=? OR json_type(editions,?) IS NOT NULL)",
      );
      params.push(req.query.format, "$." + req.query.format);
    }
    if (req.query.tag) {
      clauses.push("EXISTS(SELECT 1 FROM json_each(tags) WHERE value=?)");
      params.push(req.query.tag);
    }
    if (req.query.availability === "downloadable")
      clauses.push("availability='downloadable'");
    if (req.query.cursor) {
      const cursor = JSON.parse(Buffer.from(req.query.cursor, "base64url"));
      if (
        typeof cursor.id !== "string" ||
        !["string", "number"].includes(typeof cursor.value)
      )
        throw Error("Invalid cursor");
      clauses.push(`(${column},id) ${direction === "ASC" ? ">" : "<"} (?,?)`);
      params.push(cursor.value, cursor.id);
    }
    const rows = db
      .prepare(
        `SELECT *,${column} AS sortValue FROM books ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY ${column} ${direction},id ${direction} LIMIT ?`,
      )
      .all(...params, limit + 1);
    const last = rows[Math.min(limit, rows.length) - 1];
    res.json({
      books: rows.slice(0, limit).map(({ sortValue, ...b }) => publicBook(b)),
      total: db.prepare("SELECT count(*) AS count FROM books").get().count,
      nextCursor:
        rows.length > limit
          ? Buffer.from(
              JSON.stringify({ id: last.id, value: last.sortValue }),
            ).toString("base64url")
          : null,
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/books/:id", (req, res) => {
  const book = publicBook(
    db.prepare("SELECT * FROM books WHERE id=?").get(req.params.id),
  );
  if (!book) return res.status(404).json({ error: "Book not found." });
  res.json({
    book,
    notes: db
      .prepare(
        "SELECT * FROM notes WHERE bookId=? ORDER BY createdAt DESC LIMIT 100",
      )
      .all(req.params.id),
  });
});
app.get("/api/books/:id/read", writes, (req, res) => {
  const book = db.prepare("SELECT * FROM books WHERE id=?").get(req.params.id);
  if (!book || book.availability === "discovery")
    return res
      .status(404)
      .json({ error: "No authorized reading edition is available." });
  const format = req.query.format || book.format,
    editions = JSON.parse(book.editions);
  if (
    !["EPUB", "PDF"].includes(format) ||
    (format !== book.format && !editions[format])
  )
    return res.status(404).json({ error: "Format not available." });
  const url = book.file
    ? `/api/books/${book.id}/content`
    : editions[format]?.url || book.url;
  res.json({ url, format, size: editions[format]?.size || book.size });
});
app.get("/api/books/:id/content", (req, res) => {
  const book = db.prepare("SELECT * FROM books WHERE id=?").get(req.params.id);
  if (!book?.file) return res.status(404).json({ error: "File unavailable." });
  res.type(book.format === "PDF" ? "application/pdf" : "application/epub+zip");
  res.set("Content-Disposition", "inline");
  res.sendFile(path.join(dataDir, "files", book.file));
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/snapshot", (_req, res) => res.json(snapshot()));
app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  clients.add(res);
  broadcast();
  const keepAlive = setInterval(() => res.write(": heartbeat\n\n"), 25000);
  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(res);
    broadcast();
  });
});
app.post("/api/books", writes, uploads.single("file"), (req, res, next) => {
  try {
    const b = req.body;
    const title = clean(b.title, 1, 150, "Title");
    const author = clean(b.author, 1, 100, "Author");
    const category = clean(b.category, 1, 30, "Category");
    if (
      !["Fiction", "Philosophy", "Poetry", "Essays", "Nonfiction"].includes(
        category,
      )
    )
      throw new Error("Choose a valid category.");
    if (b.rights !== "on")
      throw new Error("Confirm you have permission to share this book.");
    if (!req.file && !b.url)
      throw new Error("Upload a file or provide a link.");
    let format = b.format;
    let url = null;
    if (req.file) {
      const bytes = readFileSync(req.file.path);
      format = req.file.originalname.toLowerCase().endsWith(".pdf")
        ? "PDF"
        : "EPUB";
      if (
        format === "PDF" &&
        !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
      )
        throw new Error("This is not a valid PDF.");
      if (
        format === "EPUB" &&
        (!bytes.subarray(0, 2).equals(Buffer.from("PK")) ||
          !bytes.includes(Buffer.from("application/epub+zip")))
      )
        throw new Error("This is not a valid EPUB.");
    } else {
      url = safeUrl(b.url);
      if (!["EPUB", "PDF"].includes(format))
        throw new Error("Choose PDF or EPUB.");
    }
    const description = b.description
      ? clean(b.description, 1, 1200, "Description")
      : "";
    const id = randomUUID();
    insert.run(
      id,
      title,
      author,
      category,
      format,
      req.file?.size || 0,
      description,
      new Date().toISOString(),
      url,
      req.file?.filename || null,
    );
    activity(`A reader added ${title}`);
    res.status(201).json({ id });
  } catch (e) {
    if (req.file) unlinkSync(req.file.path);
    next(e);
  }
});
app.post("/api/books/:id/notes", writes, (req, res, next) => {
  try {
    if (!db.prepare("SELECT id FROM books WHERE id=?").get(req.params.id))
      return res.status(404).json({ error: "Book not found." });
    const note = noteInput(req.body);
    const id = randomUUID();
    db.prepare("INSERT INTO notes VALUES(?,?,?,?,?,?)").run(
      id,
      req.params.id,
      note.handle,
      note.tag,
      note.text,
      new Date().toISOString(),
    );
    activity(`@${note.handle} left a note in the margins`);
    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
});
app.get("/api/books/:id/download", writes, (req, res) => {
  const book = db.prepare("SELECT * FROM books WHERE id=?").get(req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found." });
  if (book.availability === "discovery")
    return res
      .status(404)
      .json({ error: "No authorized download is available." });
  const edition = req.query.format;
  const variants = JSON.parse(book.editions);
  if (edition && edition !== book.format && !variants[edition])
    return res.status(404).json({ error: "Format not available." });
  const count = () => {
    db.prepare("UPDATE books SET downloads=downloads+1 WHERE id=?").run(
      book.id,
    );
    activity(`A reader picked up ${book.title}`);
  };
  if (book.file) {
    res.download(
      path.join(dataDir, "files", book.file),
      `${book.title.replace(/[^a-zA-Z0-9 _-]/g, "")}.${book.format.toLowerCase()}`,
      (e) => {
        if (!e) count();
        else if (!res.headersSent)
          res
            .status(500)
            .json({ error: "Download unavailable. Please try again." });
      },
    );
  } else {
    count();
    res.redirect(302, variants[edition]?.url || book.url);
  }
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Endpoint not found." }),
);
if (existsSync(path.join(root, "dist"))) {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(root, "dist", "index.html")),
  );
}
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(err instanceof multer.MulterError ? 413 : 400).json({
    error:
      err.code === "LIMIT_FILE_SIZE"
        ? "File is too large. Maximum size is 25 MB."
        : err.message || "Request failed.",
  });
});
const server = app.listen(Number(process.env.PORT) || 3001, "0.0.0.0", () =>
  console.log("ShelfChat API listening on " + (process.env.PORT || 3001)),
);
function shutdown() {
  for (const res of clients) res.end();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
