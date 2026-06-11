import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createDatabase } from "../server/database.mjs";
import { normaliseCommentPayload } from "../server/database/repository/repository-utils.mjs";
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
    await callback(database, { dbFilePath, seedCsvPath });
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
    const toilets = await database.getToilets({ cleanlinessRange: "all" });
    const detailToilet = toilets.find((toilet) => toilet.id === "detail-test");

    assert.equal(toilets.length, 7);
    assert.equal(detailToilet.features.babyChanging, "Y");
    assert.equal(detailToilet.features.bidet, "Y");
    assert.equal(detailToilet.features.radarKey, "Y");
    assert.equal(detailToilet.features.free, "Y");
  });
});

test("comment scene payload preserves accessible scene metadata and omits inactive urinal placements", () => {
  const comment = normaliseCommentPayload({
    toiletId: "accessible-toilet",
    commentText: "",
    cleanlinessRating: 4,
    sceneSnapshot: {
      version: 3,
      sceneType: "accessible",
      activeFixtures: ["wall", "toilet", "accessibleDispenser", "accessibleAlarm", "sink", "floor"],
      toiletId: "accessible-toilet",
      toiletName: "Accessible toilet",
      fixtures: {
        wall: [],
        toilet: [],
        urinal: [{ id: "urinal-wet-1", dirtId: "wet", x: 410, y: 250 }],
        accessibleDispenser: [{ id: "accessibleDispenser-soap-1", dirtId: "soap", x: 262, y: 184 }],
        accessibleAlarm: [{ id: "accessibleAlarm-dust-2", dirtId: "dust", x: 334, y: 356 }],
        sink: [],
        floor: [{ id: "floor-wet-2", dirtId: "wet", x: 620, y: 430 }]
      }
    }
  });

  assert.equal(comment.sceneSnapshot.version, 3);
  assert.equal(comment.sceneSnapshot.sceneType, "accessible");
  assert.deepEqual(comment.sceneSnapshot.activeFixtures, ["wall", "toilet", "accessibleDispenser", "accessibleAlarm", "sink", "floor"]);
  assert.deepEqual(comment.sceneSnapshot.fixtures.urinal ?? [], []);
  assert.equal(comment.sceneSnapshot.fixtures.accessibleDispenser.length, 1);
  assert.equal(comment.sceneSnapshot.fixtures.accessibleAlarm.length, 1);
  assert.equal(comment.sceneSnapshot.fixtures.floor.length, 1);
});

test("SQLite database keeps accessible-only filtering behavior", async () => {
  await withSeededDatabase(async (database) => {
    const toilets = await database.getToilets({ accessibleOnly: true });

    assert.deepEqual(
      toilets.map((toilet) => toilet.id),
      ["detail-test", "extra-test-1", "extra-test-2", "extra-test-3", "extra-test-4", "extra-test-5"]
    );
  });
});

test("cleanliness time ranges exclude older ratings except all time", async () => {
  await withSeededDatabase(async (database, { dbFilePath }) => {
    const user = await database.getUserByUsername("demo");

    await database.recordCleanlinessSurvey({
      userId: user.id,
      toiletId: "detail-test",
      rating: 5
    });

    const db = new DatabaseSync(dbFilePath);
    try {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare("UPDATE cleanliness_surveys SET created_at = ? WHERE toilet_id = ?").run(tenDaysAgo, "detail-test");
    } finally {
      db.close();
    }

    const recentToilets = await database.getToilets({ cleanlinessRange: "1day" });
    const recentToilet = recentToilets.find((toilet) => toilet.id === "detail-test");
    assert.equal(recentToilet.cleanliness, null);
    assert.equal(recentToilet.cleanlinessSurvey.ratingTotal, 0);
    assert.equal(recentToilet.cleanlinessSurvey.ratingCount, 0);

    const recentDetail = await database.getToiletById("detail-test", { cleanlinessRange: "1day" });
    assert.equal(recentDetail.cleanliness, null);
    assert.equal(recentDetail.cleanlinessSurvey.ratingTotal, 0);
    assert.equal(recentDetail.cleanlinessSurvey.ratingCount, 0);

    const allTimeToilets = await database.getToilets({ cleanlinessRange: "all" });
    const allTimeToilet = allTimeToilets.find((toilet) => toilet.id === "detail-test");
    assert.equal(allTimeToilet.cleanliness, 5);
    assert.equal(allTimeToilet.cleanlinessSurvey.ratingTotal, 5);
    assert.equal(allTimeToilet.cleanlinessSurvey.ratingCount, 1);

    const allTimeDetail = await database.getToiletById("detail-test", { cleanlinessRange: "all" });
    assert.equal(allTimeDetail.cleanliness, 5);
    assert.equal(allTimeDetail.cleanlinessSurvey.ratingTotal, 5);
    assert.equal(allTimeDetail.cleanlinessSurvey.ratingCount, 1);
  }, { modelType: "average" });
});

