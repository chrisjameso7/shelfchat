// Estimates are based on allocated table + index bytes, not book file sizes.
export function capacityEstimate(
  { databaseBytes, catalogBytes, records },
  limitBytes = 1_000_000_000,
) {
  const bytesPerRecord = records > 0 ? catalogBytes / records : 0;
  const otherBytes = Math.max(0, databaseBytes - catalogBytes);
  const estimate = (ratio) =>
    bytesPerRecord
      ? Math.max(
          0,
          Math.floor((limitBytes * ratio - otherBytes) / bytesPerRecord),
        )
      : null;
  return {
    databaseBytes,
    catalogBytes,
    records,
    limitBytes,
    bytesPerRecord: Math.round(bytesPerRecord),
    estimatedTotalRecordsAtLimit: estimate(1),
    estimatedTotalRecordsWithHeadroom: estimate(0.75),
    note: "Rough extrapolation of current allocated metadata and indexes. Reserves 25% of the limit for growth, notes and maintenance. External PDF/EPUB files are excluded; actual Neon metering and future records can differ.",
  };
}
export async function storageReport(sql) {
  const [row] =
    await sql`SELECT pg_database_size(current_database())::float8 AS "databaseBytes",pg_total_relation_size('shelfchat_books')::float8 AS "catalogBytes",(SELECT book_count::float8 FROM shelfchat_catalog_stats WHERE id=true) AS records`;
  return capacityEstimate(row);
}
