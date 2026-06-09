import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSeedToilets } from "../server/database/seed/toilet-seed-loader.mjs";
import { sampleToiletsCsv } from "../test-fixtures/seed-csv.mjs";

test("seed loader keeps only toilets inside UK bounds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wheretoi-seed-test-"));
  const seedCsvPath = join(directory, "toilets.csv");
  const overseasRow =
    'overseas-test,true,true,false,true,true,Overseas toilet,true,Outside UK,,true,true,false,true,true,"[[],[],[],[],[],[],[]]","{""name"":""Overseas""}",2.3522,48.8566';

  try {
    await writeFile(seedCsvPath, `${sampleToiletsCsv.trimEnd()}\n${overseasRow}\n`, "utf8");

    const toilets = await loadSeedToilets(seedCsvPath);

    assert.ok(toilets.some((toilet) => toilet.id === "detail-test"));
    assert.equal(toilets.some((toilet) => toilet.id === "overseas-test"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
