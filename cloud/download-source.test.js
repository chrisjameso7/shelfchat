import test from "node:test";
import assert from "node:assert/strict";
import { resolveArchiveDownload } from "./download-source.js";
const response = (url, content) => ({
  ok: true,
  url,
  body: new Response(content).body,
});
test("falls back from a failed archive host and verifies actual PDF bytes", async () => {
  let calls = 0;
  const fallback = "https://ia800000.us.archive.org/1/items/book/book.pdf";
  const actual = await resolveArchiveDownload(
    {
      url: "https://archive.org/download/book/book.pdf",
      fallbackUrls: [fallback],
    },
    "PDF",
    async (url) => {
      calls++;
      if (calls === 1) throw new Error("DNS failure");
      return response(url, "%PDF-1.7\n");
    },
  );
  assert.equal(actual, fallback);
  assert.equal(calls, 2);
});
test("does not mistake an HTML error page for an EPUB and rejects foreign fallback hosts", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      resolveArchiveDownload(
        {
          url: "https://archive.org/download/book/book.epub",
          fallbackUrls: ["https://example.com/private"],
        },
        "EPUB",
        async (url) => {
          calls++;
          return response(url, "<html>File unavailable</html>");
        },
      ),
    (e) => e.status === 503,
  );
  assert.equal(calls, 1);
});
test("valid EPUB source is returned without requesting alternate copies", async () => {
  let calls = 0;
  const url = "https://archive.org/download/book/book.epub";
  assert.equal(
    await resolveArchiveDownload({ url }, "EPUB", async (value) => {
      calls++;
      return response(value, "PK\u0003\u0004epub");
    }),
    url,
  );
  assert.equal(calls, 1);
});
