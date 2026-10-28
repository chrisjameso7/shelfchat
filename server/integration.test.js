import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
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
    assert.equal(before.books.length, 0);
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
    const detail = await (await fetch(`${base}/books/${id}`)).json();
    assert.equal(detail.book.title, "Test Archive");
    assert.equal(detail.book.downloads, 0);
    const read = await (
      await fetch(`${base}/books/${id}/read?format=PDF`)
    ).json();
    assert.equal(read.format, "PDF");
    const content = await fetch(new URL(read.url, base));
    assert.equal(content.status, 200);
    assert.equal(content.headers.get("content-disposition"), "inline");
    assert.match(await content.text(), /%PDF/);
    assert.equal(
      (await (await fetch(`${base}/books/${id}`)).json()).book.downloads,
      0,
    );
    assert.equal(
      (await fetch(`${base}/books/${id}/read?format=BAD`)).status,
      404,
    );
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
    const marginInput = {
      handle: "reader",
      tag: "they/them",
      text: "A temporary thought <img src=x>",
    };
    response = await fetch(base + "/margins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(marginInput),
    });
    assert.equal(response.status, 201);
    const { post } = await response.json();
    assert.equal(
      Date.parse(post.expiresAt) - Date.parse(post.createdAt),
      72 * 60 * 60 * 1000,
    );
    assert.equal(post.text, marginInput.text);
    response = await fetch(base + "/margins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...marginInput, image: "not-allowed" }),
    });
    assert.equal(response.status, 400);
    const marginDB = new DatabaseSync(path.join(directory, "shelfchat.sqlite"));
    try {
      const expiredId = randomUUID();
      const insertMargin = marginDB.prepare(
        "INSERT INTO margins(id,handle,tag,text,createdAt,expiresAt) VALUES(?,?,?,?,?,?)",
      );
      insertMargin.run(
        expiredId,
        "expired",
        "reader",
        "Expired fixture",
        new Date(Date.now() - 73 * 3600000).toISOString(),
        new Date(Date.now() - 3600000).toISOString(),
      );
      for (let i = 0; i < 31; i++)
        insertMargin.run(
          randomUUID(),
          "reader",
          "reader",
          "Pagination fixture " + i,
          new Date(Date.now() - i * 1000).toISOString(),
          new Date(Date.now() + 3600000).toISOString(),
        );
      const feed = await (await fetch(base + "/margins")).json();
      assert.equal(feed.posts.length, 30);
      assert.ok(feed.nextCursor);
      assert.ok(!feed.posts.some((p) => p.id === expiredId));
      assert.equal(
        marginDB
          .prepare("SELECT count(*) AS count FROM margins WHERE id=?")
          .get(expiredId).count,
        0,
      );
      const older = await (
        await fetch(base + "/margins?cursor=" + feed.nextCursor)
      ).json();
      assert.equal(older.posts.length, 2);
      assert.ok(
        !older.posts.some((p) => feed.posts.some((first) => first.id === p.id)),
      );
    } finally {
      marginDB.close();
    }
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", resolve);
    });
    rmSync(directory, { recursive: true, force: true });
  }
});
