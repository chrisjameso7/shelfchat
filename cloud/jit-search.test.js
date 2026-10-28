import test from "node:test";
import assert from "node:assert/strict";
import {
  claimLookup,
  lookupIdentity,
  resolveOpenTitle,
  performLookup,
} from "./jit-search.js";
const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:gutenberg:155:2</id><title>The Moonstone</title><rights>Public domain in the USA.</rights><author><name>Wilkie Collins</name></author><link rel="http://opds-spec.org/acquisition" type="application/epub+zip" length="1234" href="https://www.gutenberg.org/ebooks/155.epub.noimages"/></entry></feed>`;
test("lookup identity is normalized; short queries do not dispatch and cached misses avoid rate-limit writes", async () => {
  assert.equal(
    lookupIdentity(" The   Moonstone ").key,
    lookupIdentity("the moonstone").key,
  );
  let claims = 0;
  assert.equal(
    await claimLookup(() => {
      throw Error("should not query");
    }, "a"),
    null,
  );
  const result = await claimLookup(
    async () => [{ status: "miss" }],
    "Moonstone",
    { beforeClaim: () => claims++ },
  );
  assert.equal(result.dispatch, false);
  assert.equal(claims, 0);
  assert.equal(result.status, "miss");
});
test("external resolution uses public-domain file evidence, rejects unrelated results and skips a slower second provider after a match", async () => {
  const read = async (url) => {
    if (url.includes("archive.org")) throw Error("temporarily unavailable");
    return url.includes("search.opds")
      ? '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link rel="subsection" href="/ebooks/155.opds"/></entry></feed>'
      : xml;
  };
  const result = await resolveOpenTitle("Moonstone", { read });
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].rights, "public-domain");
  assert.equal(result.incomplete, false);
  assert.equal(
    (await resolveOpenTitle("Unrelated title", { read })).books.length,
    0,
  );
});
test("lookup persists files before marking completion; errors do not create fake book records", async () => {
  const { gutenbergBook } = await import("../scripts/harvest-library.mjs");
  const writes = [],
    statuses = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    if (text.includes("pg_database_size")) return [{ bytes: 1000 }];
    if (text.startsWith("UPDATE")) statuses.push(values[0]);
    return [];
  };
  sql.query = async (text, values) => writes.push({ text, values });
  const job = { key: "key", token: "token", q: "Moonstone" };
  await performLookup(sql, job, {
    resolver: async () => ({ books: [gutenbergBook(xml)], incomplete: false }),
    verifier: async (book) => book,
  });
  assert.equal(writes.length, 1);
  assert.match(writes[0].text, /INSERT INTO shelfchat_books/);
  assert.equal(statuses[0], "done");
  await performLookup(sql, job, {
    resolver: async () => {
      throw Error("source down");
    },
  });
  assert.equal(writes.length, 1);
  assert.equal(statuses[1], "error");
});
