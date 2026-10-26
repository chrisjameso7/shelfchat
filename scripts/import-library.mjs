import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile, rename, stat, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "csv-parse";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";
import chain from "stream-chain";
import { database } from "../cloud/db.js";

function text(value, max, name, required = false) {
  if (
    typeof value !== "string" ||
    (required && !value.trim()) ||
    value.length > max ||
    value.includes("\0")
  )
    throw Error(`Invalid ${name} (maximum ${max} characters)`);
  return value.trim();
}
function https(value) {
  if (!value) return null;
  if (typeof value !== "string" || value.length > 4096)
    throw Error("URL must be at most 4096 characters");
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.hostname === "localhost" ||
    /^(127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname)
  )
    throw Error("Expected a public HTTPS URL");
  return u.href;
}
export function normalize(raw) {
  const title = text(raw.title, 150, "title", true);
  const author = text(raw.author, 100, "author", true);
  const description = text(raw.description || "", 1200, "description");
  const category = raw.category || "Nonfiction";
  if (
    !["Fiction", "Philosophy", "Poetry", "Essays", "Nonfiction"].includes(
      category,
    )
  )
    throw Error("Invalid category");
  const sourceUrl = https(raw.sourceUrl || raw.source_url);
  const licenseUrl = https(raw.licenseUrl || raw.license_url);
  const coverUrl = https(raw.coverUrl || raw.cover_url);
  const rightsStatement = text(
    raw.rightsStatement || raw.rights_statement || "",
    1000,
    "rights statement",
  );
  const availability = raw.availability || "discovery";
  if (
    raw.rights &&
    !["public-domain", "open-license", "permission"].includes(raw.rights)
  )
    throw Error("Invalid rights assertion");
  if (!["downloadable", "discovery"].includes(availability))
    throw Error("Invalid availability");
  const variants =
    typeof raw.editions === "string"
      ? JSON.parse(raw.editions)
      : raw.editions || {};
  if (
    availability === "downloadable" &&
    !Object.keys(variants).length &&
    raw.url
  )
    variants[raw.format] = { url: raw.url, size: raw.size };
  const editions = {};
  if (availability === "downloadable") {
    if (!["public-domain", "open-license", "permission"].includes(raw.rights))
      throw Error(
        "Downloadable records require explicit rights: public-domain, open-license or permission",
      );
    if (!licenseUrl && raw.rights !== "permission")
      throw Error("A license URL is required");
    for (const [format, file] of Object.entries(variants)) {
      if (!["EPUB", "PDF"].includes(format)) throw Error("Invalid file format");
      const size = Number(file.size || 0);
      if (!Number.isSafeInteger(size) || size < 0)
        throw Error("Invalid file size");
      const url = https(file.url);
      if (!url) throw Error("Edition URL is required");
      editions[format] = {
        url,
        size,
        ...(file.fallbackUrls
          ? { fallbackUrls: file.fallbackUrls.slice(0, 2).map(https) }
          : {}),
      };
    }
    if (!Object.keys(editions).length)
      throw Error("At least one authorized edition is required");
  } else if (!sourceUrl) throw Error("Discovery records require a source URL");
  const format = editions[raw.format]
    ? raw.format
    : Object.keys(editions)[0] || null;
  const id = raw.id
    ? text(raw.id, 180, "id", true)
    : "import-" +
      createHash("sha256")
        .update(`${sourceUrl || ""}\0${title}\0${author}`)
        .digest("hex")
        .slice(0, 32);
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(id))
    throw Error("ID must use letters, digits, underscores or hyphens");
  const tags = (
    Array.isArray(raw.tags) ? raw.tags : String(raw.tags || "").split("|")
  )
    .filter(Boolean)
    .map((t) => text(t, 60, "tag", true).toLowerCase());
  if (tags.length > 30) throw Error("At most 30 tags per book");
  const year = raw.publishedYear || raw.published_year;
  if (
    year &&
    (!Number.isInteger(Number(year)) || Number(year) < 1 || Number(year) > 2200)
  )
    throw Error("Invalid publication year");
  return {
    id,
    title,
    author,
    category,
    format,
    size: editions[format]?.size || 0,
    description,
    url: editions[format]?.url || null,
    editions,
    sourceUrl,
    licenseUrl,
    coverUrl,
    rights: raw.rights || null,
    rightsStatement,
    publishedYear: year ? Number(year) : null,
    availability,
    tags: [...new Set(tags)],
  };
}
const columns = [
  "id",
  "title",
  "author",
  "category",
  "format",
  "size",
  "description",
  "url",
  "editions",
  "source_url",
  "license_url",
  "published_year",
  "availability",
  "tags",
  "cover_url",
  "rights",
  "rights_statement",
  "last_synced_at",
];
export function insertBatch(records) {
  // Duplicate IDs in one VALUES statement would trigger PostgreSQL's cardinality violation.
  const unique = [...new Map(records.map((b) => [b.id, b])).values()];
  const values = [];
  const tuples = unique.map((b) => {
    const fields = [
      b.id,
      b.title,
      b.author,
      b.category,
      b.format,
      b.size,
      b.description,
      b.url,
      JSON.stringify(b.editions),
      b.sourceUrl,
      b.licenseUrl,
      b.publishedYear,
      b.availability,
      b.tags,
      b.coverUrl || null,
      b.rights || null,
      b.rightsStatement || "",
    ];
    return (
      "(" +
      fields
        .map((v) => {
          values.push(v);
          return "$" + values.length;
        })
        .join(",") +
      ",now()" +
      ")"
    );
  });
  // Preserve community notes, counters, original timestamps and existing authorized editions.
  const updates = [
    "title",
    "author",
    "category",
    "description",
    "source_url",
    "published_year",
  ].map((c) => `${c}=EXCLUDED.${c}`);
  updates.push(
    `license_url=CASE WHEN shelfchat_books.availability='downloadable' AND EXCLUDED.availability='discovery' THEN shelfchat_books.license_url ELSE EXCLUDED.license_url END`,
  );
  updates.push(
    `tags=ARRAY(SELECT DISTINCT unnest(shelfchat_books.tags||EXCLUDED.tags))`,
  );
  updates.push(`editions=shelfchat_books.editions||EXCLUDED.editions`);
  updates.push(
    "cover_url=coalesce(EXCLUDED.cover_url,shelfchat_books.cover_url)",
  );
  updates.push("rights=coalesce(EXCLUDED.rights,shelfchat_books.rights)");
  updates.push(
    "rights_statement=coalesce(nullif(EXCLUDED.rights_statement,''),shelfchat_books.rights_statement)",
  );
  updates.push("last_synced_at=now()");
  for (const c of ["format", "size", "url", "availability"])
    updates.push(
      `${c}=CASE WHEN shelfchat_books.availability='downloadable' AND EXCLUDED.availability='discovery' THEN shelfchat_books.${c} ELSE EXCLUDED.${c} END`,
    );
  return {
    text: `INSERT INTO shelfchat_books(${columns.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT(id) DO UPDATE SET ${updates.join(",")}`,
    values,
  };
}
export async function* records(file, format, arrayPath) {
  const input = createReadStream(file);
  const source = file.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  if (format === "json") {
    const stages = [
      source,
      parser(),
      ...(arrayPath ? [pick({ filter: arrayPath })] : []),
      streamArray(),
    ];
    for await (const { value } of chain(stages)) yield value;
  } else if (format === "csv") {
    for await (const row of source.pipe(
      parse({
        columns: true,
        bom: true,
        skip_empty_lines: true,
        max_record_size: 1024 * 1024,
      }),
    ))
      yield row;
  } else {
    for await (const line of createInterface({
      input: source,
      crlfDelay: Infinity,
    })) {
      if (!line.trim()) continue;
      if (line.length > 1024 * 1024) throw Error("Record exceeds 1 MB");
      yield JSON.parse(line);
    }
  }
}
export async function retry(operation, attempts = 5) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt >= attempts - 1 ||
        (!["40001", "40P01", "08000", "08006", "57P01", "53300"].includes(
          error.code,
        ) &&
          !/(fetch failed|timeout|temporarily|ECONNRESET|503|429)/i.test(
            error.message,
          ))
      )
        throw error;
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(15000, 500 * 2 ** attempt) + Math.random() * 200,
        ),
      );
    }
  }
}
export async function run(options) {
  const file = resolve(options.file);
  const info = await stat(file);
  const fingerprint = {
    file,
    size: info.size,
    mtime: info.mtimeMs,
    format: options.format,
    arrayPath: options["array-path"] || "",
  };
  const checkpoint = resolve(options.checkpoint || file + ".checkpoint.json");
  const dry = options["dry-run"];
  let processed = 0,
    accepted = 0,
    rejected = 0,
    skip = 0;
  if (options.resume && existsSync(checkpoint)) {
    const saved = JSON.parse(await readFile(checkpoint, "utf8"));
    if (JSON.stringify(saved.fingerprint) !== JSON.stringify(fingerprint))
      throw Error("Input changed since checkpoint; use a new checkpoint");
    if (saved.dry !== !!dry)
      throw Error("Cannot resume a dry-run checkpoint into a real import");
    ({ processed: skip, accepted, rejected } = saved);
  }
  const batchSize = Number(options.batch || 500);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw Error("Batch size must be 1–1000");
  const max = Number(options.limit || Infinity);
  if (!(max > 0)) throw Error("Limit must be positive");
  if (skip >= max) return { processed: skip, accepted, rejected };
  const sql = dry ? null : database();
  let batch = [],
    bytes = 0,
    lastCommitted = skip;
  const started = Date.now();
  await mkdir(dirname(checkpoint), { recursive: true });
  const save = async () => {
    await writeFile(
      checkpoint + ".tmp",
      JSON.stringify({
        fingerprint,
        dry: !!dry,
        processed,
        accepted,
        rejected,
      }),
    );
    await rename(checkpoint + ".tmp", checkpoint);
    lastCommitted = processed;
  };
  const flush = async () => {
    if (batch.length) {
      const query = insertBatch(batch);
      if (sql) await retry(() => sql.query(query.text, query.values));
      accepted += batch.length;
      batch = [];
      bytes = 0;
    }
    await save();
    console.log(
      JSON.stringify({
        processed,
        accepted,
        rejected,
        rowsPerSecond: Math.round(
          (processed - skip) / Math.max(1, (Date.now() - started) / 1000),
        ),
        rssMB: Math.round(process.memoryUsage().rss / 1048576),
        dryRun: !!dry,
      }),
    );
  };
  const rejects = options.rejects
    ? resolve(options.rejects)
    : file + ".rejects.jsonl";
  const { appendFile } = await import("node:fs/promises");
  try {
    for await (const raw of records(
      file,
      options.format,
      options["array-path"],
    )) {
      processed++;
      if (processed <= skip) continue;
      let book;
      try {
        book = normalize(raw);
      } catch (error) {
        rejected++;
        await appendFile(
          rejects,
          JSON.stringify({
            record: processed,
            id: raw?.id,
            error: error.message,
          }) + "\n",
        );
        if (options.strict)
          throw Error(`Record ${processed}: ${error.message}`);
      }
      if (book) {
        batch.push(book);
        bytes += Buffer.byteLength(JSON.stringify(book));
      }
      if (
        batch.length >= batchSize ||
        bytes >= 1024 * 1024 ||
        processed - lastCommitted >= batchSize
      )
        await flush();
      if (processed >= max) break;
    }
    await flush();
    return { processed, accepted, rejected };
  } catch (error) {
    throw Error(
      `Import stopped after committed record ${lastCommitted}. Resume with --resume. ${error.message}`,
      { cause: error },
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      format: { type: "string", default: "jsonl" },
      "array-path": { type: "string" },
      batch: { type: "string" },
      checkpoint: { type: "string" },
      rejects: { type: "string" },
      limit: { type: "string" },
      resume: { type: "boolean" },
      strict: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });
  if (!values.file || !["json", "jsonl", "csv"].includes(values.format)) {
    console.error(
      "Usage: npm run catalog:import -- --file books.jsonl[.gz] --format jsonl|json|csv [--dry-run] [--resume] [--batch 500]",
    );
    process.exitCode = 1;
  } else
    await run(values).catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
