import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDatabase } from "../server/database.mjs";
import { sampleToiletsCsv } from "../test-fixtures/seed-csv.mjs";

async function withSeededDatabase(callback, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "wheretoi-db-test-"));
  const seedCsvPath = join(directory, "toilets.csv");
  const dbFilePath = join(directory, "wheretoi.sqlite");
  let database;

  const originalModel = process.env.WHERETOI_CLEANLINESS_SCORING_MODEL;
  if (options.modelType) {
    process.env.WHERETOI_CLEANLINESS_SCORING_MODEL = options.modelType;
  }

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
    if (originalModel) {
      process.env.WHERETOI_CLEANLINESS_SCORING_MODEL = originalModel;
    } else {
      delete process.env.WHERETOI_CLEANLINESS_SCORING_MODEL;
    }
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
    const user = await database.getUserByUsername("demo");
    const userId = user.id;

    await assert.rejects(
      () => database.recordAccess({ userId, toiletName: "", eventType: "Paid access" }),
      /toiletName is required/
    );

    const before = await database.getAccount(userId);
    const result = await database.recordAccess({
      userId,
      toiletId: "detail-test",
      toiletName: "Prayer room washroom",
      eventType: "Paid access",
      amountGbp: 0.5,
      useFreeTicket: true
    });

    assert.equal(result.account.walletBalanceGbp, before.walletBalanceGbp - 0.5);
    assert.equal(result.account.monthlyFreeTicketsLeft, before.monthlyFreeTicketsLeft - 1);
    assert.equal(result.history[0].toiletId, "detail-test");
    assert.equal(result.history[0].eventType, "Paid access");
  });
});

test("database saves and retrieves comments for toilets", async () => {
  await withSeededDatabase(async (database) => {
    const user = await database.getUserByUsername("demo");
    const userId = user.id;
    const toiletId = "detail-test";
    const commentText = "This is a test comment";

    const initialComments = await database.getComments(toiletId);
    assert.equal(initialComments.length, 0);

    const updatedComments = await database.saveComment({
      toiletId,
      userId,
      username: user.username,
      commentText
    });

    assert.equal(updatedComments.length, 1);
    assert.equal(updatedComments[0].comment_text, commentText);
    assert.equal(updatedComments[0].toilet_id, toiletId);
    assert.equal(updatedComments[0].username, user.username);

    const fetchedComments = await database.getComments(toiletId);
    assert.deepEqual(fetchedComments, updatedComments);
  });
});

test("Mean Centering Model adjusts rating based on user average", async () => {
  await withSeededDatabase(async (database) => {
    const user = await database.getUserByUsername("demo");
    const userId = user.id;
    const toiletId = "detail-test";
    const otherToiletId = "limited-test";

    // 1. Establish a harsh history for the user (user avg = 1)
    await database.recordCleanlinessSurvey({ userId, toiletId: otherToiletId, rating: 1 });
    
    // 2. Submit a 5-star rating for our target toilet.
    // userAvg = 1. globalAvg = 3.
    // adjustedRating = 5 - (1 - 3) = 5 - (-2) = 7. Clamped to 5.
    const result = await database.recordCleanlinessSurvey({
      userId,
      toiletId,
      rating: 5
    });

    const updatedUser = await database.getUserById(userId);
    assert.equal(updatedUser.rating_total, 6); // 1 + 5
    assert.equal(updatedUser.rating_count, 2); // 1 + 1

    // First rating for this toilet. adjustedRating = 5.
    assert.equal(result.toilet.cleanliness, 5);
  }, { modelType: "mean_centering" });
});

test("Mean Centering Model handles generous users", async () => {
  await withSeededDatabase(async (database) => {
    const user = await database.getUserByUsername("demo");
    const userId = user.id;
    const toiletId = "detail-test";
    const otherToiletId = "limited-test";

    // 1. Establish a generous history (user avg = 5)
    await database.recordCleanlinessSurvey({ userId, toiletId: otherToiletId, rating: 5 });
    
    // 2. Submit a 3-star rating.
    // userAvg = 5. globalAvg = 3.
    // adjustedRating = 3 - (5 - 3) = 3 - 2 = 1.
    const result = await database.recordCleanlinessSurvey({
      userId,
      toiletId,
      rating: 3
    });

    // First rating for this toilet. adjustedRating = 1.
    assert.equal(result.toilet.cleanliness, 1);
  }, { modelType: "mean_centering" });
});
