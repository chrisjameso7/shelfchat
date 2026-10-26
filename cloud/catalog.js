// Cursor pagination keeps deep shelves independent of OFFSET and library size.
export const PUBLIC_BOOK = `id,title,author,category,format,size::float8 AS size,downloads::float8 AS downloads,description,created_at AS "createdAt",source_url AS "sourceUrl",license_url AS "licenseUrl",published_year AS "publishedYear",availability,tags,(SELECT coalesce(jsonb_object_agg(key,jsonb_build_object('size',value->'size')),'{}'::jsonb) FROM jsonb_each(editions)) AS editions`;
const SORTS = {
  newest: ["created_at", "DESC"],
  title: ["lower(title)", "ASC"],
  popular: ["downloads", "DESC"],
};
export function catalogQuery(params) {
  const sort = params.get("sort") || "newest";
  const [column, direction] = SORTS[sort] || SORTS.newest;
  const limit = Math.min(
    48,
    Math.max(1, Math.floor(Number(params.get("limit"))) || 24),
  );
  const values = [];
  const bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  const where = [];
  const q = (params.get("q") || "").trim().slice(0, 160);
  if (q)
    where.push(`search_document @@ websearch_to_tsquery('simple',${bind(q)})`);
  const category = params.get("category");
  if (category) where.push(`category=${bind(category)}`);
  const format = params.get("format");
  if (format)
    where.push(
      `availability='downloadable' AND (format=${bind(format)} OR editions ? ${bind(format)})`,
    );
  const tag = params.get("tag");
  if (tag)
    where.push(
      `tags @> ARRAY[${bind(tag.toLowerCase().slice(0, 60))}]::text[]`,
    );
  if (params.get("availability") === "downloadable")
    where.push(`availability='downloadable'`);
  const signature = JSON.stringify([
    sort,
    q,
    category,
    format,
    tag,
    params.get("availability"),
  ]);
  if (params.get("cursor")) {
    try {
      const c = JSON.parse(
        Buffer.from(params.get("cursor"), "base64url").toString(),
      );
      if (
        c.signature !== signature ||
        typeof c.id !== "string" ||
        c.id.length > 180 ||
        !["string", "number"].includes(typeof c.value)
      )
        throw Error();
      where.push(
        `(${column},id) ${direction === "ASC" ? ">" : "<"} (${bind(c.value)},${bind(c.id)})`,
      );
    } catch {
      const e = new Error("Invalid page cursor. Restart your search.");
      e.status = 400;
      throw e;
    }
  }
  return {
    text: `SELECT ${PUBLIC_BOOK},${column === 'created_at' ? 'created_at::text' : column} AS "sortValue" FROM shelfchat_books ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${column} ${direction},id ${direction} LIMIT ${bind(limit + 1)}`,
    values,
    limit,
    signature,
  };
}
export async function catalogPage(sql, params) {
  const query = catalogQuery(params);
  const [rows, stats] = await Promise.all([
    sql.query(query.text, query.values),
    sql`SELECT book_count::float8 AS count FROM shelfchat_catalog_stats WHERE id=true`,
  ]);
  const hasMore = rows.length > query.limit;
  const books = rows.slice(0, query.limit);
  const last = books.at(-1);
  const nextCursor = hasMore
    ? Buffer.from(
        JSON.stringify({
          signature: query.signature,
          id: last.id,
          value: last.sortValue,
        }),
      ).toString("base64url")
    : null;
  return {
    books: books.map(({ sortValue, ...book }) => book),
    nextCursor,
    total: stats[0]?.count || 0,
  };
}
