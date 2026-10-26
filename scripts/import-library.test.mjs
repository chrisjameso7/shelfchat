import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  normalize,
  insertBatch,
  records,
  run,
  retry,
} from "./import-library.mjs";
const record = {
  title: "A book",
  author: "An author",
  availability: "discovery",
  sourceUrl: "https://openlibrary.org/works/OL1W",
  tags: ["BookTok"],
};
test("rights, safe URL and deterministic metadata validation", () => {
  const book = normalize(record);
  assert.equal(book.id, normalize(record).id);
  assert.equal(book.format, null);
  assert.deepEqual(book.tags, ["booktok"]);
  assert.throws(
    () =>
      normalize({
        ...record,
        availability: "downloadable",
        format: "EPUB",
        url: "https://example.com/book.epub",
      }),
    /rights/,
  );
  assert.throws(
    () => normalize({ ...record, sourceUrl: "javascript:alert(1)" }),
    /HTTPS/,
  );
  assert.throws(
    () => normalize({ ...record, title: "a".repeat(151) }),
    /title/,
  );
  const authorized = normalize({
    ...record,
    availability: "downloadable",
    rights: "permission",
    format: "EPUB",
    url: "https://example.com/book.epub",
  });
  assert.equal(authorized.editions.EPUB.url, "https://example.com/book.epub");
});
test("parameterized VALUES batches deduplicate IDs and preserve community state", () => {
  const b = normalize({ ...record, title: "Robert'); DROP TABLE books; --" });
  const sql = insertBatch([b, b]);
  assert.equal(sql.values.length, 14);
  assert.match(sql.text, /VALUES \(\$1,\$2/);
  assert.ok(!sql.text.includes(b.title));
  assert.ok(!sql.text.includes("downloads="));
  assert.ok(!sql.text.includes("created_at="));
  assert.match(sql.text, /shelfchat_books.availability='downloadable'/);
  const batch = insertBatch(
    Array.from({ length: 1000 }, (_, i) =>
      normalize({ ...record, id: String(i) }),
    ),
  );
  assert.equal(batch.values.length, 14000);
});
test("stream JSON arrays, nested arrays, quoted CSV, gzipped JSONL; resume and reject safely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shelfchat-import-"));
  try {
    const json = join(dir, "books.json"),
      nested = join(dir, "nested.json"),
      csv = join(dir, "books.csv"),
      jsonl = join(dir, "books.jsonl.gz");
    await writeFile(json, JSON.stringify([record, record]));
    await writeFile(nested, JSON.stringify({ books: [record] }));
    await writeFile(
      csv,
      'title,author,sourceUrl,availability\n"A book, with commas",An author,https://openlibrary.org/works/OL1W,discovery\n',
    );
    await writeFile(
      jsonl,
      gzipSync(
        [record, { ...record, id: "second" }, { title: "" }]
          .map((r) => JSON.stringify(r))
          .join("\n"),
      ),
    );
    for (const [file, format, path, count] of [
      [json, "json", null, 2],
      [nested, "json", "books", 1],
      [csv, "csv", null, 1],
      [jsonl, "jsonl", null, 3],
    ]) {
      let rows = 0;
      for await (const value of records(file, format, path)) {
        assert.ok(value);
        rows++;
      }
      assert.equal(rows, count);
    }
    const options = {
      file: jsonl,
      format: "jsonl",
      "dry-run": true,
      batch: 1,
      limit: 1,
    };
    assert.deepEqual(await run(options), {
      processed: 1,
      accepted: 1,
      rejected: 0,
    });
    assert.deepEqual(await run({ ...options, resume: true, limit: 3 }), {
      processed: 3,
      accepted: 2,
      rejected: 1,
    });
    const checkpoint = JSON.parse(await readFile(jsonl + ".checkpoint.json"));
    assert.equal(checkpoint.processed, 3);
    await assert.rejects(
      run({ ...options, resume: true, "dry-run": false }),
      /dry-run/,
    );
    await writeFile(jsonl, gzipSync(JSON.stringify(record) + "\n"));
    await assert.rejects(run({ ...options, resume: true }), /Input changed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("retry does not retry invalid SQL/data", async () => {
  let attempts = 0;
  await assert.rejects(
    retry(() => {
      attempts++;
      throw Object.assign(Error("constraint failed"), { code: "23514" });
    }),
    /constraint/,
  );
  assert.equal(attempts, 1);
});
