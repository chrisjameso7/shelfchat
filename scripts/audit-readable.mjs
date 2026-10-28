import { readFile, writeFile } from "node:fs/promises";
import { probeEdition } from "../cloud/file-verification.js";
import { setTimeout as pause } from "node:timers/promises";
const endpoint = new URL(
    "/api/admin/catalog-maintenance",
    process.env.SHELFCHAT_IMPORT_ENDPOINT,
  ),
  token = process.env.SHELFCHAT_IMPORT_TOKEN;
async function request(payload) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(55000),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Audit rejected");
  return result;
}
const path = "data/readability-audit.checkpoint.json";
let state;
try {
  state = JSON.parse(await readFile(path, "utf8"));
} catch {
  state = { cursor: "", checked: 0, removed: 0, uncertain: 0 };
}
console.log(
  JSON.stringify({
    event: "metadata-cleanup",
    ...(await request({ action: "cleanup" })),
  }),
);
while (true) {
  try {
    const { books } = await request({ action: "page", cursor: state.cursor });
    if (!books.length) break;
    for (const book of books) {
      const editions = Object.keys(book.editions || {}).length
        ? book.editions
        : { [book.format]: { url: book.url } };
      let valid = false,
        unknown = false;
      for (const [format, file] of Object.entries(editions)) {
        const result = await probeEdition(file, format);
        valid ||= result.status === "ok";
        unknown ||= result.status === "unknown";
        await pause(2000);
        if (valid) break;
      }
      if (!valid && !unknown) {
        await pause(10000);
        let confirmed = true;
        for (const [format, file] of Object.entries(editions))
          if ((await probeEdition(file, format)).status !== "invalid")
            confirmed = false;
        if (confirmed) {
          const result = await request({
            action: "prune",
            id: book.id,
            revision: book.revision,
            created: book.created,
          });
          state.removed += result.removed;
        }
      }
      if (unknown && !valid) state.uncertain++;
      state.checked++;
      state.cursor = book.id;
      await writeFile(path, JSON.stringify(state));
    }
    console.log(JSON.stringify({ event: "audit-progress", ...state }));
  } catch (error) {
    console.error(error.message);
    await pause(60000);
  }
}
console.log(JSON.stringify({ event: "audit-finished", ...state }));
