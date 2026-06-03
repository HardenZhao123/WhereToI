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
    assert.equal(updatedComments[0].author_name, user.username);
    assert.equal(updatedComments[0].comment_visibility, "real");
    assert.equal(updatedComments[0].is_anonymous, false);
    assert.equal(updatedComments[0].user_id, userId);
    assert.equal(updatedComments[0].media_type, null);
    assert.deepEqual(updatedComments[0].media_attachments, []);

    const anonymousComments = await database.saveComment({
      toiletId,
      userId,
      username: user.username,
      commentText: "Anonymous test comment",
      commentVisibility: "anonymous"
    });

    assert.equal(anonymousComments.length, 2);
    assert.equal(anonymousComments[0].comment_text, "Anonymous test comment");
    assert.equal(anonymousComments[0].username, "Anonymous");
    assert.equal(anonymousComments[0].author_name, "Anonymous");
    assert.equal(anonymousComments[0].comment_visibility, "anonymous");
    assert.equal(anonymousComments[0].is_anonymous, true);
    assert.equal(anonymousComments[0].user_id, null);

    const fetchedComments = await database.getComments(toiletId);
    assert.deepEqual(fetchedComments, anonymousComments);
  });
});

test("database saves multiple image and video attachments with comments", async () => {
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
        type: "video",
        mimeType: "video/mp4",
        name: "queue.mp4",
        size: 5,
        dataUrl: "data:video/mp4;base64,dmlkZW8="
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
      media
    });

    assert.equal(updatedComments.length, 1);
    assert.equal(updatedComments[0].comment_text, "Mixed evidence");
    assert.equal(updatedComments[0].media_type, "image");
    assert.equal(updatedComments[0].media_mime_type, "image/png");
    assert.equal(updatedComments[0].media_name, "sink.png");
    assert.equal(updatedComments[0].media_url, "data:image/png;base64,aW1hZ2U=");
    assert.deepEqual(updatedComments[0].media_attachments, media);
  });
});

test("database rejects comment media over attachment limits", async () => {
  await withSeededDatabase(async (database) => {
    const user = await database.getUserByUsername("demo");
    const commonComment = {
      toiletId: "detail-test",
      userId: user.id,
      username: user.username,
      commentText: "Too much media"
    };
    const imageAttachment = {
      type: "image",
      mimeType: "image/png",
      name: "sink.png",
      size: 5,
      dataUrl: "data:image/png;base64,aW1hZ2U="
    };
    const videoAttachment = {
      type: "video",
      mimeType: "video/mp4",
      name: "queue.mp4",
      size: 5,
      dataUrl: "data:video/mp4;base64,dmlkZW8="
    };

    await assert.rejects(
      () => database.saveComment({
        ...commonComment,
        media: Array.from({ length: 10 }, () => imageAttachment)
      }),
      /at most 9 attachments/
    );

    await assert.rejects(
      () => database.saveComment({
        ...commonComment,
        media: Array.from({ length: 4 }, () => videoAttachment)
      }),
      /at most 3 videos/
    );
  });
});
