import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../server/database.mjs";

function readArg(name) {
  const prefix = `${name}=`;
  const inlineArg = process.argv.find((arg) => arg.startsWith(prefix));
  if (inlineArg) return inlineArg.slice(prefix.length);

  const argIndex = process.argv.indexOf(name);
  if (argIndex >= 0) return process.argv[argIndex + 1] ?? "";

  return "";
}

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = readArg("--database-url") || process.env.WHERETOI_DATABASE_URL;
const seedCsvPath =
  readArg("--seed-csv") || process.env.WHERETOI_SEED_CSV || resolve(rootDirectory, "src", "data", "toilets.csv");

if (!databaseUrl) {
  console.error("Missing WHERETOI_DATABASE_URL. Set it in the environment or pass --database-url.");
  process.exitCode = 1;
} else {
  let database;

  try {
    database = await createDatabase({
      rootDirectory,
      databaseUrl,
      seedCsvPath,
      allowDatabaseFallback: false
    });

    const toilets = await database.getToilets({ cleanlinessRange: "all" });
    const demoUser = await database.getUserByUsername("demo");

    console.log("Postgres repair check complete.");
    console.log(`Toilets available: ${toilets.length}`);
    console.log(`Demo user: ${demoUser ? "present" : "missing"}`);
  } finally {
    await database?.close?.();
  }
}
