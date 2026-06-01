import { loadSeedToilets } from "../seed/toilet-seed-loader.mjs";

const EXTENDED_FEATURE_COLUMNS = [
  { name: "children", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "baby_changing", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "bidet", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "automatic", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "urinal_only", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "radar_key", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "free_access", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "cleanliness", definition: "INTEGER DEFAULT 7" }
];

const EXTENDED_CLEANLINESS_COLUMNS = [
  { name: "cleanliness", definition: "INTEGER NOT NULL DEFAULT 3" },
  { name: "cleanliness_yes_count", definition: "INTEGER NOT NULL DEFAULT 0" },
  { name: "cleanliness_no_count", definition: "INTEGER NOT NULL DEFAULT 0" }
];

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

  await pool.query("UPDATE toilets SET cleanliness = 3 WHERE cleanliness < 1 OR cleanliness > 5");
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

  if (missingFeatureColumns.length > 0) {
    await backfillSqliteFeatureColumns(db, seedCsvPath);
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
    db.exec("ALTER TABLE toilet_comments ADD COLUMN username TEXT;");
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
