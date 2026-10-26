import test from "node:test";
import assert from "node:assert/strict";
import { safeUrl, noteInput, clean } from "./validation.js";
test("rejects non-public or executable links", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://example.com/a.pdf",
    "https://127.0.0.1/a",
    "https://localhost/a",
    "https://user:pass@example.com/a",
  ])
    assert.throws(() => safeUrl(url));
  assert.equal(
    safeUrl("https://example.com/a.epub"),
    "https://example.com/a.epub",
  );
});
test("notes preserve unicode but validate handle and lengths", () => {
  assert.deepEqual(
    noteInput({
      handle: " book_lover ",
      tag: "they/them",
      text: "  Beautiful — yes.  ",
    }),
    { handle: "book_lover", tag: "they/them", text: "Beautiful — yes." },
  );
  for (const body of [
    { handle: "a", tag: "x", text: "note" },
    { handle: "bad name", tag: "x", text: "note" },
    { handle: "reader", tag: "x", text: "" },
    { handle: "reader", tag: "x", text: "x".repeat(2001) },
  ])
    assert.throws(() => noteInput(body));
});
test("required fields cannot be whitespace or objects", () => {
  assert.throws(() => clean("   ", 1, 100, "Title"));
  assert.throws(() => clean({}, 1, 100, "Title"));
});
