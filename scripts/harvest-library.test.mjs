import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gutenbergPage,
  gutenbergBook,
  archiveBook,
  createSourceClient,
  retryDelay,
  harvest,
} from "./harvest-library.mjs";
export const opds = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:gutenberg:155:2</id><title>The Moonstone</title><rights>Public domain in the USA.</rights><author><name>Collins, Wilkie</name></author><content>A mystery novel.</content><category term="Detective fiction"/><link rel="http://opds-spec.org/acquisition" type="application/epub+zip" length="12000" href="https://www.gutenberg.org/ebooks/155.epub.noimages"/><link rel="http://opds-spec.org/image" href="https://www.gutenberg.org/cache/epub/155/pg155.cover.medium.jpg"/></entry></feed>`;
const list = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><link rel="subsection" href="/ebooks/155.opds"/></entry></feed>`;
export const archive = {
  metadata: {
    title: "The Moonstone",
    creator: "Wilkie Collins",
    year: "1868",
    mediatype: "texts",
    licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/",
  },
  files: [
    { name: "book.epub", format: "EPUB", size: "10000" },
    { name: "book.pdf", format: "Text PDF", size: "20000" },
  ],
  d1: "ia800001.us.archive.org",
  d2: "ia800002.us.archive.org",
  dir: "/1/items/classic",
};
test("provider parsers keep only eligible editions, covers and published mirrors", () => {
  assert.deepEqual(gutenbergPage(list).items, [
    "https://www.gutenberg.org/ebooks/155.opds",
  ]);
  const pg = gutenbergBook(opds);
  assert.equal(pg.id, "pg-155");
  assert.equal(pg.rights, "public-domain");
  assert.equal(pg.category, "Fiction");
  assert.ok(pg.coverUrl);
  assert.equal(
    gutenbergBook(
      opds.replace("Public domain in the USA.", "All rights reserved"),
    ),
    null,
  );
  assert.throws(() => gutenbergBook("<!DOCTYPE xml><feed/>"), /DTD/);
  const ia = archiveBook("classic", archive);
  assert.equal(ia.editions.EPUB.fallbackUrls.length, 2);
  assert.ok(ia.editions.PDF);
  assert.equal(
    archiveBook("classic", {
      ...archive,
      metadata: { ...archive.metadata, year: "2025" },
    }),
    null,
  );
  assert.equal(
    archiveBook("classic", {
      ...archive,
      metadata: { ...archive.metadata, "access-restricted-item": ["true"] },
    }),
    null,
  );
  assert.equal(
    archiveBook("classic", {
      ...archive,
      metadata: { ...archive.metadata, licenseurl: "" },
    }),
    null,
  );
});
test("source client honors Retry-After and stops on blocking instead of evading it", async () => {
  const waits = [],
    agents = [];
  let requests = 0;
  const read = createSourceClient({
    wait: async (ms) => waits.push(ms),
    userAgent: "ShelfChat/test",
    fetcher: async (url, options) => {
      agents.push(options.headers["User-Agent"]);
      return ++requests === 1
        ? new Response("", { status: 429, headers: { "retry-after": "3" } })
        : new Response("ok");
    },
  });
  assert.equal(await read("https://archive.org/metadata/classic"), "ok");
  assert.ok(waits.includes(3000));
  assert.deepEqual([...new Set(agents)], ["ShelfChat/test"]);
  let blocked = 0;
  const denied = createSourceClient({
    wait: async () => {},
    fetcher: async () => {
      blocked++;
      return new Response("", { status: 403 });
    },
  });
  await assert.rejects(denied("https://archive.org/metadata/classic"), /403/);
  assert.equal(blocked, 1);
  await assert.rejects(read("https://localhost/private"), /approved/);
  assert.ok(retryDelay(new Date(Date.now() + 10000).toUTCString(), 0) >= 8000);
});
test("multi-source sync commits batches, resumes, and never advances past a failed write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shelfchat-harvest-"));
  const checkpoint = join(dir, "harvest.checkpoint.json");
  let fail = true,
    inserts = 0;
  const sql = {
    query: async (text) => {
      if (text.startsWith("SELECT")) return [{ bytes: 0 }];
      if (fail) throw Object.assign(Error("bad data"), { code: "23514" });
      inserts++;
      return [];
    },
  };
  const read = async (url) =>
    url.includes("search.opds")
      ? list
      : url.includes("155.opds")
        ? opds
        : url.includes("/scrape?")
          ? JSON.stringify({ items: [{ identifier: "classic" }] })
          : JSON.stringify(archive);
  try {
    const options = {
      checkpoint,
      sources: "gutenberg,archive",
      batch: 1,
      "max-items": 1,
    };
    await assert.rejects(harvest(options, { sql, read }), /committed item 0/);
    assert.equal(existsSync(checkpoint), false);
    fail = false;
    assert.deepEqual(await harvest(options, { sql, read }), {
      examined: 1,
      accepted: 1,
      rejected: 0,
    });
    assert.deepEqual(
      await harvest(
        { ...options, resume: true, "max-items": 2 },
        { sql, read },
      ),
      { examined: 2, accepted: 2, rejected: 0 },
    );
    assert.equal(inserts, 2);
    assert.equal(JSON.parse(await readFile(checkpoint, "utf8")).examined, 2);
    assert.equal(existsSync(checkpoint + ".lock"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remote commit failures never advance checkpoints; retries are idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shelfchat-remote-"));
  const checkpoint = join(dir, "state.checkpoint.json");
  const options = {
    endpoint: "https://shelfchat.vercel.app/api/admin/import",
    sources: "gutenberg",
    batch: 1,
    "max-items": 1,
    checkpoint,
  };
  const read = async (url) => (url.includes("search.opds") ? list : opds);
  try {
    await assert.rejects(
      harvest(options, {
        read,
        commit: async () => {
          throw Error("remote offline");
        },
      }),
      /committed item 0/,
    );
    assert.equal(existsSync(checkpoint), false);
    let committed = [];
    await harvest(options, {
      read,
      commit: async (books) => {
        committed = books;
      },
    });
    assert.equal(committed[0].id, "pg-155");
    assert.equal(JSON.parse(await readFile(checkpoint, "utf8")).accepted, 1);
    let repeated = 0;
    await harvest(
      { ...options, resume: true },
      {
        read,
        commit: async () => {
          repeated++;
        },
      },
    );
    assert.equal(repeated, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
