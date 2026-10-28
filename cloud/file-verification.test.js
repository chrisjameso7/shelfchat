import test from "node:test";
import assert from "node:assert/strict";
import { probeEdition, verifiedBook } from "./file-verification.js";
const url = "https://www.gutenberg.org/ebooks/155.epub.noimages";
test("reading verification accepts PDF and actual EPUB signatures but rejects HTML and arbitrary ZIPs", async () => {
  assert.equal(
    (
      await probeEdition({ url }, "EPUB", {
        fetcher: async () => new Response("PK fake zip"),
      })
    ).status,
    "invalid",
  );
  assert.equal(
    (
      await probeEdition({ url }, "EPUB", {
        fetcher: async () => new Response("PK mimetypeapplication/epub+zip"),
      })
    ).status,
    "ok",
  );
  assert.equal(
    (
      await probeEdition({ url }, "PDF", {
        fetcher: async () => new Response("%PDF-1.7 body"),
      })
    ).status,
    "ok",
  );
  assert.equal(
    (
      await probeEdition({ url }, "PDF", {
        fetcher: async () => new Response("<html>error</html>"),
      })
    ).status,
    "invalid",
  );
});
test("timeouts, rate limits and forbidden responses stay uncertain; missing files are invalid", async () => {
  for (const status of [403, 429, 500])
    assert.equal(
      (
        await probeEdition({ url }, "EPUB", {
          fetcher: async () => new Response("", { status }),
        })
      ).status,
      "unknown",
    );
  assert.equal(
    (
      await probeEdition({ url }, "EPUB", {
        fetcher: async () => new Response("", { status: 404 }),
      })
    ).status,
    "invalid",
  );
  assert.equal(
    (
      await probeEdition({ url }, "EPUB", {
        fetcher: async () => {
          throw Error("timeout");
        },
      })
    ).status,
    "unknown",
  );
});
test("verification keeps only valid editions, and retries uncertain books without classifying them broken", async () => {
  const b = {
    format: "EPUB",
    editions: {
      EPUB: { url, size: 100 },
      PDF: { url: url + "?pdf", size: 200 },
    },
  };
  const result = await verifiedBook(b, {
    fetcher: async (u) =>
      new Response(u.endsWith("?pdf") ? "%PDF-1.7" : "<html>gone</html>"),
  });
  assert.deepEqual(Object.keys(result.editions), ["PDF"]);
  assert.equal(result.format, "PDF");
  await assert.rejects(
    verifiedBook(b, { fetcher: async () => new Response("", { status: 503 }) }),
    /temporarily/,
  );
});
