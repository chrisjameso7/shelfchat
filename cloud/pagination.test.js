import test from "node:test";
import assert from "node:assert/strict";
import { catalogQuery, catalogPage } from "./catalog.js";
test("catalog query binds search values, limits rows and rejects mismatched cursors", () => {
  const params = new URLSearchParams({
    q: "'; DROP TABLE books; --",
    tag: "BookTok",
    limit: "2000000",
  });
  const query = catalogQuery(params);
  assert.equal(query.limit, 48);
  assert.ok(!query.text.includes("DROP TABLE"));
  assert.ok(!query.text.includes("OFFSET"));
  assert.match(query.text, /search_document @@/);
  assert.match(query.text, /created_at::text AS "sortValue"/);
  assert.equal(query.values.at(-1), 49);
  const cursor = Buffer.from(
    JSON.stringify({
      signature: query.signature,
      id: "x",
      value: "2026-01-01",
    }),
  ).toString("base64url");
  params.set("cursor", cursor);
  assert.match(catalogQuery(params).text, /\(created_at,id\) </);
  params.set("tag", "horror");
  assert.throws(() => catalogQuery(params), /Invalid page cursor/);
});
test("bounded page strips sort internals and produces cursor for next shelf", async () => {
  const sql = () => Promise.resolve([{ count: 2000000 }]);
  sql.query = () =>
    Promise.resolve([
      { id: "b", sortValue: "2026-02-02" },
      { id: "a", sortValue: "2026-02-01" },
    ]);
  const result = await catalogPage(sql, new URLSearchParams({ limit: "1" }));
  assert.equal(result.total, 2000000);
  assert.equal(result.books.length, 1);
  assert.ok(!("sortValue" in result.books[0]));
  assert.ok(result.nextCursor);
});

test("vibes use bound indexed subjects and fence pagination across atmospheres", () => {
  const params = new URLSearchParams({
    vibe: "rainy-sunday",
    availability: "downloadable",
  });
  const query = catalogQuery(params);
  assert.match(query.text, /tags @> ARRAY/);
  assert.match(query.text, /search_document @@ websearch_to_tsquery/);
  assert.ok(
    query.values.includes(
      "romance OR love OR courtship OR domestic OR friendship",
    ),
  );
  params.set(
    "cursor",
    Buffer.from(
      JSON.stringify({
        signature: query.signature,
        id: "book",
        value: "2026-01-01",
      }),
    ).toString("base64url"),
  );
  params.set("vibe", "deep-lore");
  assert.throws(() => catalogQuery(params), /Invalid page cursor/);
  assert.throws(
    () => catalogQuery(new URLSearchParams({ vibe: "bad-input" })),
    /Unknown vibe/,
  );
});