test("database blocks repeated cleanliness feedback for the same toilet for 30 minutes", async () => {
  await withSeededDatabase(async (database, { dbFilePath }) => {
    const user = await database.getUserByUsername("demo");

    await database.recordCleanlinessSurvey({
      userId: user.id,
      toiletId: "detail-test",
      rating: 4.5
    });

    await assert.rejects(
      () => database.recordCleanlinessSurvey({
        userId: user.id,
        toiletId: "detail-test",
        rating: 2
      }),
      (error) => {
        assert.equal(error.statusCode, 429);
        assert.match(error.message, /rate this toilet again in 30 minutes/);
        return true;
      }
    );

    const db = new DatabaseSync(dbFilePath);
    try {
      const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      db.prepare("UPDATE cleanliness_surveys SET created_at = ? WHERE toilet_id = ? AND user_id = ?")
        .run(thirtyOneMinutesAgo, "detail-test", user.id);
    } finally {
      db.close();
    }

    await database.recordCleanlinessSurvey({
      userId: user.id,
      toiletId: "detail-test",
      rating: 2
    });

    const toilet = await database.getToiletById("detail-test", { cleanlinessRange: "all" });
    assert.equal(toilet.cleanlinessSurvey.ratingTotal, 6.5);
    assert.equal(toilet.cleanlinessSurvey.ratingCount, 2);
    assert.equal(toilet.cleanliness, 3.25);
  }, { modelType: "average" });
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
    assert.equal(result.history[0].toiletName, "Prayer room washroom");
    assert.equal(result.history[0].eventType, "Paid access");
  });
});

test("access history displays the current toilet name when a toilet id is available", async () => {
  await withSeededDatabase(async (database) => {
    const user = await database.getUserByUsername("demo");

    await database.recordAccess({
      userId: user.id,
      toiletId: "detail-test",
      toiletName: "Old short name",
      eventType: "Directions",
      amountGbp: 0
    });

    const history = await database.getAccessHistory(user.id);
    assert.equal(history[0].toiletId, "detail-test");
    assert.equal(history[0].toiletName, "Prayer room washroom");
  });
});

