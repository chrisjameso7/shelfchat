import test from "node:test";
import assert from "node:assert/strict";
import { createMargin, marginInput } from "./margins.js";
test("A retry reuses the requested ID without changing the expiry; conflicting content is rejected", async () => {
  const requestId = "12345678-1234-4234-8234-123456789abc";
  let statement, parameters;
  await createMargin(
    {
      query: async (text, values) => {
        statement = text;
        parameters = values;
        return [{ id: values[0] }];
      },
    },
    { handle: "reader", tag: "reader", text: "A margin", requestId },
  );
  assert.equal(parameters[0], requestId);
  assert.match(statement, /ON CONFLICT\(id\) DO UPDATE SET id=excluded.id/);
  assert.ok(!statement.includes("SET expires_at"));
  await assert.rejects(
    createMargin(
      { query: async () => [] },
      { handle: "reader", tag: "reader", text: "changed", requestId },
    ),
    (error) => error.status === 409,
  );
  assert.throws(() =>
    marginInput({
      handle: "reader",
      tag: "reader",
      text: "words",
      requestId: "bad-id",
    }),
  );
});
