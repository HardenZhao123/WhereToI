import { mapRowToToilet } from "../mapper/toilet-mapper.mjs";
import { applyPostgresToiletMigrations } from "../migration/toilet-schema-migration.mjs";
import { loadSeedToilets } from "../seed/toilet-seed-loader.mjs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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

function mapUserRow(row, { includePasswordHash = false } = {}) {
  if (!row) return null;

  const user = {
    id: row.id,
    username: row.username,
    email: row.email,
    gender: row.gender ?? null,
    preferences:
      typeof row.preferences === "string"
        ? row.preferences
        : JSON.stringify(row.preferences ?? [])
  };

  if (includePasswordHash) {
    user.password_hash = row.password_hash;
  }

  return user;
}

async function ensureDemoUser(pool) {
  const existingDemo = await pool.query(
    "SELECT id FROM users WHERE username = $1",
    ["demo"]
  );

  if (existingDemo.rows[0]?.id) {
    return existingDemo.rows[0].id;
  }

  const insertedDemo = await pool.query(
    `
    INSERT INTO users (username, password_hash, email, preferences)
    VALUES ($1, $2, $3, $4::jsonb)
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
    RETURNING id
    `,
    ["demo", hashPassword("demo123"), "demo@example.com", JSON.stringify([])]
  );

  return insertedDemo.rows[0].id;
}

