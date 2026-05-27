import { mapRowToToilet } from "../mapper/toilet-mapper.mjs";
import { applyPostgresToiletMigrations } from "../migration/toilet-schema-migration.mjs";
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

export async function createPostgresDatabase({ connectionString, seedCsvPath, cleanlinessScoringModel }) {
  let Pool;
  try {
    ({ Pool } = await import("pg"));
  } catch {
    throw new Error(
      "PostgreSQL mode requires the 'pg' package. Run 'npm install' and try again."
    );
  }

  const pool = new Pool({ connectionString });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS toilets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      area TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      paid BOOLEAN NOT NULL DEFAULT FALSE,
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
      opening_times JSONB NOT NULL DEFAULT '[]'::jsonb,
      cleanliness INTEGER NOT NULL DEFAULT 3,
      cleanliness_yes_count INTEGER NOT NULL DEFAULT 0,
      cleanliness_no_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  await applyPostgresToiletMigrations({ pool, seedCsvPath });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      wallet_balance_gbp DOUBLE PRECISION NOT NULL,
      subscription_name TEXT NOT NULL,
      subscription_renews_on TEXT NOT NULL,
      monthly_free_tickets_left INTEGER NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_history (
      id BIGSERIAL PRIMARY KEY,
      toilet_id TEXT REFERENCES toilets(id) ON DELETE SET NULL,
      toilet_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount_gbp DOUBLE PRECISION NOT NULL,
      access_time TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_access_history_access_time
    ON access_history(access_time DESC);
  `);

  const toiletCount = Number((await pool.query("SELECT COUNT(*)::int AS count FROM toilets")).rows[0]?.count ?? 0);

  if (toiletCount === 0) {
    const toiletsToSeed = await loadSeedToilets(seedCsvPath);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      for (const toilet of toiletsToSeed) {
        await client.query(
          `
          INSERT INTO toilets (
            id, name, area, lat, lng, paid, comment,
            women, men, accessible, neutral, children, baby_changing, bidet,
            automatic, urinal_only, radar_key, free_access, opening_times, cleanliness
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
          `,
          [
            toilet.id,
            toilet.name,
            toilet.area,
            toilet.lat,
            toilet.lng,
            Boolean(toilet.paid),
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
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const accountCount = Number((await pool.query("SELECT COUNT(*)::int AS count FROM app_account")).rows[0]?.count ?? 0);

  if (accountCount === 0) {
    await pool.query(
      `
      INSERT INTO app_account (
        id,
        wallet_balance_gbp,
        subscription_name,
        subscription_renews_on,
        monthly_free_tickets_left
      ) VALUES (1, $1, $2, $3, $4)
      `,
      [8.4, "Campus Plus", "2026-06-26", 3]
    );
  }

  const historyCount = Number((await pool.query("SELECT COUNT(*)::int AS count FROM access_history")).rows[0]?.count ?? 0);

  if (historyCount === 0) {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    await pool.query(
      `
      INSERT INTO access_history (toilet_id, toilet_name, event_type, amount_gbp, access_time)
      VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)
      `,
      [
        null,
        "South Kensington Station",
        "QR access",
        0.5,
        twoHoursAgo,
        null,
        "Imperial Library",
        "Free access",
        0,
        oneDayAgo
      ]
    );
  }

  return {
    backend: "postgres",
    async getToilets({ search = "", accessibleOnly = false } = {}) {
      const query = normaliseSearchQuery(search);
      const params = [];
      const conditions = [];

      if (accessibleOnly) {
        params.push("Y");
        conditions.push(`accessible = $${params.length}`);
      }

      if (query) {
        params.push(`%${query}%`);
        conditions.push(`(LOWER(name) LIKE $${params.length} OR LOWER(area) LIKE $${params.length})`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const result = await pool.query(
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
        ${whereClause}
        `,
        params
      );

      return result.rows.map(mapRowToToilet);
    },
    async recordCleanlinessSurvey({ toiletId = null, toiletName = "", answer }) {
      const { safeToiletId, safeToiletName, safeAnswer } = normaliseCleanlinessSurveyPayload({
        toiletId,
        toiletName,
        answer
      });

      const result = safeToiletId
        ? await pool.query(
            "SELECT id, name, cleanliness, cleanliness_yes_count, cleanliness_no_count FROM toilets WHERE id = $1",
            [safeToiletId]
          )
        : await pool.query(
            `
            SELECT id, name, cleanliness, cleanliness_yes_count, cleanliness_no_count
            FROM toilets
            WHERE LOWER(name) = LOWER($1)
            LIMIT 1
            `,
            [safeToiletName]
          );

      const row = result.rows[0];
      if (!row) {
        throw new Error("toilet not found.");
      }

      const { cleanliness, yesCount, noCount } = toCleanlinessUpdate({
        row,
        answer: safeAnswer,
        cleanlinessScoringModel
      });

      await pool.query(
        `
        UPDATE toilets
        SET cleanliness = $1, cleanliness_yes_count = $2, cleanliness_no_count = $3
        WHERE id = $4
        `,
        [cleanliness, yesCount, noCount, row.id]
      );

      return mapCleanlinessSurveyResponse({
        row,
        cleanliness,
        yesCount,
        noCount,
        cleanlinessScoringModel
      });
    },
    async getAccount() {
      const result = await pool.query(
        `
        SELECT
          wallet_balance_gbp,
          subscription_name,
          subscription_renews_on,
          monthly_free_tickets_left
        FROM app_account
        WHERE id = 1
        `
      );

      return mapAccountRow(result.rows[0]);
    },
    async getAccessHistory(limit = 10) {
      const safeLimit = normaliseHistoryLimit(limit);
      const result = await pool.query(
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
        LIMIT $1
        `,
        [safeLimit]
      );

      return result.rows.map(mapAccessHistoryRow);
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

      const nowIso = new Date().toISOString();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          `
          INSERT INTO access_history (toilet_id, toilet_name, event_type, amount_gbp, access_time)
          VALUES ($1, $2, $3, $4, $5)
          `,
          [toiletId, safeToiletName, safeEventType, safeAmount, nowIso]
        );

        await client.query(
          `
          UPDATE app_account
          SET
            wallet_balance_gbp = GREATEST(wallet_balance_gbp - $1, 0),
            monthly_free_tickets_left =
              CASE
                WHEN $2 = TRUE THEN GREATEST(monthly_free_tickets_left - 1, 0)
                ELSE monthly_free_tickets_left
              END
          WHERE id = 1
          `,
          [safeAmount, shouldUseFreeTicket]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return {
        account: await this.getAccount(),
        history: await this.getAccessHistory(10)
      };
    }
  };
}
