import { once } from "node:events";
export function canStreamSource(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (u.hostname === "www.gutenberg.org" ||
        u.hostname === "gutenberg.org" ||
        u.hostname === "archive.org" ||
        /^(?:ia|dn)\d+[a-z0-9.-]*\.archive\.org$/i.test(u.hostname))
    );
  } catch {
    return false;
  }
}
// Only called with an edition already stored against an authorized book ID.
// No arbitrary URL parameter, cookies or user-controlled request headers.
export async function streamEpub(
  res,
  edition,
  { fetcher = fetch, maxBytes = 40 * 1024 * 1024 } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  const close = () => controller.abort();
  res.once("close", close);
  try {
    if (edition.size > maxBytes)
      throw Object.assign(
        Error("This EPUB exceeds the browser reading limit."),
        { status: 413 },
      );
    for (const candidate of [
      ...new Set([edition.url, ...(edition.fallbackUrls || [])]),
    ].slice(0, 3)) {
      let reader;
      try {
        let url = candidate,
          response;
        for (let redirect = 0; redirect < 4; redirect++) {
          if (!canStreamSource(url)) throw Error("Unapproved EPUB source");
          response = await fetcher(url, {
            redirect: "manual",
            headers: {
              "User-Agent":
                "ShelfChat/1.0 (user-requested public-domain reading)",
              Accept: "application/epub+zip",
            },
            signal: controller.signal,
          });
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location) throw Error("Missing redirect target");
            url = new URL(location, url).href;
            response = null;
            continue;
          }
          break;
        }
        if (!response?.ok || !response.body) {
          await response?.body?.cancel();
          throw Error("EPUB source is unavailable");
        }
        if (Number(response.headers.get("content-length")) > maxBytes) {
          await response.body.cancel();
          throw Error("EPUB source exceeds reading limit");
        }
        reader = response.body.getReader();
        let prefix = Buffer.alloc(0);
        while (prefix.length < 2) {
          const { done, value } = await reader.read();
          if (done) break;
          prefix = Buffer.concat([prefix, Buffer.from(value)]);
        }
        if (prefix[0] !== 80 || prefix[1] !== 75)
          throw Error("Source did not return an EPUB archive");
        let bytes = prefix.length;
        if (bytes > maxBytes) throw Error("EPUB source exceeds reading limit");
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/epub+zip");
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Cache-Control", "private, max-age=300");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.flushHeaders?.();
        if (!res.write(prefix))
          await once(res, "drain", { signal: controller.signal });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes)
            throw Error("EPUB source exceeds reading limit");
          if (!res.write(Buffer.from(value)))
            await once(res, "drain", { signal: controller.signal });
        }
        res.end();
        return;
      } catch (error) {
        if (res.headersSent) {
          res.destroy(error);
          return;
        }
        if (controller.signal.aborted) throw error;
      } finally {
        await reader?.cancel().catch(() => {});
      }
    }
    throw Object.assign(
      Error(
        "The source edition is unavailable. Please try the download or source link.",
      ),
      { status: 503 },
    );
  } finally {
    clearTimeout(timeout);
    res.removeListener("close", close);
    controller.abort();
  }
}
