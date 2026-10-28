import test from "node:test";
import assert from "node:assert/strict";
import { maintainCatalog } from "./catalog-maintenance.js";
test("cleanup only selects metadata-only rows; audit deletion rechecks files and row revision", async () => {
  const book = {
    id: "pg-155",
    format: "EPUB",
    url: "https://www.gutenberg.org/ebooks/155.epub.noimages",
    editions: {},
    revision: "2026-10-28 00:00:00+00",
    created: "2026-10-26 00:00:00+00",
  };
  let deletes = 0;
  const sql = {
    query: async (text) => {
      if (text.startsWith("DELETE")) {
        deletes++;
        assert.match(text, /last_synced_at IS NOT DISTINCT FROM/);
        return [{ id: book.id }];
      }
      return [book];
    },
  };
  const payload = {
    action: "prune",
    id: book.id,
    revision: book.revision,
    created: book.created,
  };
  assert.equal(
    (
      await maintainCatalog(sql, payload, {
        probe: async () => ({ status: "unknown" }),
      })
    ).removed,
    0,
  );
  assert.equal(
    (
      await maintainCatalog(sql, payload, {
        probe: async () => ({ status: "ok" }),
      })
    ).removed,
    0,
  );
  assert.equal(deletes, 0);
  assert.equal(
    (
      await maintainCatalog(
        sql,
        { ...payload, revision: "stale" },
        {
          probe: async () => {
            throw Error("should not probe");
          },
        },
      )
    ).removed,
    0,
  );
  assert.equal(
    (
      await maintainCatalog(sql, payload, {
        probe: async () => ({ status: "invalid" }),
      })
    ).removed,
    1,
  );
  assert.equal(deletes, 1);
  const cleanup = {
    query: async (text) => {
      assert.match(text, /availability='discovery'/);
      assert.match(text, /RETURNING id/);
      return [];
    },
  };
  assert.deepEqual(await maintainCatalog(cleanup, { action: "cleanup" }), {
    removed: 0,
  });
});