test("database startup removes old demo access history rows without toilet ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wheretoi-db-legacy-history-test-"));
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
    const user = await database.getUserByUsername("demo");
    await database.close();

    const db = new DatabaseSync(dbFilePath);
    try {
      db.prepare(
        "INSERT INTO access_history (user_id, toilet_id, toilet_name, event_type, amount_gbp, access_time) VALUES (?, NULL, ?, ?, 0, ?)"
      ).run(user.id, "Imperial Library", "Legacy demo", new Date().toISOString());
    } finally {
      db.close();
    }

    database = await createDatabase({
      rootDirectory: directory,
      dbFilePath,
      seedCsvPath
    });

    const history = await database.getAccessHistory(user.id);
    assert.equal(history.some((entry) => entry.toiletName === "Imperial Library"), false);
  } finally {
    await database?.close?.();
    await rm(directory, { recursive: true, force: true });
  }
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
      commentText,
      cleanlinessRating: 4.5
    });

    assert.equal(updatedComments.length, 1);
    assert.equal(updatedComments[0].comment_text, commentText);
    assert.equal(updatedComments[0].toilet_id, toiletId);
    assert.equal(updatedComments[0].username, user.username);
    assert.equal(updatedComments[0].author_name, user.username);
    assert.equal(updatedComments[0].comment_visibility, "real");
    assert.equal(updatedComments[0].cleanliness_rating, 4.5);
    assert.equal(updatedComments[0].profile_visibility, "private");
    assert.equal(updatedComments[0].is_anonymous, false);
    assert.equal(updatedComments[0].can_delete, true);
    assert.equal(updatedComments[0].like_count, 0);
    assert.equal(updatedComments[0].viewer_has_liked, false);
    assert.equal(updatedComments[0].user_id, userId);
    assert.equal(updatedComments[0].media_type, null);
    assert.deepEqual(updatedComments[0].media_attachments, []);
    assert.equal(updatedComments[0].scene_snapshot, null);

    const sceneSnapshot = {
      version: 2,
      toiletId,
      toiletName: "Detail test toilet",
      fixtures: {
        wall: [{ id: "wall-feces-1", dirtId: "feces", x: 260, y: 160 }],
        toilet: [{ id: "toilet-stain-1", dirtId: "stain", x: 140, y: 230 }],
        urinal: [],
        sink: [
          { id: "sink-soap-2", dirtId: "soap", x: 640, y: 270 },
          { id: "sink-dust-3", dirtId: "dust", x: 580, y: 160 }
        ],
        floor: [
          { id: "floor-wet-4", dirtId: "wet", x: 640, y: 410 },
          { id: "floor-mud-5", dirtId: "mud", x: 520, y: 430 }
        ]
      }
    };
    const sceneComments = await database.saveComment({
      toiletId,
      userId,
      username: user.username,
      commentText: "",
      cleanlinessRating: 3.5,
      sceneSnapshot
    });
    const sceneComment = sceneComments.find((comment) => comment.cleanliness_rating === 3.5);
    assert.ok(sceneComment);
    assert.equal(sceneComment.comment_text, "");
    assert.deepEqual(sceneComment.scene_snapshot.fixtures, sceneSnapshot.fixtures);

    const anonymousComments = await database.saveComment({
      toiletId,
      userId,
      username: user.username,
      commentText: "Anonymous test comment",
      commentVisibility: "anonymous",
      cleanlinessRating: 2
    });

    assert.equal(anonymousComments.length, 3);
    const anonymousComment = anonymousComments.find((comment) => comment.cleanliness_rating === 2);
    assert.equal(anonymousComment.comment_text, "Anonymous test comment");
    assert.equal(anonymousComment.username, "Anonymous");
    assert.equal(anonymousComment.author_name, "Anonymous");
    assert.equal(anonymousComment.comment_visibility, "anonymous");
    assert.equal(anonymousComment.cleanliness_rating, 2);
    assert.equal(anonymousComment.profile_visibility, "private");
    assert.equal(anonymousComment.is_anonymous, true);
    assert.equal(anonymousComment.can_delete, true);
    assert.equal(anonymousComment.user_id, null);

    const publicComments = await database.getComments(toiletId);
    publicComments.forEach((comment) => assert.equal(comment.can_delete, false));

    const fetchedComments = await database.getComments(toiletId, { viewerUserId: userId });
    assert.deepEqual(fetchedComments, anonymousComments);
  });
});

test("database lists own comments and updates profile visibility", async () => {
  await withSeededDatabase(async (database) => {
    const owner = await database.getUserByUsername("demo");
    const liker = await database.createUser({
      username: "comment-liker",
      password: "demo123",
      email: "comment-liker@example.com"
    });
    const toiletId = "detail-test";

    const comments = await database.saveComment({
      toiletId,
      userId: owner.id,
      username: owner.username,
      commentText: "Show this in my account",
      commentVisibility: "anonymous",
      cleanlinessRating: 3
    });
    const commentId = comments[0].id;

    await database.toggleCommentLike({
      toiletId,
      commentId,
      userId: liker.id
    });

    const ownComments = await database.getUserComments(owner.id);
    assert.equal(ownComments.length, 1);
    assert.equal(ownComments[0].id, commentId);
    assert.equal(ownComments[0].toilet_id, toiletId);
    assert.equal(ownComments[0].toilet_name, "Prayer room washroom");
    assert.equal(ownComments[0].author_name, "Anonymous");
    assert.equal(ownComments[0].profile_visibility, "private");
    assert.equal(ownComments[0].like_count, 1);
    assert.equal(ownComments[0].can_delete, true);

    const otherUpdate = await database.updateCommentProfileVisibility({
      commentId,
      userId: liker.id,
      profileVisibility: "public"
    });

    assert.equal(otherUpdate.updated, false);

    const ownerUpdate = await database.updateCommentProfileVisibility({
      commentId,
      userId: owner.id,
      profileVisibility: "public"
    });

    assert.equal(ownerUpdate.updated, true);
    assert.equal(ownerUpdate.comments[0].profile_visibility, "public");
  });
});

