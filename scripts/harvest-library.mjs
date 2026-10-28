import {
  readFile,
  writeFile,
  rename,
  mkdir,
  appendFile,
  open,
  unlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { DOMParser } from "@xmldom/xmldom";
import { database } from "../cloud/db.js";
import { normalize, insertBatch, retry } from "./import-library.mjs";

const ATOM = "http://www.w3.org/2005/Atom";
const PG_START =
  "https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads";
export const ARCHIVE_QUERY =
  'mediatype:texts AND (collection:americana OR collection:toronto OR collection:smithsonian OR collection:biodiversity) AND year:[1500 TO 1929] AND NOT access-restricted-item:true AND licenseurl:("https://creativecommons.org/publicdomain/mark/1.0/" OR "http://creativecommons.org/publicdomain/mark/1.0/" OR "https://creativecommons.org/publicdomain/zero/1.0/" OR "http://creativecommons.org/publicdomain/zero/1.0/")';
const aliases = new Map([
  ["5200", "metamorphosis"],
  ["1342", "pride-prejudice"],
  ["2680", "meditations"],
  ["43", "strange-case"],
  ["1322", "leaves-grass"],
  ["174", "dorian-gray"],
  ["205", "walden"],
  ["4363", "beyond-good"],
]);
const plain = (value) =>
  (Array.isArray(value) ? value.join("; ") : String(value || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const flag = (value) =>
  Array.isArray(value)
    ? value.some(flag)
    : value === true || value === 1 || value === "true" || value === "1";
const elements = (node, name) =>
  Array.from(node.getElementsByTagNameNS(ATOM, name));
const first = (node, name) =>
  elements(node, name)[0]?.textContent?.trim() || "";
export function sourceUrl(value, base) {
  const url = new URL(value, base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (!["archive.org", "www.gutenberg.org"].includes(url.hostname) &&
      !url.hostname.endsWith(".archive.org"))
  )
    throw Error("Source URL is outside approved provider hosts");
  return url.href;
}
export function categoryFor(subjects) {
  const text = plain(subjects).toLowerCase();
  return /poetry|poems|verse/.test(text)
    ? "Poetry"
    : /philosoph|ethics|metaphysics/.test(text)
      ? "Philosophy"
      : /essays|literary criticism/.test(text)
        ? "Essays"
        : /\bfiction\b|novel|drama|fantasy/.test(text)
          ? "Fiction"
          : "Nonfiction";
}
function xmlDocument(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("DTD/entity declarations are not supported");
  return new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") throw Error(message);
    },
  }).parseFromString(xml, "application/xml");
}
export function gutenbergPage(xml, base = PG_START) {
  const doc = xmlDocument(xml),
    feed = doc.documentElement;
  const next = Array.from(feed.childNodes)
    .find((n) => n.localName === "link" && n.getAttribute("rel") === "next")
    ?.getAttribute("href");
  const items = elements(feed, "entry")
    .map((entry) => {
      const href = elements(entry, "link")
        .find((n) => n.getAttribute("rel") === "subsection")
        ?.getAttribute("href");
      return href ? sourceUrl(href, base) : null;
    })
    .filter(Boolean);
  return {
    items: [...new Set(items)],
    next: next ? sourceUrl(next, base) : null,
  };
}
export function gutenbergBook(xml) {
  const doc = xmlDocument(xml),
    entries = elements(doc, "entry");
  let result, bookId;
  const editions = {};
  for (const entry of entries) {
    if (!/^Public domain in the USA\.?$/i.test(first(entry, "rights")))
      continue;
    const id = first(entry, "id").match(/^urn:gutenberg:(\d+):/)?.[1];
    if (!id) continue;
    if (bookId && id !== bookId) return null;
    bookId = id;
    const links = elements(entry, "link");
    for (const link of links) {
      if (link.getAttribute("rel") !== "http://opds-spec.org/acquisition")
        continue;
      const format = {
        "application/epub+zip": "EPUB",
        "application/pdf": "PDF",
      }[link.getAttribute("type")];
      if (!format) continue;
      const url = sourceUrl(link.getAttribute("href"), PG_START);
      if (new URL(url).hostname !== "www.gutenberg.org") continue;
      const size = Number(link.getAttribute("length") || 0);
      if (!Number.isSafeInteger(size) || size < 0) continue;
      const current = editions[format];
      if (!current) editions[format] = { url, size, fallbackUrls: [] };
      else if (current.url !== url) {
        if (size > 0 && (!current.size || size < current.size))
          editions[format] = {
            url,
            size,
            fallbackUrls: [current.url, ...current.fallbackUrls].slice(0, 2),
          };
        else
          current.fallbackUrls = [
            ...new Set([...current.fallbackUrls, url]),
          ].slice(0, 2);
      }
    }
    const cover = links
      .find((l) => l.getAttribute("rel") === "http://opds-spec.org/image")
      ?.getAttribute("href");
    const subjects = elements(entry, "category").map((c) =>
      c.getAttribute("term"),
    );
    const description =
      Array.from(
        entry.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "p"),
      )
        .map((n) => plain(n.textContent))
        .find((t) => /^Summary:/i.test(t)) || plain(first(entry, "content"));
    result = {
      id: aliases.get(id) || "pg-" + id,
      title: first(entry, "title").slice(0, 150),
      author:
        first(elements(entry, "author")[0] || entry, "name").slice(0, 100) ||
        "Anonymous",
      description: description.slice(0, 1200),
      category: categoryFor(subjects),
      sourceUrl: "https://www.gutenberg.org/ebooks/" + id,
      licenseUrl: "https://www.gutenberg.org/policy/license.html",
      rights: "public-domain",
      rightsStatement: first(entry, "rights"),
      coverUrl: cover?.startsWith("https:") ? sourceUrl(cover) : undefined,
      availability: "downloadable",
    };
  }
  if (!result || !Object.keys(editions).length) return null;
  return normalize({
    ...result,
    editions,
    format: editions.EPUB ? "EPUB" : "PDF",
  });
}
export function archiveBook(identifier, data) {
  if (!/^[a-zA-Z0-9_-]{1,170}$/.test(identifier)) return null;
  const m = data.metadata || {},
    license = plain(m.licenseurl).replace(/^http:/, "https:");
  const year = Number(plain(m.year || m.date).match(/\d{4}/)?.[0]);
  if (
    !/^https:\/\/creativecommons\.org\/publicdomain\/(?:mark|zero)\/1\.0\/?$/i.test(
      license,
    ) ||
    !year ||
    year < 1500 ||
    year > 1929 ||
    flag(m["access-restricted-item"]) ||
    flag(m.noindex) ||
    flag(data.is_dark) ||
    (m.mediatype && m.mediatype !== "texts")
  )
    return null;
  const editions = {};
  for (const file of Array.isArray(data.files) ? data.files : []) {
    if (
      flag(file.private) ||
      typeof file.name !== "string" ||
      file.name.split("/").some((p) => p === "..") ||
      !Number.isSafeInteger(Number(file.size)) ||
      Number(file.size) <= 0
    )
      continue;
    const kind =
      /\.epub$/i.test(file.name) && file.format === "EPUB"
        ? "EPUB"
        : /\.pdf$/i.test(file.name) &&
            ["Text PDF", "Image Container PDF"].includes(file.format)
          ? "PDF"
          : null;
    if (!kind || (editions[kind] && editions[kind].size <= Number(file.size)))
      continue;
    const filename = file.name.split("/").map(encodeURIComponent).join("/");
    const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${filename}`;
    const hosts = [
      ...new Set([
        data.d1,
        data.d2,
        ...(Array.isArray(data.workable_servers) ? data.workable_servers : []),
      ]),
    ]
      .filter(
        (h) => typeof h === "string" && /^[a-z0-9.-]+\.archive\.org$/i.test(h),
      )
      .slice(0, 2);
    const dir =
      typeof data.dir === "string" &&
      /^\/[a-zA-Z0-9/_-]+$/.test(data.dir) &&
      !data.dir.split("/").includes("..")
        ? data.dir
        : null;
    editions[kind] = {
      url,
      size: Number(file.size),
      fallbackUrls: dir
        ? hosts.map((h) => `https://${h}${dir}/${filename}`)
        : [],
    };
  }
  if (!Object.keys(editions).length || !plain(m.title)) return null;
  return normalize({
    id: "ia-" + identifier,
    title: plain(m.title).slice(0, 150),
    author: (plain(m.creator) || "Anonymous").slice(0, 100),
    description: plain(m.description).slice(0, 1200),
    category: categoryFor(m.subject),
    format: editions.EPUB ? "EPUB" : "PDF",
    editions,
    availability: "downloadable",
    sourceUrl: "https://archive.org/details/" + identifier,
    coverUrl: "https://archive.org/services/img/" + identifier,
    licenseUrl: license,
    rights: "public-domain",
    rightsStatement:
      "Source designates this historical edition as public domain: " + license,
    publishedYear: year,
  });
}

