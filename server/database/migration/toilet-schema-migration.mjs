import { loadSeedToilets } from "../seed/toilet-seed-loader.mjs";

const EXTENDED_FEATURE_COLUMNS = [
  { name: "children", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "baby_changing", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "bidet", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "automatic", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "urinal_only", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "radar_key", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "free_access", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "cleanliness", definition: "REAL DEFAULT 7" }
];

const EXTENDED_CLEANLINESS_COLUMNS = [
  { name: "cleanliness", definition: "REAL NOT NULL DEFAULT 3" },
  { name: "cleanliness_yes_count", definition: "INTEGER NOT NULL DEFAULT 0" },
  { name: "cleanliness_no_count", definition: "INTEGER NOT NULL DEFAULT 0" },
  { name: "cleanliness_rating_total", definition: "REAL NOT NULL DEFAULT 0" },
  { name: "cleanliness_rating_count", definition: "INTEGER NOT NULL DEFAULT 0" },
  { name: "cleanliness_rating_sum_squares", definition: "REAL NOT NULL DEFAULT 0" },
  { name: "bias", definition: "REAL NOT NULL DEFAULT 0.0" }
];

const COMMENT_MEDIA_COLUMNS = [
  { name: "media_type", sqliteDefinition: "TEXT", postgresDefinition: "TEXT" },
  { name: "media_mime_type", sqliteDefinition: "TEXT", postgresDefinition: "TEXT" },
  { name: "media_name", sqliteDefinition: "TEXT", postgresDefinition: "TEXT" },
  { name: "media_size", sqliteDefinition: "INTEGER", postgresDefinition: "INTEGER" },
  { name: "media_url", sqliteDefinition: "TEXT", postgresDefinition: "TEXT" },
  { name: "media_attachments", sqliteDefinition: "TEXT", postgresDefinition: "JSONB" }
];

const COMMENT_VISIBILITY_COLUMN = {
  name: "comment_visibility",
  sqliteDefinition: "TEXT NOT NULL DEFAULT 'real'",
  postgresDefinition: "TEXT NOT NULL DEFAULT 'real'"
};

const COMMENT_PROFILE_VISIBILITY_COLUMN = {
  name: "profile_visibility",
  sqliteDefinition: "TEXT NOT NULL DEFAULT 'private'",
  postgresDefinition: "TEXT NOT NULL DEFAULT 'private'"
};

const COMMENT_CLEANLINESS_RATING_COLUMN = {
  name: "cleanliness_rating",
  sqliteDefinition: "REAL",
  postgresDefinition: "DOUBLE PRECISION"
};

function getFeatureColumnValues(toilet) {
  return [
    toilet.features.children,
    toilet.features.babyChanging,
    toilet.features.bidet,
    toilet.features.automatic,
    toilet.features.urinalOnly,
    toilet.features.radarKey,
    toilet.features.free
  ];
}

function ensureSqliteFeatureColumns(db) {
  const existingColumns = new Set(
    db.prepare("PRAGMA table_info(toilets)").all().map((column) => column.name)
  );
  const missingColumns = EXTENDED_FEATURE_COLUMNS.filter((column) => !existingColumns.has(column.name));

  for (const column of missingColumns) {
    db.exec(`ALTER TABLE toilets ADD COLUMN ${column.name} ${column.definition};`);
  }

  return missingColumns;
}

function ensureSqliteCleanlinessColumns(db) {
  const existingColumns = new Set(
    db.prepare("PRAGMA table_info(toilets)").all().map((column) => column.name)
  );
  const missingColumns = EXTENDED_CLEANLINESS_COLUMNS.filter((column) => !existingColumns.has(column.name));

  for (const column of missingColumns) {
    db.exec(`ALTER TABLE toilets ADD COLUMN ${column.name} ${column.definition};`);
  }

  db.exec("UPDATE toilets SET cleanliness = 3 WHERE cleanliness < 1 OR cleanliness > 5;");
  db.exec(`
    UPDATE toilets
    SET
      cleanliness_rating_total = cleanliness_yes_count * 5 + cleanliness_no_count,
      cleanliness_rating_count = cleanliness_yes_count + cleanliness_no_count,
      cleanliness_rating_sum_squares = cleanliness_yes_count * 25 + cleanliness_no_count
    WHERE cleanliness_rating_count = 0
      AND (cleanliness_yes_count > 0 OR cleanliness_no_count > 0);
  `);
}

