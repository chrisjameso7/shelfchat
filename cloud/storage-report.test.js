import test from "node:test";
import assert from "node:assert/strict";
import { capacityEstimate } from "./storage-report.js";
test("storage capacity includes indexes, excludes other database overhead and reserves headroom", () => {
  const result = capacityEstimate({
    databaseBytes: 20_000_000,
    catalogBytes: 10_000_000,
    records: 1000,
  });
  assert.equal(result.bytesPerRecord, 10000);
  assert.equal(result.estimatedTotalRecordsAtLimit, 99000);
  assert.equal(result.estimatedTotalRecordsWithHeadroom, 74000);
  assert.equal(
    capacityEstimate({ databaseBytes: 0, catalogBytes: 0, records: 0 })
      .estimatedTotalRecordsAtLimit,
    null,
  );
});