export function retryDelay(header, attempt, now = Date.now()) {
  const seconds = Number(header);
  const explicit = header
    ? Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(header) - now
    : 0;
  return Math.max(
    0,
    Number.isFinite(explicit) ? explicit : 0,
    1000 * 2 ** attempt,
  );
}
export function createSourceClient({
  userAgent,
  interval = 2000,
  fetcher = fetch,
  wait = sleep,
  signal,
  beforeRequest,
} = {}) {
  const last = new Map();
  return async function read(url) {
    url = sourceUrl(url);
    for (let attempt = 0; attempt < 5; attempt++) {
      let response;
      try {
        const host = new URL(url).hostname;
        const gap = Math.max(
          interval,
          host === "www.gutenberg.org" ? 2000 : 1000,
        );
        await wait(
          Math.max(0, (last.get(host) || 0) + gap - Date.now()),
          undefined,
          { signal },
        );
        last.set(host, Date.now());
        await beforeRequest?.(url);
        response = await fetcher(url, {
          redirect: "manual",
          headers: {
            "User-Agent":
              userAgent ||
              "ShelfChat/1.0 (authorized catalog sync; https://shelfchat.app)",
            Accept: "application/json, application/atom+xml, application/xml",
          },
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw Error(
            "Unexpected source redirect; update the configured official endpoint",
          );
        }
        if ([429, 500, 502, 503, 504].includes(response.status)) {
          const delay = retryDelay(
            response.headers.get("retry-after"),
            attempt,
          );
          await response.body?.cancel();
          if (delay > 60000)
            throw Object.assign(
              Error(
                `Source requires a ${Math.ceil(delay / 1000)}-second pause. Retry later with --resume.`,
              ),
              { status: response.status, stop: true },
            );
          if (attempt === 4)
            throw Object.assign(
              Error("Source is temporarily unavailable; resume later"),
              { stop: true },
            );
          await wait(delay, undefined, { signal });
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw Object.assign(
            Error(`Source returned HTTP ${response.status}`),
            { status: response.status, stop: true },
          );
        }
        if (Number(response.headers.get("content-length")) > 8 * 1024 * 1024)
          throw Object.assign(Error("Source response exceeds 8 MB"), {
            stop: true,
          });
        const reader = response.body?.getReader();
        if (!reader) throw Error("Empty source response");
        const chunks = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 8 * 1024 * 1024)
              throw Object.assign(Error("Source response exceeds 8 MB"), {
                stop: true,
              });
            chunks.push(Buffer.from(value));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        return Buffer.concat(chunks).toString("utf8");
      } catch (error) {
        if (error.stop || signal?.aborted || attempt === 4) throw error;
        await wait(1000 * 2 ** attempt, undefined, { signal });
      }
    }
  };
}

