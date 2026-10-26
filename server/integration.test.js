import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
test("shared catalog, uploads, marginalia, downloads and live feed", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "shelfchat-test-"));
  const port = 32000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: directory,
      SHELFCHAT_SKIP_ARCHIVE_IMPORT: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Server startup timed out")),
        15000,
      );
      child.stdout.on("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Server exited: ${code}`));
      });
    });
    const base = `http://localhost:${port}/api`;
    let response = await fetch(base + "/snapshot");
    const before = await response.json();
    assert.equal(before.books.length, 8);
    const live = await fetch(base + "/events");
    const reader = live.body.getReader();
    const event = new TextDecoder().decode((await reader.read()).value);
    assert.match(event, /"online":1/);
    await reader.cancel();
    const form = new FormData();
    form.set("title", "Test Archive");
    form.set("author", "Test Author");
    form.set("category", "Essays");
    form.set("rights", "on");
    form.set(
      "file",
      new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }),
      "test.pdf",
    );
    response = await fetch(base + "/books", { method: "POST", body: form });
    assert.equal(response.status, 201);
    const { id } = await response.json();
    response = await fetch(`${base}/books/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle: "reader",
        tag: "they/them",
        text: "A note in the margins.",
      }),
    });
    assert.equal(response.status, 201);
    response = await fetch(`${base}/books/${id}/download`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), /attachment/);
    assert.match(await response.text(), /%PDF/);
    await new Promise((r) => setTimeout(r, 40));
    const after = await (await fetch(base + "/snapshot")).json();
    assert.equal(after.books.find((b) => b.id === id).downloads, 1);
    assert.equal(after.notes[0].text, "A note in the margins.");
    response = await fetch(base + "/books", {
      method: "POST",
      body: new FormData(),
    });
    assert.equal(response.status, 400);
    assert.equal((await fetch(base + "/books/missing/download")).status, 404);
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", resolve);
    });
    rmSync(directory, { recursive: true, force: true });
  }
});
