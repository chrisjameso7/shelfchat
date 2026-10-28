import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { noteInput } from "../server/validation.js";
export const MARGIN_LIFETIME_MS = 72 * 60 * 60 * 1000;
export function marginInput(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => !["handle", "tag", "text", "requestId"].includes(key),
    )
  )
    throw Object.assign(
      Error("Margins accept only a handle, identity tag, and plain text."),
      { status: 400 },
    );
  if (
    body.requestId !== undefined &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      body.requestId,
    )
  )
    throw Object.assign(Error("Invalid request ID."), { status: 400 });
  const result = noteInput(body);
  if (result.text.length > 500)
    throw Object.assign(Error("Keep your margin to 500 characters."), {
      status: 400,
    });
  return {
    ...result,
    ...(body.requestId ? { requestId: body.requestId } : {}),
  };
}
export function marginCursor(value) {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        cursor.id,
      ) ||
      typeof cursor.at !== "string" ||
      cursor.at.length > 60 ||
      !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(
        cursor.at,
      ) ||
      Number.isNaN(Date.parse(cursor.at))
    )
      throw Error();
    return cursor;
  } catch {
    throw Object.assign(Error("Invalid margins cursor."), { status: 400 });
  }
}
export function cronAuthorized(header, secret = process.env.CRON_SECRET) {
  if (!secret || typeof header !== "string" || header.length > 512)
    return false;
  return timingSafeEqual(
    createHash("sha256").update(header).digest(),
    createHash("sha256")
      .update("Bearer " + secret)
      .digest(),
  );
}
export const PURGE_MARGINS = `DELETE FROM shelfchat_margins WHERE id IN (SELECT id FROM shelfchat_margins WHERE expires_at<=now() ORDER BY expires_at LIMIT 1000) RETURNING id`;
export async function marginsFeed(sql, cursorValue) {
  const cursor = marginCursor(cursorValue);
  await sql.query(PURGE_MARGINS, []);
  const values = cursor ? [cursor.at, cursor.id] : [];
  const rows = await sql.query(
    `SELECT id,handle,tag,text,created_at AS "createdAt",expires_at AS "expiresAt",created_at::text AS "sortValue" FROM shelfchat_margins WHERE expires_at>now() ${cursor ? "AND (created_at,id)<($1::timestamptz,$2::uuid)" : ""} ORDER BY created_at DESC,id DESC LIMIT 31`,
    values,
  );
  const last = rows[29];
  return {
    posts: rows.slice(0, 30).map(({ sortValue, ...post }) => post),
    nextCursor:
      rows.length > 30
        ? Buffer.from(
            JSON.stringify({ at: last.sortValue, id: last.id }),
          ).toString("base64url")
        : null,
    serverNow: new Date().toISOString(),
  };
}
export async function createMargin(sql, input) {
  const post = marginInput(input);
  const [row] = await sql.query(
    `INSERT INTO shelfchat_margins(id,handle,tag,text) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET id=excluded.id WHERE shelfchat_margins.handle=excluded.handle AND shelfchat_margins.tag=excluded.tag AND shelfchat_margins.text=excluded.text RETURNING id,handle,tag,text,created_at AS "createdAt",expires_at AS "expiresAt"`,
    [post.requestId || randomUUID(), post.handle, post.tag, post.text],
  );
  if (!row)
    throw Object.assign(
      Error("This request was already used. Edit your draft and try again."),
      { status: 409 },
    );
  return { post: row, serverNow: new Date().toISOString() };
}