function getSqliteColumnType(db, tableName, columnName) {
  const column = db.prepare(`PRAGMA table_info(${tableName})`).all().find((item) => item.name === columnName);
  return String(column?.type ?? "").toUpperCase();
}

function sqliteColumnIsInteger(db, tableName, columnName) {
  return getSqliteColumnType(db, tableName, columnName).includes("INT");
}

function rebuildSqliteRatingTablesForDecimals(db) {
  const needsToiletsRebuild =
    sqliteColumnIsInteger(db, "toilets", "cleanliness") ||
    sqliteColumnIsInteger(db, "toilets", "cleanliness_rating_total") ||
    sqliteColumnIsInteger(db, "toilets", "cleanliness_rating_sum_squares");
  const needsUsersRebuild =
    sqliteColumnIsInteger(db, "users", "rating_total") ||
    sqliteColumnIsInteger(db, "users", "rating_sum_squares");
  const needsCommentsRebuild = sqliteColumnIsInteger(db, "toilet_comments", "cleanliness_rating");
  const needsSurveysRebuild = sqliteColumnIsInteger(db, "cleanliness_surveys", "rating");

  if (!needsToiletsRebuild && !needsUsersRebuild && !needsCommentsRebuild && !needsSurveysRebuild) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("PRAGMA legacy_alter_table = ON;");
  db.exec("BEGIN;");
  try {
    if (needsToiletsRebuild) {
      db.exec(`
        ALTER TABLE toilets RENAME TO toilets_integer_rating_backup;
        CREATE TABLE toilets (
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
          cleanliness REAL NOT NULL DEFAULT 3,
          cleanliness_yes_count INTEGER NOT NULL DEFAULT 0,
          cleanliness_no_count INTEGER NOT NULL DEFAULT 0,
          cleanliness_rating_total REAL NOT NULL DEFAULT 0,
          cleanliness_rating_count INTEGER NOT NULL DEFAULT 0,
          cleanliness_rating_sum_squares REAL NOT NULL DEFAULT 0,
          bias REAL NOT NULL DEFAULT 0.0
        ) STRICT;
        INSERT INTO toilets (
          id, name, area, lat, lng, paid, comment, women, men, accessible, neutral,
          children, baby_changing, bidet, automatic, urinal_only, radar_key, free_access,
          opening_times, cleanliness, cleanliness_yes_count, cleanliness_no_count,
          cleanliness_rating_total, cleanliness_rating_count, cleanliness_rating_sum_squares, bias
        )
        SELECT
          id, name, area, lat, lng, paid, comment, women, men, accessible, neutral,
          children, baby_changing, bidet, automatic, urinal_only, radar_key, free_access,
          opening_times, cleanliness, cleanliness_yes_count, cleanliness_no_count,
          cleanliness_rating_total, cleanliness_rating_count, cleanliness_rating_sum_squares, bias
        FROM toilets_integer_rating_backup;
        DROP TABLE toilets_integer_rating_backup;
      `);
    }

    if (needsUsersRebuild) {
      db.exec(`
        ALTER TABLE users RENAME TO users_integer_rating_backup;
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          email TEXT,
          gender TEXT,
          preferences TEXT,
          rating_total REAL NOT NULL DEFAULT 0,
          rating_count INTEGER NOT NULL DEFAULT 0,
          rating_sum_squares REAL NOT NULL DEFAULT 0,
          bias REAL NOT NULL DEFAULT 0.0
        ) STRICT;
        INSERT INTO users (
          id, username, password_hash, email, gender, preferences,
          rating_total, rating_count, rating_sum_squares, bias
        )
        SELECT
          id, username, password_hash, email, gender, preferences,
          rating_total, rating_count, rating_sum_squares, bias
        FROM users_integer_rating_backup;
        DROP TABLE users_integer_rating_backup;
      `);
    }

    if (needsCommentsRebuild) {
      db.exec(`
        ALTER TABLE toilet_comments RENAME TO toilet_comments_integer_rating_backup;
        CREATE TABLE toilet_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          toilet_id TEXT NOT NULL,
          user_id INTEGER,
          username TEXT,
          comment_visibility TEXT NOT NULL DEFAULT 'real',
          profile_visibility TEXT NOT NULL DEFAULT 'private',
          cleanliness_rating REAL,
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
        INSERT INTO toilet_comments (
          id, toilet_id, user_id, username, comment_visibility, profile_visibility,
          cleanliness_rating, comment_text, media_type, media_mime_type, media_name,
          media_size, media_url, media_attachments, created_at
        )
        SELECT
          id, toilet_id, user_id, username, comment_visibility, profile_visibility,
          cleanliness_rating, comment_text, media_type, media_mime_type, media_name,
          media_size, media_url, media_attachments, created_at
        FROM toilet_comments_integer_rating_backup;
        DROP TABLE toilet_comments_integer_rating_backup;
      `);
    }

    if (needsSurveysRebuild) {
      db.exec(`
        ALTER TABLE cleanliness_surveys RENAME TO cleanliness_surveys_integer_rating_backup;
        CREATE TABLE cleanliness_surveys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          toilet_id TEXT NOT NULL,
          user_id INTEGER,
          rating REAL NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        ) STRICT;
        INSERT INTO cleanliness_surveys (id, toilet_id, user_id, rating, created_at)
        SELECT id, toilet_id, user_id, rating, created_at
        FROM cleanliness_surveys_integer_rating_backup;
        DROP TABLE cleanliness_surveys_integer_rating_backup;
      `);
    }

    db.exec("COMMIT;");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_toilet_id ON cleanliness_surveys(toilet_id);
      CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_created_at ON cleanliness_surveys(created_at);
      CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_created_at_toilet_id ON cleanliness_surveys(created_at, toilet_id, rating);
      CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_toilet_user_created_id ON cleanliness_surveys(toilet_id, user_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_toilet_comments_toilet_id ON toilet_comments(toilet_id);
      CREATE INDEX IF NOT EXISTS idx_toilet_comments_toilet_created_id ON toilet_comments(toilet_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_toilet_comments_user_id ON toilet_comments(user_id);
      CREATE INDEX IF NOT EXISTS idx_toilet_comments_user_created_id ON toilet_comments(user_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_toilet_comments_public_profile
      ON toilet_comments(user_id, created_at DESC, id DESC)
      WHERE comment_visibility = 'real' AND profile_visibility = 'public';
    `);
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  } finally {
    db.exec("PRAGMA legacy_alter_table = OFF;");
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

async function backfillSqliteFeatureColumns(db, seedCsvPath) {
  const toiletsToSeed = await loadSeedToilets(seedCsvPath);
  const updateToilet = db.prepare(`
    UPDATE toilets
    SET
      children = ?,
      baby_changing = ?,
      bidet = ?,
      automatic = ?,
      urinal_only = ?,
      radar_key = ?,
      free_access = ?
    WHERE id = ?
  `);

  db.exec("BEGIN;");
  try {
    for (const toilet of toiletsToSeed) {
      updateToilet.run(...getFeatureColumnValues(toilet), toilet.id);
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

async function ensurePostgresFeatureColumns(pool) {
  const result = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'toilets'
    `
  );
  const existingColumns = new Set(result.rows.map((row) => row.column_name));
  const missingColumns = EXTENDED_FEATURE_COLUMNS.filter((column) => !existingColumns.has(column.name));

  for (const column of EXTENDED_FEATURE_COLUMNS) {
    await pool.query(`ALTER TABLE toilets ADD COLUMN IF NOT EXISTS ${column.name} ${column.definition}`);
  }

  return missingColumns;
}

async function ensurePostgresCleanlinessColumns(pool) {
  for (const column of EXTENDED_CLEANLINESS_COLUMNS) {
    await pool.query(`ALTER TABLE toilets ADD COLUMN IF NOT EXISTS ${column.name} ${column.definition}`);
  }

  await pool.query("ALTER TABLE toilets ALTER COLUMN cleanliness TYPE DOUBLE PRECISION USING cleanliness::double precision");
  await pool.query("ALTER TABLE toilets ALTER COLUMN cleanliness_rating_total TYPE DOUBLE PRECISION USING cleanliness_rating_total::double precision");
  await pool.query("ALTER TABLE toilets ALTER COLUMN cleanliness_rating_sum_squares TYPE DOUBLE PRECISION USING cleanliness_rating_sum_squares::double precision");

  await pool.query("UPDATE toilets SET cleanliness = 3 WHERE cleanliness < 1 OR cleanliness > 5");
  await pool.query(`
    UPDATE toilets
    SET
      cleanliness_rating_total = cleanliness_yes_count * 5 + cleanliness_no_count,
      cleanliness_rating_count = cleanliness_yes_count + cleanliness_no_count,
      cleanliness_rating_sum_squares = cleanliness_yes_count * 25 + cleanliness_no_count
    WHERE cleanliness_rating_count = 0
      AND (cleanliness_yes_count > 0 OR cleanliness_no_count > 0)
  `);
}

async function backfillPostgresFeatureColumns(pool, seedCsvPath) {
  const toiletsToSeed = await loadSeedToilets(seedCsvPath);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    for (const toilet of toiletsToSeed) {
      await client.query(
        `
        UPDATE toilets
        SET
          children = $1,
          baby_changing = $2,
          bidet = $3,
          automatic = $4,
          urinal_only = $5,
          radar_key = $6,
          free_access = $7
        WHERE id = $8
        `,
        [...getFeatureColumnValues(toilet), toilet.id]
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

export async function applySqliteToiletMigrations({ db, seedCsvPath }) {
  const missingFeatureColumns = ensureSqliteFeatureColumns(db);
  ensureSqliteCleanlinessColumns(db);
  ensureSqliteUserSupport(db);
  ensureSqliteUserColumns(db);
  rebuildSqliteRatingTablesForDecimals(db);

  if (missingFeatureColumns.length > 0) {
    await backfillSqliteFeatureColumns(db, seedCsvPath);
  }
}

function ensureSqliteUserColumns(db) {
  const existingColumns = new Set(
    db.prepare("PRAGMA table_info(users)").all().map((column) => column.name)
  );
  
  if (!existingColumns.has("gender")) {
    db.exec("ALTER TABLE users ADD COLUMN gender TEXT;");
  }
  if (!existingColumns.has("preferences")) {
    db.exec("ALTER TABLE users ADD COLUMN preferences TEXT;");
  }
  if (!existingColumns.has("rating_total")) {
    db.exec("ALTER TABLE users ADD COLUMN rating_total REAL NOT NULL DEFAULT 0;");
  }
  if (!existingColumns.has("rating_count")) {
    db.exec("ALTER TABLE users ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;");
  }
  if (!existingColumns.has("rating_sum_squares")) {
    db.exec("ALTER TABLE users ADD COLUMN rating_sum_squares REAL NOT NULL DEFAULT 0;");
  }
  if (!existingColumns.has("bias")) {
    db.exec("ALTER TABLE users ADD COLUMN bias REAL NOT NULL DEFAULT 0.0;");
  }
}

function ensureSqliteUserSupport(db) {
  // 1. Create users table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT
    ) STRICT;
  `);

  // 2. Add user_id to app_account
  const appAccountCols = new Set(db.prepare("PRAGMA table_info(app_account)").all().map(c => c.name));
  if (!appAccountCols.has("user_id")) {
    db.exec("ALTER TABLE app_account ADD COLUMN user_id INTEGER;");
  }

  // 3. Add user_id to access_history
  const accessHistoryCols = new Set(db.prepare("PRAGMA table_info(access_history)").all().map(c => c.name));
  if (!accessHistoryCols.has("user_id")) {
    db.exec("ALTER TABLE access_history ADD COLUMN user_id INTEGER;");
  }

  // 4. Add user_id and username to toilet_comments
  const commentCols = new Set(db.prepare("PRAGMA table_info(toilet_comments)").all().map(c => c.name));
  if (!commentCols.has("user_id")) {
    db.exec("ALTER TABLE toilet_comments ADD COLUMN user_id INTEGER;");
  }
  if (!commentCols.has("username")) {
    db.exec("ALTER TABLE ADD COLUMN username TEXT;");
  }
  if (!commentCols.has(COMMENT_VISIBILITY_COLUMN.name)) {
    db.exec(`ALTER TABLE toilet_comments ADD COLUMN ${COMMENT_VISIBILITY_COLUMN.name} ${COMMENT_VISIBILITY_COLUMN.sqliteDefinition};`);
    db.exec("UPDATE toilet_comments SET comment_visibility = 'anonymous' WHERE user_id IS NULL OR LOWER(COALESCE(username, '')) = 'anonymous';");
  }
  if (!commentCols.has(COMMENT_PROFILE_VISIBILITY_COLUMN.name)) {
    db.exec(`ALTER TABLE toilet_comments ADD COLUMN ${COMMENT_PROFILE_VISIBILITY_COLUMN.name} ${COMMENT_PROFILE_VISIBILITY_COLUMN.sqliteDefinition};`);
  }
  if (!commentCols.has(COMMENT_CLEANLINESS_RATING_COLUMN.name)) {
    db.exec(`ALTER TABLE toilet_comments ADD COLUMN ${COMMENT_CLEANLINESS_RATING_COLUMN.name} ${COMMENT_CLEANLINESS_RATING_COLUMN.sqliteDefinition};`);
  }
  for (const column of COMMENT_MEDIA_COLUMNS) {
    if (!commentCols.has(column.name)) {
      db.exec(`ALTER TABLE toilet_comments ADD COLUMN ${column.name} ${column.sqliteDefinition};`);
    }
  }

  // 5. If we have orphaned records and no users, we need to create a default user and link them.
  // This handles the transition for an existing database.
  const userCount = Number(db.prepare("SELECT COUNT(*) AS count FROM users").get().count);
  if (userCount === 0) {
    const hasOrphans = db.prepare("SELECT 1 FROM app_account WHERE user_id IS NULL LIMIT 1").get() ||
                       db.prepare("SELECT 1 FROM access_history WHERE user_id IS NULL LIMIT 1").get();
    
    if (hasOrphans) {
      // We'll let the repository create its "demo" user, but we need to ensure 
      // it happens before we try to enforce user_id or if we want to fix orphans now.
      // For simplicity, let's just allow NULL for now and let the repository handle the first user.
      // But we must NOT have the NOT NULL constraint in the CREATE TABLE IF NOT EXISTS in the repository
      // if we want to be safe with existing tables.
    }
  }
}

export async function applyPostgresToiletMigrations({ pool, seedCsvPath }) {
  const missingFeatureColumns = await ensurePostgresFeatureColumns(pool);
  await ensurePostgresCleanlinessColumns(pool);

  if (missingFeatureColumns.length > 0) {
    await backfillPostgresFeatureColumns(pool, seedCsvPath);
  }
}

export async function ensurePostgresCommentMediaColumns(pool) {
  await pool.query(`ALTER TABLE toilet_comments ADD COLUMN IF NOT EXISTS ${COMMENT_VISIBILITY_COLUMN.name} ${COMMENT_VISIBILITY_COLUMN.postgresDefinition}`);
  await pool.query("UPDATE toilet_comments SET comment_visibility = 'anonymous' WHERE user_id IS NULL OR LOWER(COALESCE(username, '')) = 'anonymous'");
  await pool.query(`ALTER TABLE toilet_comments ADD COLUMN IF NOT EXISTS ${COMMENT_PROFILE_VISIBILITY_COLUMN.name} ${COMMENT_PROFILE_VISIBILITY_COLUMN.postgresDefinition}`);
  await pool.query(`ALTER TABLE toilet_comments ADD COLUMN IF NOT EXISTS ${COMMENT_CLEANLINESS_RATING_COLUMN.name} ${COMMENT_CLEANLINESS_RATING_COLUMN.postgresDefinition}`);
  await pool.query("ALTER TABLE toilet_comments ALTER COLUMN cleanliness_rating TYPE DOUBLE PRECISION USING cleanliness_rating::double precision");

  for (const column of COMMENT_MEDIA_COLUMNS) {
    await pool.query(`ALTER TABLE toilet_comments ADD COLUMN IF NOT EXISTS ${column.name} ${column.postgresDefinition}`);
  }
}
