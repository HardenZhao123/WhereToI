import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDatabase } from "../server/database.mjs";
import { sampleToiletsCsv } from "../test-fixtures/seed-csv.mjs";

async function withSeededDatabase(callback) {
  const directory = await mkdtemp(join(tmpdir(), "wheretoi-db-test-"));
  const seedCsvPath = join(directory, "toilets.csv");
  const dbFilePath = join(directory, "wheretoi.sqlite");
  let database;

  try {
    await writeFile(seedCsvPath, sampleToiletsCsv, "utf8");
    database = await createDatabase({
      rootDirectory: directory,
      dbFilePath,
      seedCsvPath
    });
    await callback(database);
  } finally {
    await database?.close?.();
    await rm(directory, { recursive: true, force: true });
  }
}

test("SQLite database seeds and returns expanded toilet feature data", async () => {
  await withSeededDatabase(async (database) => {
    const toilets = await database.getToilets();
    const detailToilet = toilets.find((toilet) => toilet.id === "detail-test");

    assert.equal(toilets.length, 2);
    assert.equal(detailToilet.features.babyChanging, "Y");
    assert.equal(detailToilet.features.bidet, "Y");
    assert.equal(detailToilet.features.radarKey, "Y");
    assert.equal(detailToilet.features.free, "Y");
  });
});

test("SQLite database keeps accessible-only filtering behavior", async () => {
  await withSeededDatabase(async (database) => {
    const toilets = await database.getToilets({ accessibleOnly: true });

    assert.deepEqual(
      toilets.map((toilet) => toilet.id),
      ["detail-test"]
    );
  });
});

test("recordAccess validates inputs and persists wallet/history changes", async () => {
  await withSeededDatabase(async (database) => {
    await assert.rejects(
      () => database.recordAccess({ toiletName: "", eventType: "QR access" }),
      /toiletName is required/
    );

    const before = await database.getAccount();
    const result = await database.recordAccess({
      toiletId: "detail-test",
      toiletName: "Prayer room washroom",
      eventType: "QR access",
      amountGbp: 0.5,
      useFreeTicket: true
    });

    assert.equal(result.account.walletBalanceGbp, before.walletBalanceGbp - 0.5);
    assert.equal(result.account.monthlyFreeTicketsLeft, before.monthlyFreeTicketsLeft - 1);
    assert.equal(result.history[0].toiletId, "detail-test");
    assert.equal(result.history[0].eventType, "QR access");
  });
});
