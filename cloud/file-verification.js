import { canStreamSource } from "./epub-stream.js";
export async function probeEdition(
  edition,
  format,
  { fetcher = fetch, signal } = {},
) {
  let uncertain = false;
  const candidates = [
    ...new Set([edition.url, ...(edition.fallbackUrls || [])]),
  ].slice(0, 3);
  if (!candidates.length) return { status: "invalid" };
  for (const original of candidates) {
    if (!canStreamSource(original)) {
      uncertain = true;
      continue;
    }
    try {
      let url = original,
        response;
      for (let redirects = 0; redirects < 5; redirects++) {
        if (!canStreamSource(url)) throw Error("Unapproved redirect");
        response = await fetcher(url, {
          redirect: "manual",
          headers: {
            Range: "bytes=0-4095",
            "User-Agent": "ShelfChat/1.0 (reading edition verification)",
          },
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
            : AbortSignal.timeout(8000),
        });
        if (
          response.status >= 300 &&
          response.status < 400 &&
          response.headers.get("location")
        ) {
          const next = new URL(response.headers.get("location"), url).href;
          await response.body?.cancel();
          url = next;
          continue;
        }
        break;
      }
      if (!response.ok) {
        if (![404, 410].includes(response.status)) uncertain = true;
        await response.body?.cancel();
        continue;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        uncertain = true;
        continue;
      }
      let prefix = Buffer.alloc(0);
      try {
        while (prefix.length < 4096) {
          const { value, done } = await reader.read();
          if (done) break;
          prefix = Buffer.concat([
            prefix,
            Buffer.from(value).subarray(0, 4096 - prefix.length),
          ]);
        }
      } finally {
        await reader.cancel();
      }
      const valid =
        format === "PDF"
          ? prefix.subarray(0, 5).equals(Buffer.from("%PDF-"))
          : format === "EPUB" &&
            prefix.subarray(0, 2).equals(Buffer.from("PK")) &&
            prefix.includes(Buffer.from("application/epub+zip"));
      if (valid) return { status: "ok", url };
    } catch {
      uncertain = true;
    }
  }
  return { status: uncertain ? "unknown" : "invalid" };
}
export async function verifiedBook(book, options) {
  const editions = {};
  let uncertain = false;
  for (const [format, edition] of Object.entries(book.editions || {})) {
    const result = await probeEdition(edition, format, options);
    if (result.status === "ok")
      editions[format] = { ...edition, url: result.url };
    else if (result.status === "unknown") uncertain = true;
  }
  const format = editions[book.format] ? book.format : Object.keys(editions)[0];
  if (!format) {
    if (uncertain) throw Error("File verification temporarily unavailable");
    return null;
  }
  return {
    ...book,
    editions,
    format,
    url: editions[format].url,
    size: editions[format].size || 0,
  };
}
