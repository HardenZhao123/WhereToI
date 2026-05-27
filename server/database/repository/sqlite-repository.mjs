import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

    CREATE TABLE IF NOT EXISTS app_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      wallet_balance_gbp REAL NOT NULL,
      subscription_name TEXT NOT NULL,
      subscription_renews_on TEXT NOT NULL,
      monthly_free_tickets_left INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS access_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      toilet_id TEXT,
      toilet_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount_gbp REAL NOT NULL,
      access_time TEXT NOT NULL,
      FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE SET NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_access_history_access_time
    ON access_history(access_time DESC);
  `);

  await applySqliteToiletMigrations({ db, seedCsvPath });

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

  const accountCount = Number(db.prepare("SELECT COUNT(*) AS count FROM app_account").get()?.count ?? 0);

  if (accountCount === 0) {
    db.prepare(
      `
      INSERT INTO app_account (
        id,
        wallet_balance_gbp,
        subscription_name,
        subscription_renews_on,
        monthly_free_tickets_left
      ) VALUES (1, ?, ?, ?, ?)
      `
    ).run(8.4, "Campus Plus", "2026-06-26", 3);
  }

  const historyCount = Number(db.prepare("SELECT COUNT(*) AS count FROM access_history").get()?.count ?? 0);

  if (historyCount === 0) {
    const insertHistory = db.prepare(`
      INSERT INTO access_history (toilet_id, toilet_name, event_type, amount_gbp, access_time)
      VALUES (?, ?, ?, ?, ?)
    `);

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    insertHistory.run(null, "South Kensington Station", "QR access", 0.5, twoHoursAgo);
    insertHistory.run(null, "Imperial Library", "Free access", 0, oneDayAgo);
  }

  return {
    backend: "sqlite",
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
    async getAccount() {
      const row = db
        .prepare(
          `
          SELECT
            wallet_balance_gbp,
            subscription_name,
            subscription_renews_on,
            monthly_free_tickets_left
          FROM app_account
          WHERE id = 1
          `
        )
        .get();

      return mapAccountRow(row);
    },
    async getAccessHistory(limit = 10) {
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
          ORDER BY access_time DESC
          LIMIT ?
          `
        )
        .all(safeLimit);

      return rows.map(mapAccessHistoryRow);
    },
    async recordAccess({ toiletId = null, toiletName, eventType, amountGbp = 0, useFreeTicket = false }) {
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
        INSERT INTO access_history (toilet_id, toilet_name, event_type, amount_gbp, access_time)
        VALUES (?, ?, ?, ?, ?)
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
        WHERE id = 1
        `
      );

      const nowIso = new Date().toISOString();

      db.exec("BEGIN;");
      try {
        insert.run(toiletId, safeToiletName, safeEventType, safeAmount, nowIso);
        updateAccount.run(safeAmount, shouldUseFreeTicket ? 1 : 0);
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }

      return {
        account: await this.getAccount(),
        history: await this.getAccessHistory(10)
      };
    }
  };
}
