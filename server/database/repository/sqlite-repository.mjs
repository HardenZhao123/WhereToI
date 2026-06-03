import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { mapRowToToilet } from "../mapper/toilet-mapper.mjs";
import { applySqliteToiletMigrations } from "../migration/toilet-schema-migration.mjs";
import { loadSeedToilets } from "../seed/toilet-seed-loader.mjs";
import {
  ANONYMOUS_COMMENT_AUTHOR,
  mapAccessHistoryRow,
  mapAccountRow,
  mapCleanlinessSurveyResponse,
  mapCommentRow,
  normaliseAccessPayload,
  normaliseCleanlinessSurveyPayload,
  normaliseCommentDeletePayload,
  normaliseCommentLikePayload,
  normaliseCommentPayload,
  normaliseHistoryLimit,
  normaliseSearchQuery,
  toCleanlinessUpdate
} from "./repository-utils.mjs";

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

function verifyPassword(password, hash) {
  const [salt, key] = hash.split(":");
  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = scryptSync(password, salt, 64);
  return timingSafeEqual(keyBuffer, derivedKey);
}

export async function createSqliteDatabase({ dbFilePath, seedCsvPath, cleanlinessScoringModel }) {
  await mkdir(dirname(dbFilePath), { recursive: true });
  const db = new DatabaseSync(dbFilePath);

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS toilets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      area TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      paid INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL,
      women TEXT NOT NULL DEFAULT '?',
      men TEXT NOT NULL DEFAULT '?',
      accessible TEXT NOT NULL DEFAULT '?',
      neutral TEXT NOT NULL DEFAULT '?',
      children TEXT NOT NULL DEFAULT '?',
      baby_changing TEXT NOT NULL DEFAULT '?',
      bidet TEXT NOT NULL DEFAULT '?',
      automatic TEXT NOT NULL DEFAULT '?',
      urinal_only TEXT NOT NULL DEFAULT '?',
      radar_key TEXT NOT NULL DEFAULT '?',
      free_access TEXT NOT NULL DEFAULT '?',
      opening_times TEXT NOT NULL DEFAULT '[]',
      cleanliness INTEGER NOT NULL DEFAULT 3,
      cleanliness_yes_count INTEGER NOT NULL DEFAULT 0,
      cleanliness_no_count INTEGER NOT NULL DEFAULT 0,
      cleanliness_rating_total INTEGER NOT NULL DEFAULT 0,
      cleanliness_rating_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      gender TEXT,
      preferences TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS app_account (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      wallet_balance_gbp REAL NOT NULL,
      subscription_name TEXT NOT NULL,
      subscription_renews_on TEXT NOT NULL,
      monthly_free_tickets_left INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS access_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      toilet_id TEXT,
      toilet_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount_gbp REAL NOT NULL,
      access_time TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE SET NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS toilet_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      toilet_id TEXT NOT NULL,
      user_id INTEGER,
      username TEXT,
      comment_visibility TEXT NOT NULL DEFAULT 'real',
      comment_text TEXT NOT NULL,
      media_type TEXT,
      media_mime_type TEXT,
      media_name TEXT,
      media_size INTEGER,
      media_url TEXT,
      media_attachments TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS comment_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (comment_id, user_id),
      FOREIGN KEY (comment_id) REFERENCES toilet_comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_access_history_access_time
    ON access_history(access_time DESC);

    CREATE INDEX IF NOT EXISTS idx_toilet_comments_toilet_id
    ON toilet_comments(toilet_id);

    CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id
    ON comment_likes(comment_id);
  `);

  await applySqliteToiletMigrations({ db, seedCsvPath });

  // Now that migrations have run and user_id columns are guaranteed to exist, we can create user indices
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_app_account_user_id
    ON app_account(user_id);
  `);

  const toiletCount = Number(db.prepare("SELECT COUNT(*) AS count FROM toilets").get()?.count ?? 0);

  if (toiletCount === 0) {
    const toiletsToSeed = await loadSeedToilets(seedCsvPath);
    const insertToilet = db.prepare(`
      INSERT INTO toilets (
        id, name, area, lat, lng, paid, comment,
        women, men, accessible, neutral, children, baby_changing, bidet,
        automatic, urinal_only, radar_key, free_access, opening_times, cleanliness
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec("BEGIN;");
    try {
      for (const toilet of toiletsToSeed) {
        insertToilet.run(
          toilet.id,
          toilet.name,
          toilet.area,
          toilet.lat,
          toilet.lng,
          toilet.paid ? 1 : 0,
          toilet.comment,
          toilet.features.women,
          toilet.features.men,
          toilet.features.accessible,
          toilet.features.neutral,
          toilet.features.children,
          toilet.features.babyChanging,
          toilet.features.bidet,
          toilet.features.automatic,
          toilet.features.urinalOnly,
          toilet.features.radarKey,
          toilet.features.free,
          JSON.stringify(toilet.openingTimes ?? []),
          toilet.cleanliness
        );
      }
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }

  const userCount = Number(db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count ?? 0);
  let demoUserId = null;

  if (userCount === 0) {
    const insertUser = db.prepare(
      "INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)"
    );
    insertUser.run("demo", hashPassword("demo123"), "demo@example.com");
    demoUserId = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);

    db.prepare(
      `
      INSERT INTO app_account (
        user_id,
        wallet_balance_gbp,
        subscription_name,
        subscription_renews_on,
        monthly_free_tickets_left
      ) VALUES (?, ?, ?, ?, ?)
      `
    ).run(demoUserId, 8.4, "Campus Plus", "2026-06-26", 3);

    const insertHistory = db.prepare(`
      INSERT INTO access_history (user_id, toilet_id, toilet_name, event_type, amount_gbp, access_time)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    insertHistory.run(demoUserId, null, "South Kensington Station", "Paid access", 0.5, twoHoursAgo);
    insertHistory.run(demoUserId, null, "Imperial Library", "Free access", 0, oneDayAgo);
  }

  return {
    backend: "sqlite",
    async close() {
      db.close();
    },
    async createUser({ username, password, email }) {
      const passwordHash = hashPassword(password);
      db.exec("BEGIN;");
      try {
        db.prepare(
          "INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)"
        ).run(username, passwordHash, email);
        const userId = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);

        // Every user gets a default account
        db.prepare(
          `
          INSERT INTO app_account (
            user_id,
            wallet_balance_gbp,
            subscription_name,
            subscription_renews_on,
            monthly_free_tickets_left
          ) VALUES (?, ?, ?, ?, ?)
          `
        ).run(userId, 5.0, "Standard", new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), 0);

        db.exec("COMMIT;");
        return { id: userId, username, email };
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    },
    async getUserByUsername(username) {
      return db.prepare("SELECT id, username, password_hash, email, gender, preferences FROM users WHERE username = ?").get(username);
    },
    async getUserById(userId) {
      return db.prepare("SELECT id, username, email, gender, preferences FROM users WHERE id = ?").get(userId);
    },
    async updateUserProfile(userId, { gender, preferences }) {
      db.prepare(
        "UPDATE users SET gender = ?, preferences = ? WHERE id = ?"
      ).run(gender, JSON.stringify(preferences), userId);
      return this.getUserById(userId);
    },
    async verifyUserPassword(username, password) {
      const user = await this.getUserByUsername(username);
      if (!user) return null;
      if (verifyPassword(password, user.password_hash)) {
        const { password_hash, ...rest } = user;
        return rest;
      }
      return null;
    },
    async getToilets({ search = "", accessibleOnly = false } = {}) {
      const rows = db
        .prepare(
          `
          SELECT
            id,
            name,
            area,
            lat,
            lng,
            paid,
            comment,
            women,
            men,
            accessible,
            neutral,
            children,
            baby_changing,
            bidet,
            automatic,
            urinal_only,
            radar_key,
            free_access,
            opening_times,
            cleanliness,
            cleanliness_yes_count,
            cleanliness_no_count,
            cleanliness_rating_total,
            cleanliness_rating_count
          FROM toilets
          `
        )
        .all();

      const query = normaliseSearchQuery(search);

      return rows.map(mapRowToToilet).filter((toilet) => {
        if (accessibleOnly && toilet.features.accessible !== "Y") return false;
        if (!query) return true;

        return (
          toilet.name.toLowerCase().includes(query) ||
          toilet.area.toLowerCase().includes(query)
        );
      });
    },
    async recordCleanlinessSurvey({ toiletId = null, toiletName = "", rating, answer }) {
      const { safeToiletId, safeToiletName, safeRating } = normaliseCleanlinessSurveyPayload({
        toiletId,
        toiletName,
        rating,
        answer
      });

      const row = safeToiletId
        ? db
            .prepare("SELECT id, name, cleanliness, cleanliness_yes_count, cleanliness_no_count, cleanliness_rating_total, cleanliness_rating_count FROM toilets WHERE id = ?")
            .get(safeToiletId)
        : db
            .prepare(
              `
              SELECT id, name, cleanliness, cleanliness_yes_count, cleanliness_no_count, cleanliness_rating_total, cleanliness_rating_count
              FROM toilets
              WHERE LOWER(name) = LOWER(?)
              LIMIT 1
              `
            )
            .get(safeToiletName);

      if (!row) {
        throw new Error("toilet not found.");
      }

      const { cleanliness, ratingTotal, ratingCount } = toCleanlinessUpdate({
        row,
        rating: safeRating,
        cleanlinessScoringModel
      });

      db.prepare(
        `
        UPDATE toilets
        SET cleanliness = ?, cleanliness_rating_total = ?, cleanliness_rating_count = ?
        WHERE id = ?
        `
      ).run(cleanliness, ratingTotal, ratingCount, row.id);

      return mapCleanlinessSurveyResponse({
        row,
        cleanliness,
        ratingTotal,
        ratingCount,
        cleanlinessScoringModel
      });
    },
    async getAccount(userId) {
      const row = db
        .prepare(
          `
          SELECT
            wallet_balance_gbp,
            subscription_name,
            subscription_renews_on,
            monthly_free_tickets_left
          FROM app_account
          WHERE user_id = ?
          `
        )
        .get(userId);

      return mapAccountRow(row);
    },
    async getAccessHistory(userId, limit = 10) {
      const safeLimit = normaliseHistoryLimit(limit);
      const rows = db
        .prepare(
          `
          SELECT
            id,
            toilet_id,
            toilet_name,
            event_type,
            amount_gbp,
            access_time
          FROM access_history
          WHERE user_id = ?
          ORDER BY access_time DESC
          LIMIT ?
          `
        )
        .all(userId, safeLimit);

      return rows.map(mapAccessHistoryRow);
    },
    async recordAccess({ userId, toiletId = null, toiletName, eventType, amountGbp = 0, useFreeTicket = false }) {
      const { safeToiletName, safeEventType, safeAmount, useFreeTicket: shouldUseFreeTicket } =
        normaliseAccessPayload({
          toiletId,
          toiletName,
          eventType,
          amountGbp,
          useFreeTicket
        });

      const insert = db.prepare(
        `
        INSERT INTO access_history (user_id, toilet_id, toilet_name, event_type, amount_gbp, access_time)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      );

      const updateAccount = db.prepare(
        `
        UPDATE app_account
        SET
          wallet_balance_gbp = MAX(wallet_balance_gbp - ?, 0),
          monthly_free_tickets_left =
            CASE
              WHEN ? = 1 THEN MAX(monthly_free_tickets_left - 1, 0)
              ELSE monthly_free_tickets_left
            END
        WHERE user_id = ?
        `
      );

      const nowIso = new Date().toISOString();

      db.exec("BEGIN;");
      try {
        insert.run(userId, toiletId, safeToiletName, safeEventType, safeAmount, nowIso);
        updateAccount.run(safeAmount, shouldUseFreeTicket ? 1 : 0, userId);
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }

      return {
        account: await this.getAccount(userId),
        history: await this.getAccessHistory(userId, 10)
      };
    },
    async getComments(toiletId, { viewerUserId = null } = {}) {
      if (!toiletId) return [];

      return db
        .prepare(
          `
          SELECT
            id,
            toilet_id,
            user_id,
            username,
            comment_visibility,
            comment_text,
            media_type,
            media_mime_type,
            media_name,
            media_size,
            media_url,
            media_attachments,
            created_at,
            (
              SELECT COUNT(*)
              FROM comment_likes
              WHERE comment_likes.comment_id = toilet_comments.id
            ) AS like_count,
            EXISTS (
              SELECT 1
              FROM comment_likes
              WHERE comment_likes.comment_id = toilet_comments.id
                AND comment_likes.user_id = ?
            ) AS viewer_has_liked
          FROM toilet_comments
          WHERE toilet_id = ?
          ORDER BY created_at DESC, id DESC
          `
        )
        .all(viewerUserId, toiletId)
        .map((row) => mapCommentRow(row, { viewerUserId }));
    },
    async saveComment({ toiletId, userId, username, commentText, media, commentVisibility }) {
      const comment = normaliseCommentPayload({ toiletId, commentText, media, commentVisibility });
      const displayUsername =
        comment.commentVisibility === "anonymous" ? ANONYMOUS_COMMENT_AUTHOR : username;

      const nowIso = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO toilet_comments (
          toilet_id,
          user_id,
          username,
          comment_visibility,
          comment_text,
          media_type,
          media_mime_type,
          media_name,
          media_size,
          media_url,
          media_attachments,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        comment.toiletId,
        userId,
        displayUsername,
        comment.commentVisibility,
        comment.commentText,
        comment.mediaType,
        comment.mediaMimeType,
        comment.mediaName,
        comment.mediaSize,
        comment.mediaUrl,
        comment.mediaAttachmentsJson,
        nowIso
      );

      return this.getComments(comment.toiletId, { viewerUserId: userId });
    },
    async deleteComment({ toiletId, commentId, userId }) {
      const comment = normaliseCommentDeletePayload({ toiletId, commentId });
      const result = db
        .prepare(
          `
          DELETE FROM toilet_comments
          WHERE id = ?
            AND toilet_id = ?
            AND user_id = ?
          `
        )
        .run(comment.commentId, comment.toiletId, userId);

      return {
        deleted: result.changes > 0,
        comments: await this.getComments(comment.toiletId, { viewerUserId: userId })
      };
    },
    async toggleCommentLike({ toiletId, commentId, userId }) {
      const comment = normaliseCommentLikePayload({ toiletId, commentId });
      const existingComment = db
        .prepare("SELECT id FROM toilet_comments WHERE id = ? AND toilet_id = ?")
        .get(comment.commentId, comment.toiletId);

      if (!existingComment) {
        return {
          found: false,
          liked: false,
          comments: await this.getComments(comment.toiletId, { viewerUserId: userId })
        };
      }

      const existingLike = db
        .prepare("SELECT id FROM comment_likes WHERE comment_id = ? AND user_id = ?")
        .get(comment.commentId, userId);

      if (existingLike) {
        db.prepare("DELETE FROM comment_likes WHERE id = ?").run(existingLike.id);
        return {
          found: true,
          liked: false,
          comments: await this.getComments(comment.toiletId, { viewerUserId: userId })
        };
      }

      db.prepare(
        `
        INSERT INTO comment_likes (comment_id, user_id, created_at)
        VALUES (?, ?, ?)
        `
      ).run(comment.commentId, userId, new Date().toISOString());

      return {
        found: true,
        liked: true,
        comments: await this.getComments(comment.toiletId, { viewerUserId: userId })
      };
    }
  };
}
