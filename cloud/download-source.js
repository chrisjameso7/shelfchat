async function resolveCandidates(edition, format, fetcher, allowedHost) {
  const candidates = [edition.url, ...(edition.fallbackUrls || [])];
  for (const candidate of [...new Set(candidates)].slice(0, 3)) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" || !allowedHost(url.hostname)) continue;
      const signal = AbortSignal.timeout(8000);
      let destinationUrl = url.href,
        response;
      for (let redirects = 0; redirects < 5; redirects++) {
        const destination = new URL(destinationUrl);
        if (
          destination.protocol !== "https:" ||
          !allowedHost(destination.hostname) ||
          destination.username ||
          destination.password
        )
          throw Error("Unapproved file redirect");
        response = await fetcher(destination.href, {
          redirect: "manual",
          headers: {
            Range: "bytes=0-31",
            "User-Agent": "ShelfChat/1.0 (book download availability check)",
          },
          signal,
        });
        if (
          response.status >= 300 &&
          response.status < 400 &&
          response.headers.get("location")
        ) {
          destinationUrl = new URL(
            response.headers.get("location"),
            destination.href,
          ).href;
          await response.body?.cancel();
          continue;
        }
        break;
      }
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }
      const destination = new URL(response.url || destinationUrl);
      if (
        destination.protocol !== "https:" ||
        !allowedHost(destination.hostname)
      ) {
        await response.body?.cancel();
        continue;
      }
      const reader = response.body?.getReader();
      if (!reader) continue;
      let prefix = Buffer.alloc(0);
      try {
        while (prefix.length < 5) {
          const { value, done } = await reader.read();
          if (done) break;
          prefix = Buffer.concat([prefix, Buffer.from(value).subarray(0, 32)]);
        }
      } finally {
        await reader.cancel();
      }
      if (
        format === "PDF"
          ? prefix.subarray(0, 5).equals(Buffer.from("%PDF-"))
          : prefix.subarray(0, 2).equals(Buffer.from("PK"))
      )
        return destination.href;
    } catch {
      /* A source host may be temporarily unavailable; try its alternate. */
    }
  }
  const error = new Error(
    "The source archive is temporarily unavailable. Please try again shortly or use the source link on the book page.",
  );
  error.status = 503;
  throw error;
}

const archiveHost = (host) =>
  host === "archive.org" || host.endsWith(".archive.org");
const gutenbergHost = (host) =>
  host === "www.gutenberg.org" || host === "gutenberg.org";
export const resolveArchiveDownload = (edition, format, fetcher = fetch) =>
  resolveCandidates(edition, format, fetcher, archiveHost);
export function resolveEditionDownload(edition, format, fetcher = fetch) {
  const host = new URL(edition.url).hostname;
  if (archiveHost(host))
    return resolveCandidates(edition, format, fetcher, archiveHost);
  if (gutenbergHost(host))
    return resolveCandidates(edition, format, fetcher, gutenbergHost);
  return Promise.resolve(edition.url);
}
