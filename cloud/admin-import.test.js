import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  authorizeImport,
  importRecords,
  commitImport,
} from "./admin-import.js";
const token = "a".repeat(64),
  verifier = createHash("sha256").update(token).digest("hex");
const book = {
  id: "pg-155",
  title: "The Moonstone",
  author: "Wilkie Collins",
  category: "Fiction",
  availability: "downloadable",
  rights: "public-domain",
  sourceUrl: "https://www.gutenberg.org/ebooks/155",
  licenseUrl: "https://www.gutenberg.org/policy/license.html",
  editions: {
    EPUB: {
      url: "https://www.gutenberg.org/ebooks/155.epub.noimages",
      size: 100,
    },
  },
};
test("operator import requires a strong token and restricts providers and rights", () => {
  assert.equal(authorizeImport("Bearer " + token, verifier), true);
  assert.equal(authorizeImport("Bearer " + "b".repeat(64), verifier), false);
  assert.equal(authorizeImport(undefined, verifier), false);
  assert.equal(authorizeImport("Bearer " + token, undefined), false);
  assert.equal(importRecords([book])[0].title, book.title);
  assert.throws(
    () => importRecords([{ ...book, rights: "permission" }]),
    /public-domain/,
  );
  assert.throws(
    () =>
      importRecords([
        { ...book, editions: { PDF: { url: "https://example.com/file.pdf" } } },
      ]),
    /host/,
  );
  assert.throws(() => importRecords(Array(101).fill(book)), /1–100/);
});
test("operator commits enforce capacity before any write and preserve batched query parameters", async () => {
  let writes = 0;
  const sql = {
    query: async (text, values) => {
      if (text.startsWith("INSERT")) {
        writes++;
        assert.ok(values.includes(book.title));
        return [];
      }
      return text.includes("pg_database_size")
        ? [{ bytes: 1000, count: 1010 }]
        : [{ count: 1011 }];
    },
  };
  assert.deepEqual(await commitImport(sql, [book]), {
    committed: 1,
    total: 1011,
  });
  assert.equal(writes, 1);
  sql.query = async () => [{ bytes: 750_000_000, count: 1011 }];
  await assert.rejects(commitImport(sql, [book]), /capacity/);
  assert.equal(writes, 1);
});
