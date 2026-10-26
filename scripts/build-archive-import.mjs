import fs from "node:fs";
import path from "node:path";
const cache = process.argv[2];
if (!cache)
  throw new Error("Pass the directory of cached Internet Archive metadata.");
const limit = Number(process.argv[3] || 1000);
const plain = (value) =>
  (Array.isArray(value) ? value.join("; ") : String(value || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const shorten = (value, n) =>
  value.length <= n ? value : value.slice(0, n - 1).trimEnd() + "…";
const publicDomain = (url) =>
  /^https?:\/\/creativecommons\.org\/(?:publicdomain\/(?:mark|zero)\/1\.0\/?|licenses\/publicdomain\/?)$/i.test(
    url,
  );
const bool = (value) =>
  value === true || value === 1 || value === "true" || value === "1";
const candidates = JSON.parse(
  fs.readFileSync(path.join(cache, "../archive-candidates.json"), "utf8"),
);
const seen = new Set();
const books = [];
const rejected = {};
function reject(reason) {
  rejected[reason] = (rejected[reason] || 0) + 1;
}
for (const candidate of candidates) {
  if (books.length === limit) break;
  const filename = path.join(cache, candidate.identifier + ".json");
  if (!fs.existsSync(filename)) {
    reject("not-cached");
    continue;
  }
  const data = JSON.parse(fs.readFileSync(filename, "utf8"));
  const m = data.metadata || {};
  const license = plain(m.licenseurl);
  const year = Number(String(m.year || m.date || "").match(/\d{4}/)?.[0]);
  if (
    !publicDomain(license) ||
    !year ||
    year < 1500 ||
    year > 1929 ||
    bool(m["access-restricted-item"]) ||
    bool(m.noindex) ||
    bool(data.is_dark)
  ) {
    reject("rights-or-access");
    continue;
  }
  const title = plain(m.title),
    author = plain(m.creator) || "Anonymous";
  if (!title || title.length < 3) {
    reject("title");
    continue;
  }
  const key = (shorten(title, 150) + "|" + shorten(author, 100))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  if (seen.has(key)) {
    reject("duplicate");
    continue;
  }
  const files = (data.files || []).filter(
    (f) =>
      !bool(f.private) &&
      Number.isSafeInteger(Number(f.size)) &&
      Number(f.size) > 0 &&
      /^[a-f\d]{32}$/i.test(f.md5 || ""),
  );
  const epub = files
    .filter((f) => f.format === "EPUB" && /\.epub$/i.test(f.name))
    .sort(
      (a, b) =>
        (a.name === candidate.identifier + ".epub" ? -1 : 0) -
          (b.name === candidate.identifier + ".epub" ? -1 : 0) ||
        Number(a.size) - Number(b.size),
    )[0];
  const pdf = files
    .filter(
      (f) =>
        ["Text PDF", "Image Container PDF"].includes(f.format) &&
        /\.pdf$/i.test(f.name),
    )
    .sort(
      (a, b) =>
        (a.name === candidate.identifier + ".pdf" ? -1 : 0) -
          (b.name === candidate.identifier + ".pdf" ? -1 : 0) ||
        Number(a.size) - Number(b.size),
    )[0];
  if (!epub || !pdf) {
    reject("missing-format");
    continue;
  }
  const subjects = plain(m.subject).toLowerCase();
  let category = "Nonfiction";
  if (/poetry|poems|verse/.test(subjects)) category = "Poetry";
  else if (/philosoph|ethics|metaphysics/.test(subjects))
    category = "Philosophy";
  else if (/fiction|novel|short stories|fairy tales|drama/.test(subjects))
    category = "Fiction";
  else if (/essays|literary criticism/.test(subjects)) category = "Essays";
  const url = (f) =>
    `https://archive.org/download/${encodeURIComponent(candidate.identifier)}/${f.name.split("/").map(encodeURIComponent).join("/")}?download=1`;
  const fallbacks = (f) =>
    typeof data.dir === "string"
      ? [
          ...new Set(
            [data.d1, data.d2, ...(data.workable_servers || [])].filter(
              (host) =>
                typeof host === "string" &&
                /^[a-z0-9.-]+\.archive\.org$/i.test(host),
            ),
          ),
        ]
          .sort((a, b) => Number(a === data.server) - Number(b === data.server))
          .slice(0, 2)
          .map(
            (host) =>
              `https://${host}${data.dir}/${f.name.split("/").map(encodeURIComponent).join("/")}?download=1`,
          )
      : [];
  books.push({
    id: "ia-" + candidate.identifier,
    title: shorten(title, 150),
    author: shorten(author, 100),
    category,
    format: "EPUB",
    size: Number(epub.size),
    description: shorten(
      `Historical edition published in ${year}. ${plain(m.description) || title} PDF scan and OCR-derived EPUB supplied by Internet Archive.`,
      1200,
    ),
    sourceUrl: `https://archive.org/details/${candidate.identifier}`,
    licenseUrl: license.replace(/^http:/, "https:"),
    publishedYear: year,
    editions: {
      EPUB: {
        url: url(epub),
        size: Number(epub.size),
        md5: epub.md5,
        fallbackUrls: fallbacks(epub),
      },
      PDF: {
        url: url(pdf),
        size: Number(pdf.size),
        md5: pdf.md5,
        fallbackUrls: fallbacks(pdf),
      },
    },
  });
  seen.add(key);
}
console.log(
  JSON.stringify(
    {
      accepted: books.length,
      rejected,
      categories: Object.fromEntries(
        ["Fiction", "Poetry", "Philosophy", "Essays", "Nonfiction"].map((c) => [
          c,
          books.filter((b) => b.category === c).length,
        ]),
      ),
    },
    null,
    2,
  ),
);
if (books.length !== limit)
  throw new Error(
    `Only ${books.length}/${limit} suitable books are cached so far.`,
  );
const output = new URL("../cloud/archive-books.json", import.meta.url);
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      source: "Internet Archive institutional collections",
      retrievedAt: new Date().toISOString(),
      books,
    },
    null,
    2,
  ) + "\n",
);
