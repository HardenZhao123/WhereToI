import { isAbsolute, resolve } from "node:path";
import { createPostgresDatabase } from "./database/repository/postgres-repository.mjs";
import { createSqliteDatabase } from "./database/repository/sqlite-repository.mjs";
import { getConfiguredCleanlinessScoringModel } from "./database/scoring/cleanliness-scoring.mjs";

function resolvePath(rootDirectory, targetPath) {
  if (!targetPath) return null;
  return isAbsolute(targetPath) ? targetPath : resolve(rootDirectory, targetPath);
}

export async function createDatabase({
  rootDirectory = ".",
  dbFilePath = process.env.WHERETOI_DB_FILE,
  seedCsvPath = process.env.WHERETOI_SEED_CSV,
  databaseUrl = process.env.WHERETOI_DATABASE_URL,
  cleanlinessScoringModel = getConfiguredCleanlinessScoringModel(),
  allowDatabaseFallback = process.env.WHERETOI_ALLOW_DB_FALLBACK === "true",
  requireDatabaseUrl = process.env.WHERETOI_REQUIRE_DATABASE_URL === "true",
  enableDemoAccount = process.env.WHERETOI_ENABLE_DEMO_ACCOUNT === "true",
  createPostgres = createPostgresDatabase,
  createSqlite = createSqliteDatabase
} = {}) {
  const resolvedSeedCsvPath =
    resolvePath(rootDirectory, seedCsvPath) ?? resolve(rootDirectory, "src", "data", "toilets.csv");

  const resolvedDbFilePath =
    resolvePath(rootDirectory, dbFilePath) ?? resolve(rootDirectory, "data", "wheretoi.sqlite");

  const createSqliteFallback = () =>
    createSqlite({
      dbFilePath: resolvedDbFilePath,
      seedCsvPath: resolvedSeedCsvPath,
      cleanlinessScoringModel,
      enableDemoAccount
    });

  if (databaseUrl) {
    try {
      return await createPostgres({
        connectionString: databaseUrl,
        seedCsvPath: resolvedSeedCsvPath,
        cleanlinessScoringModel,
        enableDemoAccount
      });
    } catch (error) {
      if (!allowDatabaseFallback) {
        throw error;
      }

      console.error(
        "PostgreSQL initialisation failed. Falling back to local SQLite. Set WHERETOI_ALLOW_DB_FALLBACK=false to disable fallback.",
        error
      );
      return createSqliteFallback();
    }
  }

  if (requireDatabaseUrl) {
    throw new Error(
      "WHERETOI_DATABASE_URL is required. Refusing to start with local SQLite."
    );
  }

  return createSqliteFallback();
}
