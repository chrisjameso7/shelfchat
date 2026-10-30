import {
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
import { clean, safeUrl } from "../server/validation.js";
import { probeEdition } from "./file-verification.js";
export function reportInput(body) {
  if (
    !["book", "margin"].includes(body?.kind) ||
    typeof body.targetId !== "string" ||
    body.targetId.length > 180 ||
    !["spam", "abuse", "impersonation", "copyright", "other"].includes(
      body.reason,
    )
  )
    throw Object.assign(Error("Choose a report reason."), { status: 400 });
  if (
    body.kind === "margin" &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      body.targetId,
    )
  )
    throw Object.assign(Error("Invalid post."), { status: 400 });
  return {
    kind: body.kind,
    targetId: body.targetId,
    reason: body.reason,
    details: clean(body.details || "", 0, 500, "Details"),
  };
}
export function reporterHash(req, secret = process.env.CRON_SECRET) {
  if (!secret)
    throw Object.assign(Error("Reporting is temporarily unavailable."), {
      status: 503,
    });
  const address = String(
    req.headers["x-vercel-forwarded-for"] ||
      req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "unknown",
  ).split(",")[0];
  return createHmac("sha256", secret)
    .update(new Date().toISOString().slice(0, 10) + "\0" + address)
    .digest("hex");
}
export async function createReport(sql, input, hash) {
  const b = reportInput(input),
    table = b.kind === "book" ? "shelfchat_books" : "shelfchat_margins",
    column = b.kind === "book" ? "book_id" : "margin_id";
  const rows = await sql.query(
    `INSERT INTO shelfchat_reports(id,${column},reason,details,reporter_hash) SELECT $1,id,$2,$3,$4 FROM ${table} WHERE id=$5 ${b.kind === "margin" ? "AND expires_at>now() AND hidden_at IS NULL" : "AND NOT is_hidden"} ON CONFLICT DO NOTHING RETURNING id`,
    [randomUUID(), b.reason, b.details, hash, b.targetId],
  );
  return { received: true };
}
export function submissionInput(body) {
  if (body?.rights !== true)
    throw Object.assign(Error("Confirm your distribution rights."), {
      status: 400,
    });
  if (body.uploadId || body.blobUrl || body.file)
    throw Object.assign(
      Error(
        "Private file submissions are not configured. Submit an existing source link.",
      ),
      { status: 400 },
    );
  if (
    !["Fiction", "Philosophy", "Poetry", "Essays", "Nonfiction"].includes(
      body.category,
    ) ||
    !["PDF", "EPUB"].includes(body.format)
  )
    throw Object.assign(Error("Choose a category and file format."), {
      status: 400,
    });
  return {
    title: clean(body.title, 1, 150, "Title"),
    author: clean(body.author, 1, 100, "Author"),
    description: clean(body.description || "", 0, 1200, "Description"),
    category: body.category,
    format: body.format,
    url: safeUrl(body.url),
    rightsStatement: clean(body.rightsStatement, 20, 1000, "Rights statement"),
  };
}
export function submissionIdentity(input) {
  if (
    input.requestId !== undefined &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId)
  )
    throw Object.assign(Error("Invalid submission request."), { status: 400 });
  if (input.receipt !== undefined && !/^[a-f0-9]{64}$/.test(input.receipt))
    throw Object.assign(Error("Invalid private receipt."), { status: 400 });
  const id = input.requestId || randomUUID(),
    receipt = input.receipt || randomBytes(32).toString("hex"),
    hash = createHash("sha256").update(receipt).digest("hex");
  return { id, receipt, hash };
}
export async function createSubmission(sql, input) {
  const b = submissionInput(input),
    { id, receipt, hash } = submissionIdentity(input);
  const rows = await sql.query(
    "INSERT INTO shelfchat_submissions(id,owner_hash,title,author,description,category,format,url,rights_statement) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET id=excluded.id WHERE shelfchat_submissions.owner_hash=excluded.owner_hash AND (shelfchat_submissions.title,shelfchat_submissions.author,shelfchat_submissions.description,shelfchat_submissions.category,shelfchat_submissions.format,shelfchat_submissions.url,shelfchat_submissions.rights_statement)=(excluded.title,excluded.author,excluded.description,excluded.category,excluded.format,excluded.url,excluded.rights_statement) RETURNING id,status",
    [
      id,
      hash,
      b.title,
      b.author,
      b.description,
      b.category,
      b.format,
      b.url,
      b.rightsStatement,
    ],
  );
  if (!rows.length)
    throw Object.assign(
      Error("This receipt was used for a different submission."),
      { status: 409 },
    );
  return { id, receipt, status: rows[0].status };
}
export function ownerMatches(receipt, hash) {
  if (
    !/^[a-f0-9]{64}$/.test(receipt || "") ||
    !/^[a-f0-9]{64}$/.test(hash || "")
  )
    return false;
  return timingSafeEqual(
    createHash("sha256").update(receipt).digest(),
    Buffer.from(hash, "hex"),
  );
}
export async function ownSubmission(sql, id, authorization) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    throw Object.assign(Error("Submission not found."), { status: 404 });
  const [row] = await sql.query(
    "SELECT * FROM shelfchat_submissions WHERE id=$1",
    [id],
  );
  if (
    !row ||
    !ownerMatches(
      String(authorization || "").replace(/^Bearer /, ""),
      row.owner_hash,
    )
  )
    throw Object.assign(Error("Submission not found."), { status: 404 });
  const { owner_hash, ...submission } = row;
  return { submission };
}
export async function moderate(sql, b) {
  if (b.action === "queue") {
    const [reports, submissions, metrics] = await Promise.all([
      sql.query(
        "SELECT id,book_id,margin_id,reason,details,created_at FROM shelfchat_reports WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 50",
        [],
      ),
      sql.query(
        "SELECT id,title,author,description,category,format,url,rights_statement,created_at FROM shelfchat_submissions WHERE status='pending' ORDER BY created_at LIMIT 50",
        [],
      ),
      sql.query(
        "SELECT day,event,count::float8 AS count FROM shelfchat_daily_metrics WHERE day>=(now() AT TIME ZONE 'UTC')::date-14 ORDER BY day DESC,event",
        [],
      ),
    ]);
    return { reports, submissions, metrics };
  }
  if (typeof b.id !== "string" || b.id.length > 180)
    throw Object.assign(Error("Invalid moderation target."), { status: 400 });
  const event = sql.query(
    "INSERT INTO shelfchat_moderation_events(id,action,target_id) VALUES($1,$2,$3)",
    [randomUUID(), b.action, b.id],
  );
  if (["hide_margin", "restore_margin"].includes(b.action)) {
    if (!/^[a-f0-9-]{36}$/i.test(b.id))
      throw Object.assign(Error("Invalid post."), { status: 400 });
    const [rows] = await sql.transaction([
      sql.query(
        `UPDATE shelfchat_margins SET hidden_at=${b.action === "hide_margin" ? "now()" : "NULL"} WHERE id=$1 AND expires_at>now() RETURNING id`,
        [b.id],
      ),
      event,
    ]);
    return { updated: rows.length };
  }
  if (["hide_book", "restore_book"].includes(b.action)) {
    const [rows] = await sql.transaction([
      sql.query(
        "UPDATE shelfchat_books SET is_hidden=$2 WHERE id=$1 RETURNING id",
        [b.id, b.action === "hide_book"],
      ),
      event,
    ]);
    return { updated: rows.length };
  }
  if (b.action === "resolve_report") {
    const [rows] = await sql.transaction([
      sql.query(
        "UPDATE shelfchat_reports SET resolved_at=now() WHERE id=$1 RETURNING id",
        [b.id],
      ),
      event,
    ]);
    return { updated: rows.length };
  }
  if (b.action === "reject_submission") {
    const [rows] = await sql.transaction([
      sql.query(
        "UPDATE shelfchat_submissions SET status='rejected',review_note=$2,updated_at=now() WHERE id=$1 AND status='pending' RETURNING id",
        [b.id, clean(b.note || "", 0, 1000, "Review note")],
      ),
      event,
    ]);
    return { updated: rows.length };
  }
  if (b.action === "approve_submission") {
    const [submission] = await sql.query(
      "SELECT * FROM shelfchat_submissions WHERE id=$1 AND status='pending'",
      [b.id],
    );
    if (!submission)
      throw Object.assign(Error("Pending submission not found."), {
        status: 404,
      });
    if (b.rightsReviewed !== true)
      throw Object.assign(
        Error("Review distribution permission before approving."),
        { status: 400 },
      );
    const check = await probeEdition(
      { url: submission.url },
      submission.format,
    );
    if (check.status !== "ok")
      throw Object.assign(
        Error(
          "A readable file could not be verified. Keep this submission pending.",
        ),
        { status: 409 },
      );
    const [rows] = await sql.transaction([
      sql.query(
        `WITH approved AS (UPDATE shelfchat_submissions SET status='approved',review_note=$2,updated_at=now() WHERE id=$1 AND status='pending' RETURNING *) INSERT INTO shelfchat_books(id,title,author,category,format,description,url,source_url,availability,rights,rights_statement) SELECT 'submitted-'||id::text,title,author,category,format,description,url,url,'downloadable','permission',rights_statement FROM approved ON CONFLICT(id) DO NOTHING RETURNING id`,
        [b.id, clean(b.note || "", 0, 1000, "Review note")],
      ),
      event,
    ]);
    return { published: rows.length };
  }
  throw Object.assign(Error("Unknown moderation action."), { status: 400 });
}