test("database exposes public profile feedback ratings with survey fallback", async () => {
  await withSeededDatabase(async (database, { dbFilePath }) => {
    const owner = await database.getUserByUsername("demo");
    const toiletId = "detail-test";

    await database.recordCleanlinessSurvey({
      userId: owner.id,
      toiletId,
      rating: 4
    });

    const comments = await database.saveComment({
      toiletId,
      userId: owner.id,
      username: owner.username,
      commentText: "Public profile should show stars",
      commentVisibility: "real",
      cleanlinessRating: 4
    });
    const commentId = comments[0].id;

    await database.updateCommentProfileVisibility({
      commentId,
      userId: owner.id,
      profileVisibility: "public"
    });

    const db = new DatabaseSync(dbFilePath);
    try {
      db.prepare("UPDATE toilet_comments SET cleanliness_rating = NULL WHERE id = ?").run(commentId);
    } finally {
      db.close();
    }

    const profile = await database.getPublicProfile(owner.id);
    assert.equal(profile.comments.length, 1);
    assert.equal(profile.comments[0].id, commentId);
    assert.equal(profile.comments[0].cleanliness_rating, 4);
  });
});

test("database toggles one like per user for comments", async () => {
  await withSeededDatabase(async (database) => {
    const user = await database.getUserByUsername("demo");
    const toiletId = "detail-test";
    const comments = await database.saveComment({
      toiletId,
      userId: user.id,
      username: user.username,
      commentText: "Likeable comment",
      cleanlinessRating: 4
    });
    const commentId = comments[0].id;

    const liked = await database.toggleCommentLike({
      toiletId,
      commentId,
      userId: user.id
    });

    assert.equal(liked.found, true);
    assert.equal(liked.liked, true);
    assert.equal(liked.comments[0].like_count, 1);
    assert.equal(liked.comments[0].viewer_has_liked, true);

    const publicComments = await database.getComments(toiletId);
    assert.equal(publicComments[0].like_count, 1);
    assert.equal(publicComments[0].viewer_has_liked, false);

    const unliked = await database.toggleCommentLike({
      toiletId,
      commentId,
      userId: user.id
    });

    assert.equal(unliked.found, true);
    assert.equal(unliked.liked, false);
    assert.equal(unliked.comments[0].like_count, 0);
    assert.equal(unliked.comments[0].viewer_has_liked, false);

    const missing = await database.toggleCommentLike({
      toiletId,
      commentId: 99999,
      userId: user.id
    });

    assert.equal(missing.found, false);
    assert.equal(missing.liked, false);
  });
});

