import { appendFile } from "node:fs/promises";
import { verifiedBook } from "../cloud/file-verification.js";
// Long-running operator worker. The database password never leaves Vercel.
import { harvest } from "./harvest-library.mjs";
import { setTimeout as pause } from "node:timers/promises";
const endpoint = process.env.SHELFCHAT_IMPORT_ENDPOINT;
const token = process.env.SHELFCHAT_IMPORT_TOKEN;
if (
  !endpoint ||
  new URL(endpoint).protocol !== "https:" ||
  !/^[a-f0-9]{64}$/.test(token || "")
)
  throw Error(
    "Configure the HTTPS import endpoint and operator token in a private environment file.",
  );
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
async function commit(books) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ books }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(55000),
        ]),
      });
      const result = await response.json();
      if (!response.ok)
        throw Object.assign(Error(result.error || "Import rejected"), {
          status: response.status,
        });
      console.log(JSON.stringify({ event: "production-commit", ...result }));
      return;
    } catch (error) {
      if (
        controller.signal.aborted ||
        [400, 401, 403, 409, 413].includes(error.status) ||
        attempt === 5
      )
        throw error;
      await pause(Math.min(60000, 2000 * 2 ** attempt), undefined, {
        signal: controller.signal,
      });
    }
  }
}
while (!controller.signal.aborted) {
  try {
    const result = await harvest(
      {
        endpoint,
        sources: "gutenberg,archive",
        "max-items": 75000,
        batch: 25,
        interval: 2000,
        checkpoint: "data/remote-literary.checkpoint.json",
        resume: true,
      },
      {
        commit,
        verify: async (book) => {
          try {
            return await verifiedBook(book, { signal: controller.signal });
          } catch (error) {
            if (controller.signal.aborted) throw error;
            await appendFile(
              "data/unverified-retry.jsonl",
              JSON.stringify({
                book,
                reason: "temporary file verification failure",
                at: new Date().toISOString(),
              }) + "\n",
            );
            return null;
          }
        },
        signal: controller.signal,
      },
    );
    console.log(JSON.stringify({ event: "worker-finished", ...result }));
    break;
  } catch (error) {
    console.error(
      JSON.stringify({ event: "worker-paused", message: error.message }),
    );
    if (
      controller.signal.aborted ||
      /capacity|Unauthorized|401|403|blocked|rights|approved|match|rejected/i.test(
        error.message,
      )
    ) {
      process.exitCode = 1;
      break;
    }
    await pause(60000, undefined, { signal: controller.signal }).catch(
      () => {},
    );
  }
}
