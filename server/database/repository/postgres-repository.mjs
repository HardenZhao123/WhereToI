import { mapRowToToilet } from "../mapper/toilet-mapper.mjs";
import { applyPostgresToiletMigrations, ensurePostgresCommentMediaColumns } from "../migration/toilet-schema-migration.mjs";
import { loadSeedToilets } from "../seed/toilet-seed-loader.mjs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  ANONYMOUS_COMMENT_AUTHOR,
  mapAccessHistoryRow,
  mapAccountRow,
  mapCleanlinessSurveyResponse,
  mapCommentRow,
  getCleanlinessRangeStartDate,
  normaliseAccessPayload,
  normaliseBounds,
  normaliseCleanlinessSurveyPayload,
  normaliseCommentDeletePayload,
  normaliseCommentLikePayload,
  normaliseCommentPayload,
  normaliseCommentProfileVisibility,
  normaliseHistoryLimit,
  normaliseSearchQuery,
  normaliseUserId,
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
        : JSON.stringify(row.preferences ?? []),
    rating_total: row.rating_total ?? 0,
    rating_count: row.rating_count ?? 0,
    rating_sum_squares: row.rating_sum_squares ?? 0,
    bias: row.bias ?? 0.0
  };

  if (includePasswordHash) {
    user.password_hash = row.password_hash;
  }

  return user;
}

const COMMENT_MEDIA_ATTACHMENTS_METADATA_SQL = `
  CASE
    WHEN jsonb_typeof(toilet_comments.media_attachments) = 'array'
    THEN (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_strip_nulls(
            jsonb_build_object(
              'type', attachment.value ->> 'type',
              'mimeType', attachment.value ->> 'mimeType',
              'name', attachment.value ->> 'name',
              'size',
                CASE
                  WHEN attachment.value ->> 'size' ~ '^[0-9]+$'
                  THEN (attachment.value ->> 'size')::int
                  ELSE 0
                END,
              'hasData', attachment.value ? 'dataUrl'
            )
          )
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(toilet_comments.media_attachments) AS attachment(value)
    )
    ELSE NULL
  END
`;

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
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS rating_total DOUBLE PRECISION NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS rating_sum_squares DOUBLE PRECISION NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS bias REAL NOT NULL DEFAULT 0.0");
  await pool.query("ALTER TABLE users ALTER COLUMN rating_total TYPE DOUBLE PRECISION USING rating_total::double precision");
  await pool.query("ALTER TABLE users ALTER COLUMN rating_sum_squares TYPE DOUBLE PRECISION USING rating_sum_squares::double precision");

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
  await ensurePostgresCommentMediaColumns(pool);

  const demoUserId = await ensureDemoUser(pool);

  await pool.query("UPDATE app_account SET user_id = $1 WHERE user_id IS NULL", [demoUserId]);
  await pool.query("UPDATE access_history SET user_id = $1 WHERE user_id IS NULL", [demoUserId]);
  await pool.query("UPDATE toilet_comments SET username = $1 WHERE username IS NULL", ["Anonymous"]);
  await pool.query("UPDATE toilet_comments SET comment_visibility = $1 WHERE user_id IS NULL OR LOWER(COALESCE(username, '')) = $1", ["anonymous"]);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_app_account_user_id ON app_account(user_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_access_history_user_id ON access_history(user_id)");

  return demoUserId;
}

function getToiletInsertParams(toilet) {
  return [
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
  ];
}