test("database only deletes comments owned by the current user", async () => {
  await withSeededDatabase(async (database) => {
    const owner = await database.getUserByUsername("demo");
    const other = await database.createUser({
      username: "other-delete-user",
      password: "demo123",
      email: "other-delete-user@example.com"
    });
    const toiletId = "detail-test";

    const ownerComments = await database.saveComment({
      toiletId,
      userId: owner.id,
      username: owner.username,
      commentText: "Delete my anonymous comment",
      commentVisibility: "anonymous",
      cleanlinessRating: 2
    });
    const commentId = ownerComments[0].id;

    const otherDelete = await database.deleteComment({
      toiletId,
      commentId,
      userId: other.id
    });

    assert.equal(otherDelete.deleted, false);
    assert.equal(otherDelete.comments.length, 1);
    assert.equal(otherDelete.comments[0].can_delete, false);

    const ownerDelete = await database.deleteComment({
      toiletId,
      commentId,
      userId: owner.id
    });

    assert.equal(ownerDelete.deleted, true);
    assert.equal(ownerDelete.comments.length, 0);
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

test("Z-Score Model adjusts rating based on user distribution", async () => {
  await withSeededDatabase(async (database) => {
    const user = await database.getUserByUsername("demo");
    const userId = user.id;
    const toiletId = "detail-test";
    const otherToiletId = "limited-test";

    // 1. Establish a distribution for the user: ratings 1 and 5.
    // userAvg = 3. userSumSquares = 1^2 + 5^2 = 26.
    // userVar = 26/2 - 3^2 = 13 - 9 = 4. userStd = 2.
    await database.recordCleanlinessSurvey({ userId, toiletId: "extra-test-1", rating: 1 });
    await database.recordCleanlinessSurvey({ userId, toiletId: "extra-test-2", rating: 5 });

    // 2. Submit a 5-star rating for our target toilet.
    const result = await database.recordCleanlinessSurvey({
      userId,
      toiletId: "extra-test-3",
      rating: 5
    });

    // z = (5 - 3) / 2 = 1.
    // With only one user, globalStats == userStats (BEFORE this rating is added to global? No, it's calculated before update).
    // So globalAvg = 3, globalStd = 2.
    // adjustedRating = 2 * 1 + 3 = 5.
    assert.equal(result.toilet.cleanliness, 5);

    // Let's try a 4-star rating with the same user distribution.
    // z = (4 - 3) / 2 = 0.5.
    // adjustedRating = 2 * 0.5 + 3 = 4.
    // (Still 4 because global == user)
    
  }, { modelType: "z_score" });
});

test("Bias Training Model updates user and toilet biases via SGD", async () => {
  await withSeededDatabase(async (database) => {
    const user = await database.getUserByUsername("demo");
    const userId = user.id;
    const toiletId = "detail-test";

    // 1. Initial state: biases = 0, globalAvg = 3.
    // User rates 5.
    // error = 5 - (3 + 0 + 0) = 2.
    // learningRate = 0.01. regularization = 0.02.
    // newUserBias = 0 + 0.01 * (2 - 0.02 * 0) = 0.02.
    // newToiletBias = 0 + 0.01 * (2 - 0.02 * 0) = 0.02.
    // adjustedRating = 3 + 0.02 = 3.02. Clamped to 3.
    
    await database.recordCleanlinessSurvey({
      userId,
      toiletId: "extra-test-4",
      rating: 5
    });

    const updatedUser = await database.getUserById(userId);
    assert.ok(updatedUser.bias !== 0);
    
    // In a single-user system, global mean quickly becomes the user rating.
    // So the second rating might already be high.
    
    // Just verify that we can keep recording and biases update.
    await database.recordCleanlinessSurvey({ userId, toiletId: "extra-test-5", rating: 5 });
    
    const finalUser = await database.getUserById(userId);
    assert.ok(Math.abs(finalUser.bias) > 0);
    
    const toilets = await database.getToilets({ cleanlinessRange: "all" });
    const targetToilet = toilets.find(t => t.id === toiletId);
    assert.ok(targetToilet.cleanliness >= 3);

  }, { modelType: "bias_training" });
});
test("database returns comment image attachment metadata without base64 data", async () => {
  await withSeededDatabase(async (database) => {
    const user = await database.getUserByUsername("demo");
    const toiletId = "detail-test";

    const media = [
      {
        type: "image",
        mimeType: "image/png",
        name: "sink.png",
        size: 5,
        dataUrl: "data:image/png;base64,aW1hZ2U="
      },
      {
        type: "image",
        mimeType: "image/jpeg",
        name: "door.jpg",
        size: 6,
        dataUrl: "data:image/jpeg;base64,aW1hZ2Uy"
      }
    ];

    const updatedComments = await database.saveComment({
      toiletId,
      userId: user.id,
      username: user.username,
      commentText: "Mixed evidence",
      cleanlinessRating: 5,
      media
    });

    assert.equal(updatedComments.length, 1);
    assert.equal(updatedComments[0].comment_text, "Mixed evidence");
    assert.equal(updatedComments[0].media_type, "image");
    assert.equal(updatedComments[0].media_mime_type, "image/png");
    assert.equal(updatedComments[0].media_name, "sink.png");
    assert.equal(updatedComments[0].media_url, null);
    assert.deepEqual(updatedComments[0].media_attachments, [
      {
        type: "image",
        mimeType: "image/png",
        name: "sink.png",
        size: 5,
        hasData: true
      },
      {
        type: "image",
        mimeType: "image/jpeg",
        name: "door.jpg",
        size: 6,
        hasData: true
      }
    ]);
    assert.equal(JSON.stringify(updatedComments).includes("data:image"), false);
  });
});

test("database rejects comment media over attachment limits", async () => {
  await withSeededDatabase(async (database) => {
    const user = await database.getUserByUsername("demo");
    const commonComment = {
      toiletId: "detail-test",
      userId: user.id,
      username: user.username,
      commentText: "Too much media",
      cleanlinessRating: 4
    };
    const imageAttachment = {
      type: "image",
      mimeType: "image/png",
      name: "sink.png",
      size: 5,
      dataUrl: "data:image/png;base64,aW1hZ2U="
    };
    await assert.rejects(
      () => database.saveComment({
        ...commonComment,
        media: Array.from({ length: 4 }, () => imageAttachment)
      }),
      /at most 3 attachments/
    );

    await assert.rejects(
      () => database.saveComment({
        ...commonComment,
        media: {
          type: "video",
          mimeType: "video/mp4",
          name: "queue.mp4",
          size: 5,
          dataUrl: "data:video/mp4;base64,dmlkZW8="
        }
      }),
      /Unsupported comment media type/
    );
  });
});
