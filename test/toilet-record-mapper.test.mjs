import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, rowsToObjects } from "../src/app/utils/csv.js";
import { mapRecordToToilet } from "../src/app/toilets/toilet-record-mapper.js";
import { sampleToiletsCsv } from "../test-fixtures/seed-csv.mjs";

test("maps raw toilet records into expanded detail features", () => {
  const records = rowsToObjects(parseCsv(sampleToiletsCsv));
  const toilet = mapRecordToToilet(records.find((record) => record.id === "detail-test"));

  assert.equal(toilet.id, "detail-test");
  assert.equal(toilet.area, "South Kensington");
  assert.equal(toilet.paid, false);
  assert.deepEqual(toilet.features, {
    women: "Y",
    men: "Y",
    accessible: "Y",
    neutral: "Y",
    children: "Y",
    babyChanging: "Y",
    bidet: "Y",
    automatic: "N",
    urinalOnly: "N",
    radarKey: "Y",
    free: "Y"
  });
});

test("filters inactive records and records without valid coordinates", () => {
  const records = rowsToObjects(parseCsv(sampleToiletsCsv));
  const inactive = mapRecordToToilet(records.find((record) => record.id === "inactive-test"));
  const missingCoordinates = mapRecordToToilet({ ...records[0], latitude: "unknown", longitude: "unknown" });

  assert.equal(inactive, null);
  assert.equal(missingCoordinates, null);
});
