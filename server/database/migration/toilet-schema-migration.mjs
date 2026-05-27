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

  if (missingFeatureColumns.length > 0) {
    await backfillSqliteFeatureColumns(db, seedCsvPath);
  }
}

export async function applyPostgresToiletMigrations({ pool, seedCsvPath }) {
  const missingFeatureColumns = await ensurePostgresFeatureColumns(pool);
  await ensurePostgresCleanlinessColumns(pool);

  if (missingFeatureColumns.length > 0) {
    await backfillPostgresFeatureColumns(pool, seedCsvPath);
  }
}
