import { neon } from "@neondatabase/serverless";
export function database() {
  if (!process.env.DATABASE_URL)
    throw new Error("Database connection is not configured.");
  return neon(process.env.DATABASE_URL);
}
export async function snapshot(sql, visitor, knownVersion) {
  const presence =
    visitor &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      visitor,
    )
      ? sql`INSERT INTO shelfchat_presence(id) VALUES(${visitor}) ON CONFLICT(id) DO UPDATE SET seen_at=now()`
      : sql`SELECT 1`;
  const [, activity, online] = await sql.transaction([
    presence,
    sql`SELECT id::text AS id,message,created_at AS "createdAt" FROM shelfchat_activity ORDER BY created_at DESC LIMIT 12`,
    sql`SELECT count(*)::integer AS count FROM shelfchat_presence WHERE seen_at>now()-interval '45 seconds'`,
  ]);
  return { books: [], notes: [], activity, online: online[0].count };
}

export async function rateLimit(sql, req) {
  const address =
    req.headers["x-vercel-forwarded-for"] ||
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    "unknown";
  const { createHash } = await import("node:crypto");
  const bucket =
    createHash("sha256").update(String(address).split(",")[0]).digest("hex") +
    ":" +
    Math.floor(Date.now() / 60000);
  const rows =
    await sql`INSERT INTO shelfchat_rate_limits(id,expires_at) VALUES(${bucket},now()+interval '2 minutes') ON CONFLICT(id) DO UPDATE SET count=shelfchat_rate_limits.count+1 RETURNING count`;
  if (rows[0].count > 20) {
    const error = new Error("A little too fast. Please try again in a minute.");
    error.status = 429;
    throw error;
  }
}
