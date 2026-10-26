import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/index.js";
function response() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(value) {
      this.body = value;
    },
  };
}
test("cloud capabilities route is available without secrets", async () => {
  const res = response();
  await handler(
    { url: "/api/config", method: "GET", query: { route: "config" } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    transport: "poll",
    uploads: "blob",
  });
  assert.equal(res.headers["Cache-Control"], "no-store");
});
test("cloud API fails clearly if database configuration is absent", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const res = response();
    await handler(
      { url: "/api/health", method: "GET", query: { route: "health" } },
      res,
    );
    assert.equal(res.statusCode, 500);
    assert.match(JSON.parse(res.body).error, /temporarily unavailable/);
  } finally {
    if (previous) process.env.DATABASE_URL = previous;
  }
});
