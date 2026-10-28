import test from "node:test";
import assert from "node:assert/strict";
import {
  marginInput,
  marginCursor,
  marginsFeed,
  createMargin,
  cronAuthorized,
  PURGE_MARGINS,
  MARGIN_LIFETIME_MS,
} from "./margins.js";
test("Margins strictly accept plain text and browser identity, never attachments or client expiry", () => {
  const post = {
    handle: "reader_1",
    tag: "they/them",
    text: "  A thought <img src=x>  ",
  };
  assert.equal(marginInput(post).text, "A thought <img src=x>");
  for (const invalid of [
    { ...post, image: "x" },
    { ...post, expiresAt: "2099-01-01" },
    { ...post, text: "x".repeat(501) },
    { ...post, text: "   " },
    { ...post, text: { url: "x" } },
    { ...post, handle: "<script>" },
  ])
    assert.throws(() => marginInput(invalid));
  assert.equal(MARGIN_LIFETIME_MS, 259200000);
});
test("Feed bounds results, filters at expiry, and preserves timestamp precision in its cursor", async () => {
  const statements = [];
  const rows = Array.from({ length: 31 }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    text: "words",
    sortValue: "2026-10-28 10:00:00.123456+00",
  }));
  const sql = {
    query: async (text, values) => {
      statements.push({ text, values });
      return text.startsWith("DELETE") ? [] : rows;
    },
  };
  const result = await marginsFeed(sql);
  assert.equal(result.posts.length, 30);
  assert.ok(!("sortValue" in result.posts[0]));
  assert.match(statements[0].text, /expires_at<=now\(\)/);
  assert.match(statements[1].text, /expires_at>now\(\)/);
  assert.match(statements[1].text, /LIMIT 31/);
  assert.equal(
    marginCursor(result.nextCursor).at,
    "2026-10-28 10:00:00.123456+00",
  );
  await marginsFeed(sql, result.nextCursor);
  assert.match(statements[3].text, /created_at,id/);
  assert.equal(statements[3].values.length, 2);
  assert.throws(() => marginCursor("invalid"), /Invalid/);
  assert.throws(
    () =>
      marginCursor(
        Buffer.from(JSON.stringify({ id: "-".repeat(36), at: "1" })).toString(
          "base64url",
        ),
      ),
    /Invalid/,
  );
  assert.match(PURGE_MARGINS, /LIMIT 1000/);
});
test("Creation binds text and lets PostgreSQL set both lifecycle timestamps; cron is authenticated", async () => {
  let statement, parameters;
  const sql = {
    query: async (text, values) => {
      statement = text;
      parameters = values;
      return [{ id: values[0] }];
    },
  };
  await createMargin(sql, {
    handle: "reader",
    tag: "reader",
    text: "words ' ;--",
  });
  assert.ok(!statement.split("RETURNING")[0].includes("expires_at"));
  assert.ok(!statement.includes("words '"));
  assert.equal(parameters[3], "words ' ;--");
  assert.equal(cronAuthorized("Bearer secret", "secret"), true);
  assert.equal(cronAuthorized(undefined, "secret"), false);
  assert.equal(cronAuthorized("Bearer wrong", "secret"), false);
});