export async function harvest(
  options,
  {
    sql: providedSql,
    read: providedRead,
    commit: providedCommit,
    verify: providedVerify,
    signal,
  } = {},
) {
  const sources = String(options.sources || "gutenberg,archive").split(",");
  if (
    !sources.length ||
    sources.some((s) => !["gutenberg", "archive"].includes(s))
  )
    throw Error("Sources must be gutenberg,archive");
  const max = Number(options["max-items"] || 10000),
    batchSize = Number(options.batch || 500),
    interval = Number(options.interval || 2000);
  const budget = Number(options["storage-budget-mb"] || 750) * 1_000_000;
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1000 ||
    !Number.isFinite(interval) ||
    interval < 1000
  )
    throw Error(
      "Use a positive max-items, batch 1–1000 and interval >=1000 ms",
    );
  if (!Number.isFinite(budget) || budget <= 0)
    throw Error("Storage budget must be positive");
  const dry = !!options["dry-run"];
  const sql = dry || providedCommit ? null : providedSql || database();
  const read =
    providedRead ||
    createSourceClient({ userAgent: options["user-agent"], interval, signal });
  const checkpoint = resolve(
    options.checkpoint || "data/harvest.checkpoint.json",
  );
  await mkdir(dirname(checkpoint), { recursive: true });
  const lock = checkpoint + ".lock";
  const owner = await open(lock, "wx").catch(() => {
    throw Error(
      "Checkpoint is locked by another worker. Remove its .lock file only after confirming that worker has stopped.",
    );
  });
  try {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          sources,
          dry,
          archiveQuery: ARCHIVE_QUERY,
          database: providedCommit
            ? options.endpoint || "remote-import"
            : dry
              ? "dry-run"
              : process.env.DATABASE_URL || "injected-test-database",
          output: options.output ? resolve(options.output) : null,
        }),
      )
      .digest("hex");
    let state = {
      version: 1,
      fingerprint,
      sourceIndex: 0,
      examined: 0,
      accepted: 0,
      rejected: 0,
      progress: Object.fromEntries(
        sources.map((s) => [
          s,
          {
            page: s === "gutenberg" ? PG_START : null,
            pending: [],
            index: 0,
            next: null,
            done: false,
          },
        ]),
      ),
    };
    if (existsSync(checkpoint)) {
      if (!options.resume)
        throw Error(
          "Checkpoint already exists; pass --resume or use a fresh checkpoint",
        );
      state = JSON.parse(await readFile(checkpoint, "utf8"));
      if (state.version !== 1 || state.fingerprint !== fingerprint)
        throw Error("Checkpoint source, mode, output or database differs");
    }
    let batch = [],
      bytes = 0,
      committed = state.examined;
    const save = async () => {
      await writeFile(checkpoint + ".tmp", JSON.stringify(state));
      await rename(checkpoint + ".tmp", checkpoint);
      committed = state.examined;
    };
    const flush = async () => {
      if (batch.length) {
        const query = insertBatch(batch);
        if (sql) {
          const [usage] = await retry(() =>
            sql.query(
              "SELECT pg_database_size(current_database())::float8 AS bytes",
              [],
            ),
          );
          if (Number(usage.bytes) + bytes * 3 > budget)
            throw Error(
              "Database is approaching the configured storage budget. Review capacity before resuming.",
            );
          await retry(() => sql.query(query.text, query.values));
        }
        if (!dry && providedCommit) await providedCommit(batch);
        if (options.output) {
          const output = resolve(options.output);
          await mkdir(dirname(output), { recursive: true });
          await appendFile(
            output,
            batch.map((b) => JSON.stringify(b)).join("\n") + "\n",
          );
        }
        state.accepted += batch.length;
        batch = [];
        bytes = 0;
      }
      await save();
      console.log(
        JSON.stringify({
          examined: state.examined,
          accepted: state.accepted,
          rejected: state.rejected,
          dryRun: dry,
          source: sources[state.sourceIndex] || "complete",
        }),
      );
    };
    try {
      while (state.sourceIndex < sources.length && state.examined < max) {
        signal?.throwIfAborted();
        const source = sources[state.sourceIndex],
          p = state.progress[source];
        if (p.done) {
          state.sourceIndex++;
          continue;
        }
        if (p.index >= p.pending.length) {
          if (p.pending.length) {
            p.page = p.next;
            p.pending = [];
            p.index = 0;
            if (!p.page) {
              p.done = true;
              continue;
            }
          }
          if (source === "gutenberg") {
            const page = gutenbergPage(await read(p.page), p.page);
            p.pending = page.items;
            p.next = page.next;
          } else {
            const url = new URL(
              "https://archive.org/services/search/v1/scrape",
            );
            url.search = new URLSearchParams({
              q: ARCHIVE_QUERY,
              fields: "identifier",
              count: "100",
              ...(p.page ? { cursor: p.page } : {}),
            });
            const page = JSON.parse(await read(url.href));
            if (!Array.isArray(page.items))
              throw Error("Malformed archive search page");
            p.pending = page.items
              .map((b) => b.identifier)
              .filter(
                (id) =>
                  typeof id === "string" && /^[a-zA-Z0-9_-]{1,170}$/.test(id),
              );
            p.next = page.cursor || null;
          }
          if (!p.pending.length) {
            p.done = true;
            continue;
          }
        }
        const item = p.pending[p.index];
        let book;
        try {
          book =
            source === "gutenberg"
              ? gutenbergBook(await read(item))
              : archiveBook(
                  item,
                  JSON.parse(
                    await read("https://archive.org/metadata/" + item),
                  ),
                );
        } catch (error) {
          if (error.status === 404) book = null;
          else throw error;
        }
        if (book && providedVerify) book = await providedVerify(book);
        if (book) {
          batch.push(book);
          bytes += Buffer.byteLength(JSON.stringify(book));
        } else {
          state.rejected++;
          await appendFile(
            checkpoint + ".rejects.jsonl",
            JSON.stringify({
              source,
              item,
              reason: "No eligible public-domain PDF/EPUB or item removed",
            }) + "\n",
          );
        }
        p.index++;
        state.examined++;
        if (
          batch.length >= batchSize ||
          bytes >= 1024 * 1024 ||
          state.examined - committed >= batchSize
        )
          await flush();
      }
      await flush();
      return {
        examined: state.examined,
        accepted: state.accepted,
        rejected: state.rejected,
      };
    } catch (error) {
      throw Error(
        `Stopped after committed item ${committed}. Resume with the same checkpoint. ${error.message}`,
        { cause: error },
      );
    }
  } finally {
    await owner.close();
    await unlink(lock);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      sources: { type: "string" },
      "max-items": { type: "string" },
      batch: { type: "string" },
      interval: { type: "string" },
      checkpoint: { type: "string" },
      output: { type: "string" },
      "user-agent": { type: "string" },
      "storage-budget-mb": { type: "string" },
      resume: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  await harvest(values, { signal: controller.signal }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
