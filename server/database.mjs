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
  allowDatabaseFallback = process.env.WHERETOI_ALLOW_DB_FALLBACK !== "false"
} = {}) {
  const resolvedSeedCsvPath =
    resolvePath(rootDirectory, seedCsvPath) ?? resolve(rootDirectory, "src", "data", "toilets.csv");

  const resolvedDbFilePath =
    resolvePath(rootDirectory, dbFilePath) ?? resolve(rootDirectory, "data", "wheretoi.sqlite");

  const createSqliteFallback = () =>
    createSqliteDatabase({
      dbFilePath: resolvedDbFilePath,
      seedCsvPath: resolvedSeedCsvPath,
      cleanlinessScoringModel
    });

  if (databaseUrl) {
    try {
      return await createPostgresDatabase({
        connectionString: databaseUrl,
        seedCsvPath: resolvedSeedCsvPath,
        cleanlinessScoringModel
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

  return createSqliteFallback();
}