async function ensurePostgresUserSupport(pool) {
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB");

  await pool.query(`
    DO $$
    DECLARE
      constraint_name TEXT;
    BEGIN
      FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'app_account'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%id = 1%'
      LOOP
        EXECUTE format('ALTER TABLE app_account DROP CONSTRAINT %I', constraint_name);
      END LOOP;
    END $$;
  `);
  await pool.query("CREATE SEQUENCE IF NOT EXISTS app_account_id_seq");
  await pool.query(`
    SELECT setval(
      'app_account_id_seq',
      GREATEST(COALESCE((SELECT MAX(id) FROM app_account), 0) + 1, 1),
      false
    )
  `);
  await pool.query("ALTER TABLE app_account ALTER COLUMN id SET DEFAULT nextval('app_account_id_seq')");
  await pool.query("ALTER SEQUENCE app_account_id_seq OWNED BY app_account.id");

  await pool.query("ALTER TABLE app_account ADD COLUMN IF NOT EXISTS user_id INTEGER");
  await pool.query("ALTER TABLE access_history ADD COLUMN IF NOT EXISTS user_id INTEGER");
  await pool.query("ALTER TABLE toilet_comments ADD COLUMN IF NOT EXISTS user_id INTEGER");
  await pool.query("ALTER TABLE toilet_comments ADD COLUMN IF NOT EXISTS username TEXT");

  const demoUserId = await ensureDemoUser(pool);

  await pool.query("UPDATE app_account SET user_id = $1 WHERE user_id IS NULL", [demoUserId]);
  await pool.query("UPDATE access_history SET user_id = $1 WHERE user_id IS NULL", [demoUserId]);
  await pool.query("UPDATE toilet_comments SET username = $1 WHERE username IS NULL", ["Anonymous"]);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_app_account_user_id ON app_account(user_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_access_history_user_id ON access_history(user_id)");

  return demoUserId;
}

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

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      gender TEXT,
      preferences JSONB
    );
  `);

  await applyPostgresToiletMigrations({ pool, seedCsvPath });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_account (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wallet_balance_gbp DOUBLE PRECISION NOT NULL,
      subscription_name TEXT NOT NULL,
      subscription_renews_on TEXT NOT NULL,
      monthly_free_tickets_left INTEGER NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_history (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      toilet_id TEXT REFERENCES toilets(id) ON DELETE SET NULL,
      toilet_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount_gbp DOUBLE PRECISION NOT NULL,
      access_time TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS toilet_comments (
      id SERIAL PRIMARY KEY,
      toilet_id TEXT NOT NULL REFERENCES toilets(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      comment_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const demoUserId = await ensurePostgresUserSupport(pool);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_access_history_access_time
    ON access_history(access_time DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_toilet_comments_toilet_id
    ON toilet_comments(toilet_id);
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
        user_id,
        wallet_balance_gbp,
        subscription_name,
        subscription_renews_on,
        monthly_free_tickets_left
      ) VALUES (1, $1, $2, $3, $4, $5)
      `,
      [demoUserId, 8.4, "Campus Plus", "2026-06-26", 3]
    );
  }

  const historyCount = Number((await pool.query("SELECT COUNT(*)::int AS count FROM access_history")).rows[0]?.count ?? 0);

  if (historyCount === 0) {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    await pool.query(
      `
      INSERT INTO access_history (user_id, toilet_id, toilet_name, event_type, amount_gbp, access_time)
      VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)
      `,
      [
        demoUserId,
        null,
        "South Kensington Station",
        "QR access",
        0.5,
        twoHoursAgo,
        demoUserId,
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
    async close() {
      await pool.end();
    },
    async createUser({ username, password, email }) {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const userResult = await client.query(
          `
          INSERT INTO users (username, password_hash, email, preferences)
          VALUES ($1, $2, $3, $4::jsonb)
          RETURNING id, username, email, gender, preferences
          `,
          [username, hashPassword(password), email, JSON.stringify([])]
        );
        const user = mapUserRow(userResult.rows[0]);

        await client.query(
          `
          INSERT INTO app_account (
            user_id,
            wallet_balance_gbp,
            subscription_name,
            subscription_renews_on,
            monthly_free_tickets_left
          ) VALUES ($1, $2, $3, $4, $5)
          `,
          [
            user.id,
            5.0,
            "Standard",
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            0
          ]
        );

        await client.query("COMMIT");
        return user;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async getUserByUsername(username) {
      const result = await pool.query(
        `
        SELECT id, username, password_hash, email, gender, preferences
        FROM users
        WHERE username = $1
        `,
        [username]
      );

      return mapUserRow(result.rows[0], { includePasswordHash: true });
    },
    async getUserById(userId) {
      const result = await pool.query(
        `
        SELECT id, username, email, gender, preferences
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      return mapUserRow(result.rows[0]);
    },
    async updateUserProfile(userId, { gender, preferences }) {
      const result = await pool.query(
        `
        UPDATE users
        SET gender = $1, preferences = $2::jsonb
        WHERE id = $3
        RETURNING id, username, email, gender, preferences
        `,
        [gender, JSON.stringify(preferences ?? []), userId]
      );

      return mapUserRow(result.rows[0]);
    },
    async verifyUserPassword(username, password) {
      const user = await this.getUserByUsername(username);
      if (!user) return null;

      if (verifyPassword(password, user.password_hash)) {
        const { password_hash, ...safeUser } = user;
        return safeUser;
      }

      return null;
    },
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
    async getAccount(userId) {
      const result = await pool.query(
        `
        SELECT
          wallet_balance_gbp,
          subscription_name,
          subscription_renews_on,
          monthly_free_tickets_left
        FROM app_account
        WHERE user_id = $1
        `,
        [userId]
      );

      return mapAccountRow(result.rows[0]);
    },
    async getAccessHistory(userId, limit = 10) {
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
        WHERE user_id = $1
        ORDER BY access_time DESC
        LIMIT $2
        `,
        [userId, safeLimit]
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
          INSERT INTO access_history (user_id, toilet_id, toilet_name, event_type, amount_gbp, access_time)
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [userId, toiletId, safeToiletName, safeEventType, safeAmount, nowIso]
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
          WHERE user_id = $3
          `,
          [safeAmount, shouldUseFreeTicket, userId]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return {
        account: await this.getAccount(userId),
        history: await this.getAccessHistory(userId, 10)
      };
    },
    async getComments(toiletId) {
      if (!toiletId) return [];

      const result = await pool.query(
        `
        SELECT id, toilet_id, user_id, username, comment_text, created_at
        FROM toilet_comments
        WHERE toilet_id = $1
        ORDER BY created_at DESC
        `,
        [toiletId]
      );

      return result.rows;
    },
    async saveComment({ toiletId, userId, username, commentText }) {
      if (!toiletId || !commentText) {
        throw new Error("toiletId and commentText are required");
      }

      const nowIso = new Date().toISOString();
      await pool.query(
        `
        INSERT INTO toilet_comments (toilet_id, user_id, username, comment_text, created_at)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [toiletId, userId, username, commentText, nowIso]
      );

      return this.getComments(toiletId);
    }
  };
}
