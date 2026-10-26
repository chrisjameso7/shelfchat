import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

export function lookupIdentity(query) {
  const q = Array.from(
    String(query || "")
      .normalize("NFKC")
      .replace(/[\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, 160)
    .join("");
  return { q, key: createHash("sha256").update(q.toLowerCase()).digest("hex") };
}
export async function claimLookup(sql, query, { beforeClaim } = {}) {
  const { q, key } = lookupIdentity(query);
  if (Array.from(q).length < 4) return null;
  const [cached] =
    await sql`SELECT status FROM shelfchat_search_jobs WHERE key=${key} AND expires_at>now()`;
  if (cached)
    return {
      key,
      q,
      dispatch: false,
      status: cached.status,
      retryAfterMs: 1500,
    };
  await beforeClaim?.();
  const token = randomUUID();
  const rows =
    await sql`INSERT INTO shelfchat_search_jobs(key,query,status,token,expires_at) VALUES(${key},${q},'pending',${token},now()+interval '45 seconds') ON CONFLICT(key) DO UPDATE SET status='pending',token=EXCLUDED.token,expires_at=EXCLUDED.expires_at,updated_at=now() WHERE shelfchat_search_jobs.expires_at<now() RETURNING key`;
  if (rows.length)
    return {
      key,
      q,
      token,
      dispatch: true,
      status: "pending",
      retryAfterMs: 1500,
    };
  const [job] =
    await sql`SELECT status FROM shelfchat_search_jobs WHERE key=${key}`;
  return {
    key,
    q,
    dispatch: false,
    status: job?.status || "miss",
    retryAfterMs: 1500,
  };
}
async function sourceSlot(sql, url, signal) {
  const host = new URL(url).hostname;
  const gap = host === "www.gutenberg.org" ? 2000 : 1000;
  while (!signal.aborted) {
    const slot =
      await sql`INSERT INTO shelfchat_source_limits(source,next_allowed_at) VALUES(${host},now()+${gap}*interval '1 millisecond') ON CONFLICT(source) DO UPDATE SET next_allowed_at=EXCLUDED.next_allowed_at WHERE shelfchat_source_limits.next_allowed_at<=now() RETURNING source`;
    if (slot.length) return;
    await sleep(400, undefined, { signal });
  }
  signal.throwIfAborted();
}
export async function resolveOpenTitle(query, { read, signal } = {}) {
  const { gutenbergPage, gutenbergBook, archiveBook, createSourceClient } =
    await import("../scripts/harvest-library.mjs");
  read ||= createSourceClient({ signal });
  const matches = (book) =>
    book &&
    query
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.every((word) =>
        (book.title + " " + book.author).toLowerCase().includes(word),
      );
  const providers = [
    async () => {
      const url = new URL("https://www.gutenberg.org/ebooks/search.opds/");
      url.searchParams.set("query", query);
      const page = gutenbergPage(await read(url.href), url.href);
      const books = [];
      for (const item of page.items.slice(0, 2)) {
        signal?.throwIfAborted();
        const book = gutenbergBook(await read(item));
        if (matches(book)) return [book];
      }
      return books;
    },
    async () => {
      const url = new URL("https://archive.org/advancedsearch.php");
      const literal = query.replace(/["\\]/g, "\\$&");
      url.search = new URLSearchParams({
        q: `mediatype:texts AND title:"${literal}" AND year:[1500 TO 1929] AND NOT access-restricted-item:true`,
        rows: "2",
        output: "json",
        "fl[]": "identifier",
      });
      const page = JSON.parse(await read(url.href));
      if (!Array.isArray(page.response?.docs))
        throw Error("Archive lookup response is invalid");
      const books = [];
      for (const item of page.response.docs) {
        signal?.throwIfAborted();
        if (!/^[a-zA-Z0-9_-]{1,170}$/.test(item.identifier || "")) continue;
        const book = archiveBook(
          item.identifier,
          JSON.parse(
            await read("https://archive.org/metadata/" + item.identifier),
          ),
        );
        if (matches(book)) return [book];
      }
      return books;
    },
  ];
  let incomplete = false;
  for (const provider of providers) {
    try {
      const books = await provider();
      if (books.length)
        return {
          books: [...new Map(books.map((b) => [b.id, b])).values()].slice(0, 3),
          incomplete,
        };
    } catch {
      incomplete = true;
    }
  }
  return { books: [], incomplete };
}
export async function performLookup(
  sql,
  job,
  { resolver = resolveOpenTitle } = {},
) {
  const signal = AbortSignal.timeout(20000);
  let status = "error";
  try {
    const { createSourceClient } = await import(
      "../scripts/harvest-library.mjs"
    );
    const read = createSourceClient({
      signal,
      beforeRequest: (url) => sourceSlot(sql, url, signal),
    });
    const { books, incomplete } = await resolver(job.q, { read, signal });
    if (books.length) {
      const { insertBatch } = await import("../scripts/import-library.mjs");
      const budget =
        Number(process.env.CATALOG_STORAGE_BUDGET_MB || 750) * 1_000_000;
      const [usage] =
        await sql`SELECT pg_database_size(current_database())::float8 AS bytes`;
      if (
        !Number.isFinite(budget) ||
        budget <= 0 ||
        Number(usage.bytes) + Buffer.byteLength(JSON.stringify(books)) * 3 >
          budget
      )
        throw Error("Storage budget reached");
      const batch = insertBatch(books);
      await sql.query(batch.text, batch.values);
      status = "done";
    } else status = incomplete ? "error" : "miss";
  } catch (error) {
    console.warn(
      "ShelfChat catalog lookup did not complete:",
      error.name === "TimeoutError"
        ? "source timeout"
        : "source or capacity unavailable",
    );
  }
  await sql`UPDATE shelfchat_search_jobs SET status=${status},expires_at=now()+CASE WHEN ${status}='error' THEN interval '2 minutes' ELSE interval '6 hours' END,updated_at=now() WHERE key=${job.key} AND token=${job.token}`;
  await sql`DELETE FROM shelfchat_search_jobs WHERE key IN(SELECT key FROM shelfchat_search_jobs WHERE expires_at<now()-interval '1 day' LIMIT 100)`;
}
