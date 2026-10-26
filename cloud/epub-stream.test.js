import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { canStreamSource, streamEpub } from "./epub-stream.js";
function response() {
  const parts = [];
  const res = new Writable({
    write(chunk, encoding, callback) {
      parts.push(Buffer.from(chunk));
      callback();
    },
  });
  res.setHeader = () => {};
  res.flushHeaders = () => {
    res.headersSent = true;
  };
  return { res, parts };
}
test("same-origin reader stream accepts only provider hosts and verifies bytes before streaming", async () => {
  assert.equal(
    canStreamSource("https://www.gutenberg.org/ebooks/155.epub.noimages"),
    true,
  );
  assert.equal(canStreamSource("https://localhost/private"), false);
  assert.equal(
    canStreamSource("https://archive.org.evil.test/file.epub"),
    false,
  );
  const { res, parts } = response();
  let calls = 0;
  await streamEpub(
    res,
    {
      url: "https://archive.org/download/classic/book.epub",
      fallbackUrls: [
        "https://ia800001.us.archive.org/1/items/classic/book.epub",
      ],
    },
    {
      fetcher: async () =>
        new Response(
          ++calls === 1 ? "<html>Unavailable</html>" : "PKepub content",
        ),
    },
  );
  assert.equal(Buffer.concat(parts).toString(), "PKepub content");
  assert.equal(calls, 2);
});
test("provider redirects never permit a foreign or private destination", async () => {
  const { res } = response();
  let calls = 0;
  await assert.rejects(
    streamEpub(
      res,
      { url: "https://www.gutenberg.org/ebooks/155.epub.noimages" },
      {
        fetcher: async () => {
          calls++;
          return new Response("", {
            status: 302,
            headers: { location: "http://127.0.0.1/private" },
          });
        },
      },
    ),
    /unavailable/,
  );
  assert.equal(calls, 1);
});
