import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(
  readFileSync(new URL("./archive-books.json", import.meta.url), "utf8"),
);
test("import contains exactly 1000 distinct, attributable public-domain book records", () => {
  assert.equal(manifest.books.length, 1000);
  assert.equal(new Set(manifest.books.map((b) => b.id)).size, 1000);
  assert.equal(new Set(manifest.books.map((b) => b.sourceUrl)).size, 1000);
  for (const book of manifest.books) {
    assert.ok(book.title.length > 0 && book.title.length <= 150);
    assert.ok(book.author.length > 0 && book.author.length <= 100);
    assert.ok(book.description.length <= 1200);
    assert.ok(book.publishedYear <= 1929 && book.publishedYear >= 1500);
    assert.match(
      book.licenseUrl,
      /^https:\/\/creativecommons\.org\/(publicdomain|licenses\/publicdomain)/,
    );
    assert.equal(new URL(book.sourceUrl).hostname, "archive.org");
    assert.equal(
      book.id,
      "ia-" + new URL(book.sourceUrl).pathname.split("/").pop(),
    );
  }
});
test("all imported titles have distinct PDF and EPUB files with recorded sizes and checksums", () => {
  for (const book of manifest.books) {
    assert.deepEqual(Object.keys(book.editions).sort(), ["EPUB", "PDF"]);
    assert.notEqual(book.editions.PDF.url, book.editions.EPUB.url);
    for (const kind of ["PDF", "EPUB"]) {
      const file = book.editions[kind];
      const url = new URL(file.url);
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "archive.org");
      assert.ok(url.pathname.startsWith("/download/"));
      assert.ok(url.pathname.toLowerCase().endsWith("." + kind.toLowerCase()));
      assert.ok(Number.isSafeInteger(file.size) && file.size > 0);
      assert.match(file.md5, /^[a-f\d]{32}$/i);
    }
    assert.equal(book.size, book.editions.EPUB.size);
  }
});