async function insertSeedToilets(pool, seedCsvPath) {
  const toiletsToSeed = await loadSeedToilets(seedCsvPath);
  const client = await pool.connect();
  let insertedCount = 0;

  try {
    await client.query("BEGIN");
    for (const toilet of toiletsToSeed) {
      const result = await client.query(
        `
        INSERT INTO toilets (
          id, name, area, lat, lng, paid, comment,
          women, men, accessible, neutral, children, baby_changing, bidet,
          automatic, urinal_only, radar_key, free_access, opening_times, cleanliness
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (id) DO NOTHING
        `,
        getToiletInsertParams(toilet)
      );
      insertedCount += result.rowCount;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { insertedCount, seedCount: toiletsToSeed.length };
}

export async function seedPostgresToiletsIfEmpty(pool, seedCsvPath) {
  const toiletCount = Number((await pool.query("SELECT COUNT(*)::int AS count FROM toilets")).rows[0]?.count ?? 0);

  if (toiletCount > 0) {
    return { seeded: false, existingCount: toiletCount, insertedCount: 0, seedCount: 0 };
  }

  const result = await insertSeedToilets(pool, seedCsvPath);
  return { seeded: true, existingCount: 0, ...result };
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
      cleanliness DOUBLE PRECISION NOT NULL DEFAULT 3,
      cleanliness_yes_count INTEGER NOT NULL DEFAULT 0,
      cleanliness_no_count INTEGER NOT NULL DEFAULT 0,
      cleanliness_rating_total DOUBLE PRECISION NOT NULL DEFAULT 0,
      cleanliness_rating_count INTEGER NOT NULL DEFAULT 0,
      cleanliness_rating_sum_squares DOUBLE PRECISION NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      gender TEXT,
      preferences JSONB,
      rating_total DOUBLE PRECISION NOT NULL DEFAULT 0,
      rating_count INTEGER NOT NULL DEFAULT 0,
      rating_sum_squares DOUBLE PRECISION NOT NULL DEFAULT 0
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
      comment_visibility TEXT NOT NULL DEFAULT 'real',
      profile_visibility TEXT NOT NULL DEFAULT 'private',
      cleanliness_rating DOUBLE PRECISION,
      comment_text TEXT NOT NULL,
      media_type TEXT,
      media_mime_type TEXT,
      media_name TEXT,
      media_size INTEGER,
      media_url TEXT,
      media_attachments JSONB,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cleanliness_surveys (
      id SERIAL PRIMARY KEY,
      toilet_id TEXT NOT NULL REFERENCES toilets(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      rating DOUBLE PRECISION NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_toilet_id ON cleanliness_surveys(toilet_id);
    CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_created_at ON cleanliness_surveys(created_at);
    CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_created_at_toilet_id ON cleanliness_surveys(created_at, toilet_id, rating);

    CREATE TABLE IF NOT EXISTS comment_likes (
      id SERIAL PRIMARY KEY,
      comment_id INTEGER NOT NULL REFERENCES toilet_comments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE (comment_id, user_id)
    );
  `);
  await pool.query("ALTER TABLE cleanliness_surveys ALTER COLUMN rating TYPE DOUBLE PRECISION USING rating::double precision");

  const demoUserId = await ensurePostgresUserSupport(pool);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_access_history_access_time
    ON access_history(access_time DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_toilet_comments_toilet_id
    ON toilet_comments(toilet_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_toilet_comments_toilet_created_id
    ON toilet_comments(toilet_id, created_at DESC, id DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_toilet_comments_user_id
    ON toilet_comments(user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_toilet_comments_user_created_id
    ON toilet_comments(user_id, created_at DESC, id DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_toilet_comments_public_profile
    ON toilet_comments(user_id, created_at DESC, id DESC)
    WHERE comment_visibility = 'real' AND profile_visibility = 'public';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id
    ON comment_likes(comment_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_toilet_user_created_id
    ON cleanliness_surveys(toilet_id, user_id, created_at DESC, id DESC);
  `);

  await seedPostgresToiletsIfEmpty(pool, seedCsvPath);

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
        "Paid access",
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
        SELECT id, username, password_hash, email, gender, preferences, rating_total, rating_count
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
        SELECT id, username, email, gender, preferences, rating_total, rating_count
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      return mapUserRow(result.rows[0]);
    },
    async getToiletById(toiletId) {
      const safeToiletId = String(toiletId ?? "").trim();
      if (!safeToiletId) return null;

      const fetchToilet = () =>
        pool.query(
          `
          SELECT
            id, name, area, lat, lng, paid, comment,
            women, men, accessible, neutral, children, baby_changing, bidet,
            automatic, urinal_only, radar_key, free_access, opening_times, cleanliness,
            cleanliness_yes_count, cleanliness_no_count, cleanliness_rating_total, cleanliness_rating_count
          FROM toilets
          WHERE id = $1
          LIMIT 1
          `,
          [safeToiletId]
        );

      let result = await fetchToilet();
      if (result.rows.length === 0) {
        const seedResult = await seedPostgresToiletsIfEmpty(pool, seedCsvPath);

        if (seedResult.seeded) {
          result = await fetchToilet();
        }
      }

      return result.rows[0] ? mapRowToToilet(result.rows[0]) : null;
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
    async getToilets({ search = "", accessibleOnly = false, cleanlinessRange = "3days", bounds = null } = {}) {
      const query = normaliseSearchQuery(search);
      const safeBounds = normaliseBounds(bounds);
      const startDate = getCleanlinessRangeStartDate(cleanlinessRange);
      const isAllTime = startDate === null;
      const params = [];
      const conditions = [];

      if (accessibleOnly) {
        params.push("Y");
        conditions.push(`t.accessible = $${params.length}`);
      }

      if (query) {
        params.push(`%${query}%`);
        conditions.push(`(LOWER(t.name) LIKE $${params.length} OR LOWER(t.area) LIKE $${params.length})`);
      }

      if (safeBounds) {
        params.push(safeBounds.minLat);
        const minLatIdx = params.length;
        params.push(safeBounds.maxLat);
        const maxLatIdx = params.length;
        params.push(safeBounds.minLng);
        const minLngIdx = params.length;
        params.push(safeBounds.maxLng);
        const maxLngIdx = params.length;

        conditions.push(`t.lat >= $${minLatIdx} AND t.lat <= $${maxLatIdx}`);
        conditions.push(`t.lng >= $${minLngIdx} AND t.lng <= $${maxLngIdx}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const startDateParam = `$${params.length + 1}`;
      const recentCleanlinessCte = isAllTime
        ? ""
        : `
          WITH recent_cleanliness AS (
            SELECT
              toilet_id,
              AVG(rating) AS cleanliness,
              COALESCE(SUM(rating), 0) AS cleanliness_rating_total,
              COUNT(rating) AS cleanliness_rating_count
            FROM cleanliness_surveys
            WHERE created_at >= ${startDateParam}
            GROUP BY toilet_id
          )
        `;
      const joinClause = isAllTime
        ? ""
        : "LEFT JOIN recent_cleanliness rc ON t.id = rc.toilet_id";
      const cleanlinessColumns = isAllTime
        ? `
          t.cleanliness AS cleanliness,
          t.cleanliness_yes_count,
          t.cleanliness_no_count,
          t.cleanliness_rating_total AS cleanliness_rating_total,
          t.cleanliness_rating_count AS cleanliness_rating_count
        `
        : `
          CASE WHEN rc.cleanliness_rating_count > 0 THEN rc.cleanliness ELSE NULL END AS cleanliness,
          t.cleanliness_yes_count,
          t.cleanliness_no_count,
          COALESCE(rc.cleanliness_rating_total, 0) AS cleanliness_rating_total,
          COALESCE(rc.cleanliness_rating_count, 0) AS cleanliness_rating_count
        `;
      const queryParams = isAllTime ? params : [...params, startDate];

      const fetchToilets = () =>
        pool.query(
          `
          ${recentCleanlinessCte}
          SELECT
            t.id,
            t.name,
            t.area,
            t.lat,
            t.lng,
            t.paid,
            t.women,
            t.men,
            t.accessible,
            t.neutral,
            t.children,
            t.baby_changing,
            t.bidet,
            t.automatic,
            t.urinal_only,
            t.radar_key,
            t.free_access,
            ${cleanlinessColumns}
          FROM toilets t
          ${joinClause}
          ${whereClause}
          ORDER BY t.id
          LIMIT 2000
          `,
          queryParams
        );

      let result = await fetchToilets();

      if (result.rows.length === 0) {
        const seedResult = await seedPostgresToiletsIfEmpty(pool, seedCsvPath);

        if (seedResult.seeded) {
          result = await fetchToilets();
        }
      }

      return result.rows.map(mapRowToToilet);
    },
    async recordCleanlinessSurvey({ userId = null, toiletId = null, toiletName = "", rating, answer }) {
      const { safeToiletId, safeToiletName, safeRating } = normaliseCleanlinessSurveyPayload({
        toiletId,
        toiletName,
        rating,
        answer
      });

      let userAverageRating = 3;
      let userStandardDeviation = 1;
      let userBias = 0.0;
      if (userId) {
        const userResult = await pool.query("SELECT rating_total, rating_count, rating_sum_squares, bias FROM users WHERE id = $1", [userId]);
        const userRow = userResult.rows[0];
        if (userRow) {
          userAverageRating = userRow.rating_count > 0 ? userRow.rating_total / userRow.rating_count : 3;
          userBias = Number(userRow.bias ?? 0.0);

          if (userRow.rating_count > 1) {
            const variance = (userRow.rating_sum_squares / userRow.rating_count) - (userAverageRating * userAverageRating);
            userStandardDeviation = Math.sqrt(Math.max(variance, 0));
          }
        }
      }

      const fetchSurveyToilet = () =>
        safeToiletId
          ? pool.query(
              "SELECT id, name, cleanliness, cleanliness_yes_count, cleanliness_no_count, cleanliness_rating_total, cleanliness_rating_count, cleanliness_rating_sum_squares, bias FROM toilets WHERE id = $1",
              [safeToiletId]
            )
          : pool.query(
              `
              SELECT id, name, cleanliness, cleanliness_yes_count, cleanliness_no_count, cleanliness_rating_total, cleanliness_rating_count, cleanliness_rating_sum_squares, bias
              FROM toilets
              WHERE LOWER(name) = LOWER($1)
              LIMIT 1
              `,
              [safeToiletName]
            );

      let result = await fetchSurveyToilet();

      let row = result.rows[0];
      if (!row) {
        const seedResult = await seedPostgresToiletsIfEmpty(pool, seedCsvPath);

        if (seedResult.seeded) {
          result = await fetchSurveyToilet();
          row = result.rows[0];
        }
      }

      if (!row) {
        throw new Error("toilet not found.");
      }

      if (userId) {
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const recentSurveyResult = await pool.query(
          "SELECT id FROM cleanliness_surveys WHERE toilet_id = $1 AND user_id = $2 AND created_at >= $3 LIMIT 1",
          [row.id, userId, thirtyMinutesAgo]
        );

        if (recentSurveyResult.rows.length > 0) {
          throw new Error("You can only rate this toilet once every 30 minutes.");
        }
      }

      const globalStatsResult = await pool.query("SELECT SUM(rating_total) AS total, SUM(rating_count) AS count, SUM(rating_sum_squares) AS sum_squares FROM users");
      const globalStats = globalStatsResult.rows[0];
      const globalAverageRating = globalStats.count > 0 ? globalStats.total / globalStats.count : 3;
      let globalStandardDeviation = 1;
      if (globalStats.count > 1) {
        const globalVariance = (globalStats.sum_squares / globalStats.count) - (globalAverageRating * globalAverageRating);
        globalStandardDeviation = Math.sqrt(Math.max(globalVariance, 0));
      }

      const { cleanliness, ratingTotal, ratingCount, ratingSumSquares, newUserBias, newToiletBias } = toCleanlinessUpdate({
        row,
        rating: safeRating,
        userAverageRating,
        userStandardDeviation,
        userBias,
        globalAverageRating,
        globalStandardDeviation,
        cleanlinessScoringModel
      });

      if (userId) {
        await pool.query("UPDATE users SET rating_total = rating_total + $1, rating_count = rating_count + 1, rating_sum_squares = rating_sum_squares + $2, bias = $3 WHERE id = $4", [
          safeRating,
          safeRating * safeRating,
          newUserBias ?? userBias,
          userId
        ]);
      }

      await pool.query(
        `
        UPDATE toilets
        SET cleanliness = $1, cleanliness_rating_total = $2, cleanliness_rating_count = $3, cleanliness_rating_sum_squares = $4, bias = $5
        WHERE id = $6
        `,
        [cleanliness, ratingTotal, ratingCount, ratingSumSquares, newToiletBias ?? row.bias ?? 0.0, row.id]
      );

      await pool.query(
        "INSERT INTO cleanliness_surveys (toilet_id, user_id, rating, created_at) VALUES ($1, $2, $3, $4)",
        [row.id, userId, safeRating, new Date().toISOString()]
      );

      return mapCleanlinessSurveyResponse({
        row,
        cleanliness,
        ratingTotal,
        ratingCount,
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
    async recordAccess({ userId, toiletId = null, toiletName, eventType, amountGbp = 0, useFreeTicket = false }) {
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
    async getComments(toiletId, { viewerUserId = null } = {}) {
      if (!toiletId) return [];

      const result = await pool.query(
        `
        SELECT
          id,
          toilet_id,
          user_id,
          username,
          comment_visibility,
          profile_visibility,
          cleanliness_rating,
          comment_text,
          media_type,
          media_mime_type,
          media_name,
          media_size,
          NULL::text AS media_url,
          ${COMMENT_MEDIA_ATTACHMENTS_METADATA_SQL} AS media_attachments,
          created_at,
          (
            SELECT COUNT(*)::int
            FROM comment_likes
            WHERE comment_likes.comment_id = toilet_comments.id
          ) AS like_count,
          EXISTS (
            SELECT 1
            FROM comment_likes
            WHERE comment_likes.comment_id = toilet_comments.id
              AND comment_likes.user_id = $2
          ) AS viewer_has_liked
        FROM toilet_comments
        WHERE toilet_id = $1
        ORDER BY created_at DESC, id DESC
        `,
        [toiletId, viewerUserId]
      );

      return result.rows.map((row) => mapCommentRow(row, { viewerUserId }));
    },
    async getUserComments(userId, limit = 30) {
      const safeLimit = normaliseHistoryLimit(limit);
      const result = await pool.query(
        `
        SELECT
          toilet_comments.id,
          toilet_comments.toilet_id,
          toilet_comments.user_id,
          toilet_comments.username,
          toilet_comments.comment_visibility,
          toilet_comments.profile_visibility,
          COALESCE(
            toilet_comments.cleanliness_rating,
            (
              SELECT cleanliness_surveys.rating
              FROM cleanliness_surveys
              WHERE cleanliness_surveys.toilet_id = toilet_comments.toilet_id
                AND cleanliness_surveys.user_id = toilet_comments.user_id
              ORDER BY cleanliness_surveys.created_at DESC, cleanliness_surveys.id DESC
              LIMIT 1
            )
          ) AS cleanliness_rating,
          toilet_comments.comment_text,
          toilet_comments.media_type,
          toilet_comments.media_mime_type,
          toilet_comments.media_name,
          toilet_comments.media_size,
          NULL::text AS media_url,
          ${COMMENT_MEDIA_ATTACHMENTS_METADATA_SQL} AS media_attachments,
          toilet_comments.created_at,
          toilets.name AS toilet_name,
          toilets.area AS toilet_area,
          (
            SELECT COUNT(*)::int
            FROM comment_likes
            WHERE comment_likes.comment_id = toilet_comments.id
          ) AS like_count,
          EXISTS (
            SELECT 1
            FROM comment_likes
            WHERE comment_likes.comment_id = toilet_comments.id
              AND comment_likes.user_id = $1
          ) AS viewer_has_liked
        FROM toilet_comments
        LEFT JOIN toilets ON toilets.id = toilet_comments.toilet_id
        WHERE toilet_comments.user_id = $1
        ORDER BY toilet_comments.created_at DESC, toilet_comments.id DESC
        LIMIT $2
        `,
        [userId, safeLimit]
      );

      return result.rows.map((row) => mapCommentRow(row, { viewerUserId: userId }));
    },
    async getPublicProfile(userId, { viewerUserId = null, limit = 30 } = {}) {
      const safeUserId = normaliseUserId(userId);
      const safeLimit = normaliseHistoryLimit(limit);
      const userResult = await pool.query(
        "SELECT id, username FROM users WHERE id = $1",
        [safeUserId]
      );
      const user = userResult.rows[0];

      if (!user) return null;

      const commentsResult = await pool.query(
        `
        SELECT
          toilet_comments.id,
          toilet_comments.toilet_id,
          toilet_comments.user_id,
          toilet_comments.username,
          toilet_comments.comment_visibility,
          toilet_comments.profile_visibility,
          COALESCE(
            toilet_comments.cleanliness_rating,
            (
              SELECT cleanliness_surveys.rating
              FROM cleanliness_surveys
              WHERE cleanliness_surveys.toilet_id = toilet_comments.toilet_id
                AND cleanliness_surveys.user_id = toilet_comments.user_id
              ORDER BY cleanliness_surveys.created_at DESC, cleanliness_surveys.id DESC
              LIMIT 1
            )
          ) AS cleanliness_rating,
          toilet_comments.comment_text,
          toilet_comments.media_type,
          toilet_comments.media_mime_type,
          toilet_comments.media_name,
          toilet_comments.media_size,
          NULL::text AS media_url,
          ${COMMENT_MEDIA_ATTACHMENTS_METADATA_SQL} AS media_attachments,
          toilet_comments.created_at,
          toilets.name AS toilet_name,
          toilets.area AS toilet_area,
          (
            SELECT COUNT(*)::int
            FROM comment_likes
            WHERE comment_likes.comment_id = toilet_comments.id
          ) AS like_count,
          EXISTS (
            SELECT 1
            FROM comment_likes
            WHERE comment_likes.comment_id = toilet_comments.id
              AND comment_likes.user_id = $2
          ) AS viewer_has_liked
        FROM toilet_comments
        LEFT JOIN toilets ON toilets.id = toilet_comments.toilet_id
        WHERE toilet_comments.user_id = $1
          AND toilet_comments.comment_visibility = 'real'
          AND toilet_comments.profile_visibility = 'public'
        ORDER BY toilet_comments.created_at DESC, toilet_comments.id DESC
        LIMIT $3
        `,
        [safeUserId, viewerUserId, safeLimit]
      );

      return {
        user: {
          id: user.id,
          username: user.username
        },
        comments: commentsResult.rows.map((row) => mapCommentRow(row, { viewerUserId }))
      };
    },
    async saveComment({ toiletId, userId, username, commentText, media, commentVisibility, cleanlinessRating }) {
      const comment = normaliseCommentPayload({ toiletId, commentText, media, commentVisibility, cleanlinessRating });
      const displayUsername =
        comment.commentVisibility === "anonymous" ? ANONYMOUS_COMMENT_AUTHOR : username;

      const nowIso = new Date().toISOString();
      await pool.query(
        `
        INSERT INTO toilet_comments (
          toilet_id,
          user_id,
          username,
          comment_visibility,
          cleanliness_rating,
          comment_text,
          media_type,
          media_mime_type,
          media_name,
          media_size,
          media_url,
          media_attachments,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
        `,
        [
          comment.toiletId,
          userId,
          displayUsername,
          comment.commentVisibility,
          comment.cleanlinessRating,
          comment.commentText,
          comment.mediaType,
          comment.mediaMimeType,
          comment.mediaName,
          comment.mediaSize,
          comment.mediaUrl,
          comment.mediaAttachmentsJson,
          nowIso
        ]
      );

      return this.getComments(comment.toiletId, { viewerUserId: userId });
    },
    async deleteComment({ toiletId, commentId, userId }) {
      const comment = normaliseCommentDeletePayload({ toiletId, commentId });
      const result = await pool.query(
        `
        DELETE FROM toilet_comments
        WHERE id = $1
          AND toilet_id = $2
          AND user_id = $3
        `,
        [comment.commentId, comment.toiletId, userId]
      );

      return {
        deleted: result.rowCount > 0,
        comments: await this.getComments(comment.toiletId, { viewerUserId: userId })
      };
    },
    async updateCommentProfileVisibility({ commentId, userId, profileVisibility }) {
      const safeCommentId = Number(commentId);
      if (!Number.isInteger(safeCommentId) || safeCommentId <= 0) {
        throw new Error("commentId is required.");
      }

      const safeProfileVisibility = normaliseCommentProfileVisibility(profileVisibility);
      const result = await pool.query(
        `
        UPDATE toilet_comments
        SET profile_visibility = $1
        WHERE id = $2
          AND user_id = $3
        `,
        [safeProfileVisibility, safeCommentId, userId]
      );

      return {
        updated: result.rowCount > 0,
        comments: await this.getUserComments(userId, 30)
      };
    },
    async toggleCommentLike({ toiletId, commentId, userId }) {
      const comment = normaliseCommentLikePayload({ toiletId, commentId });
      const existingLike = await pool.query(
        `
        DELETE FROM comment_likes
        USING toilet_comments
        WHERE comment_likes.comment_id = toilet_comments.id
          AND toilet_comments.id = $1
          AND toilet_comments.toilet_id = $2
          AND comment_likes.user_id = $3
        RETURNING comment_likes.id
        `,
        [comment.commentId, comment.toiletId, userId]
      );

      if (existingLike.rowCount > 0) {
        return {
          found: true,
          liked: false,
          comments: await this.getComments(comment.toiletId, { viewerUserId: userId })
        };
      }

      const insertLike = await pool.query(
        `
        INSERT INTO comment_likes (comment_id, user_id, created_at)
        SELECT id, $3, $4
        FROM toilet_comments
        WHERE id = $1
          AND toilet_id = $2
        ON CONFLICT (comment_id, user_id) DO NOTHING
        RETURNING id
        `,
        [comment.commentId, comment.toiletId, userId, new Date().toISOString()]
      );

      return {
        found: insertLike.rowCount > 0,
        liked: insertLike.rowCount > 0,
        comments: await this.getComments(comment.toiletId, { viewerUserId: userId })
      };
    }
  };
}

