// Offline bulk dump adapter. Never harvest Open Library's live API at scale.
import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { normalize } from "./import-library.mjs";
const { values } = parseArgs({
  options: {
    authors: { type: "string" },
    works: { type: "string" },
    index: { type: "string", default: "data/authors.sqlite" },
    output: { type: "string", default: "data/openlibrary.jsonl" },
    limit: { type: "string", default: "2000000" },
  },
});
if (!values.works)
  throw Error(
    "Usage: node scripts/prepare-openlibrary.mjs --authors authors.txt.gz --works works.txt.gz --output data/openlibrary.jsonl --limit 2000000",
  );
const limit = Number(values.limit);
if (!Number.isSafeInteger(limit) || limit < 1) throw Error("Invalid limit");
async function* dump(file) {
  const input = createReadStream(file);
  const source = file.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  for await (const line of createInterface({
    input: source,
    crlfDelay: Infinity,
  })) {
    const start = line.indexOf("\t{");
    if (start < 0) continue;
    try {
      yield JSON.parse(line.slice(start + 1));
    } catch {
      /* Skip invalid dump records. */
    }
  }
}
const db = new DatabaseSync(values.index);
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS authors(id TEXT PRIMARY KEY,name TEXT NOT NULL)",
);
if (values.authors) {
  const insert = db.prepare(
    "INSERT INTO authors VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
  );
  let count = 0;
  db.exec("BEGIN");
  for await (const author of dump(values.authors)) {
    if (author.key && typeof author.name === "string")
      insert.run(author.key, author.name);
    if (++count % 10000 === 0) {
      db.exec("COMMIT; BEGIN");
      if (count % 100000 === 0) console.log("Authors indexed:", count);
    }
  }
  db.exec("COMMIT");
}
if (!db.prepare("SELECT id FROM authors LIMIT 1").get())
  throw Error("Author index is empty. Supply --authors first.");
const lookup = db.prepare("SELECT name FROM authors WHERE id=?");
const curated = JSON.parse(
  readFileSync(
    new URL("../cloud/discovery-books.json", import.meta.url),
    "utf8",
  ),
);
const key = (title, author) =>
  (title + " " + author).toLowerCase().replace(/[^a-z0-9]/g, "");
const curatedTags = new Map(
  curated.map((b) => [key(b.title, b.author), b.tags]),
);
const output = createWriteStream(values.output, { flags: "wx" });
let written = 0,
  skipped = 0,
  truncated = 0;
try {
  for await (const work of dump(values.works)) {
    if (
      !/^\/works\/OL\d+W$/.test(work.key || "") ||
      typeof work.title !== "string"
    ) {
      skipped++;
      continue;
    }
    const author = (Array.isArray(work.authors) ? work.authors : [])
      .map((a) => lookup.get(a.author?.key || "")?.name)
      .filter(Boolean)
      .join(", ");
    if (!author) {
      skipped++;
      continue;
    }
    const subjects = (Array.isArray(work.subjects) ? work.subjects : [])
      .filter((s) => typeof s === "string")
      .join(" ")
      .toLowerCase();
    const tags = [...(curatedTags.get(key(work.title, author)) || [])];
    for (const [tag, pattern] of [
      ["romantasy", /romantic fantasy|romantasy/],
      ["dark-academia", /dark academia/],
      ["queer-fiction", /lgbt|queer fiction|gay fiction|lesbian fiction/],
      ["horror", /horror/],
      ["literary-fiction", /literary fiction/],
    ])
      if (pattern.test(subjects)) tags.push(tag);
    const category = /poetry/.test(subjects)
      ? "Poetry"
      : /philosophy/.test(subjects)
        ? "Philosophy"
        : /essays/.test(subjects)
          ? "Essays"
          : /\bfiction\b|novel|fantasy/.test(subjects)
            ? "Fiction"
            : "Nonfiction";
    const description =
      typeof work.description === "string"
        ? work.description
        : work.description?.value || "";
    if (
      work.title.length > 150 ||
      author.length > 100 ||
      description.length > 1200
    )
      truncated++;
    const book = normalize({
      id: "ol-" + work.key.split("/").at(-1),
      title: work.title.slice(0, 150),
      author: author.slice(0, 100),
      description: description.slice(0, 1200),
      category,
      tags: [...new Set(tags)],
      availability: "discovery",
      sourceUrl: "https://openlibrary.org" + work.key,
    });
    if (!output.write(JSON.stringify(book) + "\n")) await once(output, "drain");
    if (++written % 10000 === 0)
      console.log(JSON.stringify({ written, skipped, truncated }));
    if (written >= limit) break;
  }
  output.end();
  await once(output, "finish");
  console.log(
    JSON.stringify({ written, skipped, truncated, output: values.output }),
  );
} finally {
  db.close();
}
