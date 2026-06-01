import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { mapRowToToilet } from "../mapper/toilet-mapper.mjs";
import { applySqliteToiletMigrations } from "../migration/toilet-schema-migration.mjs";
import { loadSeedToilets } from "../seed/toilet-seed-loader.mjs";
import {
  mapAccessHistoryRow,
  mapAccountRow,
  mapCleanlinessSurveyResponse,
  normaliseAccessPayload,
  normaliseCleanlinessSurveyPayload,
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
      cleanliness_no_count INTEGER NOT NULL DEFAULT 0
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
      comment_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_access_history_access_time
    ON access_history(access_time DESC);

    CREATE INDEX IF NOT EXISTS idx_toilet_comments_toilet_id
    ON toilet_comments(toilet_id);
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

    insertHistory.run(demoUserId, null, "South Kensington Station", "QR access", 0.5, twoHoursAgo);
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
            cleanliness_no_count
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
    async recordCleanlinessSurvey({ toiletId = null, toiletName = "", answer }) {
      const { safeToiletId, safeToiletName, safeAnswer } = normaliseCleanlinessSurveyPayload({
        toiletId,
        toiletName,
        answer
      });

      const row = safeToiletId
        ? db
            .prepare("SELECT id, name, cleanliness, cleanliness_yes_count, cleanliness_no_count FROM toilets WHERE id = ?")
            .get(safeToiletId)
        : db
            .prepare(
              `
              SELECT id, name, cleanliness, cleanliness_yes_count, cleanliness_no_count
              FROM toilets
              WHERE LOWER(name) = LOWER(?)
              LIMIT 1
              `
            )
            .get(safeToiletName);

      if (!row) {
        throw new Error("toilet not found.");
      }

      const { cleanliness, yesCount, noCount } = toCleanlinessUpdate({
        row,
        answer: safeAnswer,
        cleanlinessScoringModel
      });

      db.prepare(
        `
        UPDATE toilets
        SET cleanliness = ?, cleanliness_yes_count = ?, cleanliness_no_count = ?
        WHERE id = ?
        `
      ).run(cleanliness, yesCount, noCount, row.id);

      return mapCleanlinessSurveyResponse({
        row,
        cleanliness,
        yesCount,
        noCount,
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
    async getComments(toiletId) {
      if (!toiletId) return [];

      return db
        .prepare(
          `
          SELECT id, toilet_id, user_id, username, comment_text, created_at
          FROM toilet_comments
          WHERE toilet_id = ?
          ORDER BY created_at DESC
          `
        )
        .all(toiletId);
    },
    async saveComment({ toiletId, userId, username, commentText }) {
      if (!toiletId || !commentText) {
        throw new Error("toiletId and commentText are required");
      }

      const nowIso = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO toilet_comments (toilet_id, user_id, username, comment_text, created_at)
        VALUES (?, ?, ?, ?, ?)
        `
      ).run(toiletId, userId, username, commentText, nowIso);

      return this.getComments(toiletId);
    }
  };
}
