import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  reportInput,
  reporterHash,
  createReport,
  submissionInput,
  submissionIdentity,
  createSubmission,
  ownSubmission,
  moderate,
} from "./trust.js";
import { catalogQuery } from "./catalog.js";
test("Browser-generated submission IDs survive retries and malformed IDs fail", () => {
  const input = { requestId: "12345678-1234-4234-8234-123456789abc", receipt: "a".repeat(64) };
  assert.equal(submissionIdentity(input).id, input.requestId);
  assert.deepEqual(submissionIdentity(input), submissionIdentity(input));
  assert.throws(() => submissionIdentity({ ...input, requestId: "invalid" }));
});
test("Reporting validates targets, binds details, and stores daily keyed hashes instead of request addresses", async () => {
  const address = "203.0.113.15",
    hash = reporterHash({ headers: { "x-forwarded-for": address } }, "secret");
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(!hash.includes(address));
  assert.notEqual(
    hash,
    reporterHash({ headers: { "x-forwarded-for": address } }, "other"),
  );
  assert.throws(() =>
    reportInput({ kind: "margin", targetId: "bad", reason: "abuse" }),
  );
  let query, args;
  await createReport(
    {
      query: async (text, values) => {
        query = text;
        args = values;
        return [];
      },
    },
    {
      kind: "book",
      targetId: "book",
      reason: "copyright",
      details: "A concern ' ; --",
    },
    hash,
  );
  assert.match(query, /ON CONFLICT DO NOTHING/);
  assert.ok(!query.includes("A concern"));
  assert.ok(args.includes(hash));
});
test("Submissions stay outside the catalog and return a private receipt; other owners get no data", async () => {
  const input = {
    title: "New work",
    author: "An author",
    category: "Fiction",
    format: "EPUB",
    url: "https://example.org/my-book.epub",
    rights: true,
    rightsStatement: "I am the author and permit free distribution.",
  };
  assert.throws(() => submissionInput({ ...input, rights: false }));
  assert.throws(() => submissionInput({ ...input, blobUrl: "public" }));
  assert.throws(() => submissionInput({ ...input, rightsStatement: "yes" }));
  let stored;
  const created = await createSubmission(
    {
      query: async (text, values) => {
        assert.match(text, /INSERT INTO shelfchat_submissions/);
        assert.ok(!text.includes("shelfchat_books"));
        stored = {
          id: values[0],
          owner_hash: values[1],
          title: values[2],
          status: "pending",
        };
        return [{ id: values[0], status: "pending" }];
      },
    },
    input,
  );
  assert.notEqual(stored.owner_hash, created.receipt);
  assert.equal(
    stored.owner_hash,
    createHash("sha256").update(created.receipt).digest("hex"),
  );
  const sql = { query: async () => [stored] };
  await assert.rejects(
    ownSubmission(sql, created.id, "Bearer " + "0".repeat(64)),
    (error) => error.status === 404,
  );
  const owned = await ownSubmission(
    sql,
    created.id,
    "Bearer " + created.receipt,
  );
  assert.equal(owned.submission.title, "New work");
  assert.ok(!("owner_hash" in owned.submission));
});
test("Moderation is reversible and never trusts a checkbox alone to approve a submission", async () => {
  const statements = [];
  const sql = {
    query: (text, values) => ({ text, values }),
    transaction: async (queries) => {
      statements.push(...queries);
      return [[{ id: "id" }], []];
    },
  };
  await moderate(sql, { action: "hide_book", id: "book" });
  assert.ok(
    statements.some(
      (q) => q.text.includes("is_hidden=$2") && q.values[1] === true,
    ),
  );
  assert.ok(statements.every((q) => !q.text.startsWith("DELETE")));
  const pending = { ...sql, query: async () => [{ id: "pending" }] };
  await assert.rejects(
    moderate(pending, { action: "approve_submission", id: "pending" }),
    /permission/,
  );
});
test("Search uses relevance by default, exact-title bonuses, and always excludes hidden books", () => {
  const query = catalogQuery(new URLSearchParams({ q: "A title" }));
  assert.match(query.text, /ts_rank_cd/);
  assert.match(query.text, /THEN 10/);
  assert.match(query.text, /NOT is_hidden/);
  assert.ok(query.values.includes("A title"));
  const newest = catalogQuery(
    new URLSearchParams({ q: "A title", sort: "newest" }),
  );
  assert.match(newest.text, /created_at::text/);
});
