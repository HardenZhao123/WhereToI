import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const todayDayIndex = (new Date().getDay() + 6) % 7;

const fallbackToilets = [
  {
    id: "city",
    name: "City and Guilds building",
    area: "Imperial College London",
    lat: 51.49876,
    lng: -0.17687,
    paid: false,
    comment: "Comment: clean today, short queue.",
    features: {
      women: "Y",
      men: "Y",
      accessible: "N",
      neutral: "?",
      children: "?",
      babyChanging: "N",
      bidet: "?",
      automatic: "?",
      urinalOnly: "N",
      radarKey: "?",
      free: "Y"
    },
    openingTimes: []
  },
  {
    id: "station",
    name: "South Kensington Station",
    area: "Partner paid toilet",
    lat: 51.49412,
    lng: -0.17392,
    paid: true,
    comment: "Comment: QR gate required, usually busy after lectures.",
    features: {
      women: "Y",
      men: "Y",
      accessible: "Y",
      neutral: "N",
      children: "?",
      babyChanging: "?",
      bidet: "Y",
      automatic: "?",
      urinalOnly: "N",
      radarKey: "?",
      free: "N"
    },
    openingTimes: []
  },
  {
    id: "library",
    name: "Imperial Library",
    area: "Campus access",
    lat: 51.49818,
    lng: -0.17821,
    paid: false,
    comment: "Comment: open late with accessible facilities nearby.",
    features: {
      women: "Y",
      men: "Y",
      accessible: "Y",
      neutral: "Y",
      children: "Y",
      babyChanging: "Y",
      bidet: "?",
      automatic: "N",
      urinalOnly: "N",
      radarKey: "?",
      free: "Y"
    },
    openingTimes: []
  },
  {
    id: "museum",
    name: "Museum Quarter",
    area: "Public toilet",
    lat: 51.49661,
    lng: -0.17222,
    paid: false,
    comment: "Comment: free access, closes early on Sundays.",
    features: {
      women: "Y",
      men: "Y",
      accessible: "Y",
      neutral: "N",
      children: "Y",
      babyChanging: "Y",
      bidet: "?",
      automatic: "N",
      urinalOnly: "N",
      radarKey: "?",
      free: "Y"
    },
    openingTimes: []
  }
];

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (character !== "\r") {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const [headers, ...records] = rows;

  return records
    .filter((record) => record.some((cell) => cell.trim() !== ""))
    .map((record) => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = record[index] ?? "";
      });
      return object;
    });
}

function normaliseText(value) {
  return value ? value.replace(/\s+/g, " ").trim() : "";
}

function toFeatureFlag(value) {
  const normalised = normaliseText(value).toLowerCase();
  if (normalised === "true") return "Y";
  if (normalised === "false") return "N";
  return "?";
}

const extendedFeatureColumns = [
  { name: "children", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "baby_changing", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "bidet", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "automatic", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "urinal_only", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "radar_key", definition: "TEXT NOT NULL DEFAULT '?'" },
  { name: "free_access", definition: "TEXT NOT NULL DEFAULT '?'" }
];

const extendedCleanlinessColumns = [
  { name: "cleanliness", definition: "INTEGER NOT NULL DEFAULT 3" },
  { name: "cleanliness_yes_count", definition: "INTEGER NOT NULL DEFAULT 0" },
  { name: "cleanliness_no_count", definition: "INTEGER NOT NULL DEFAULT 0" }
];

function clampCleanlinessScore(value) {
  return Math.min(Math.max(Math.round(value), 1), 5);
}

function normaliseScoringModel(scoringModel = null) {
  const modelType =
    typeof scoringModel === "string"
      ? normaliseText(scoringModel).toLowerCase()
      : normaliseText(scoringModel?.type).toLowerCase();

  if (!modelType || modelType === "average") {
    return { type: "average" };
  }

  if (modelType === "ema" || modelType === "exponential_moving_average") {
    const alpha = Number(scoringModel?.alpha ?? 0.35);
    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
      throw new Error("scoringModel.alpha must be a number greater than 0 and less than or equal to 1.");
    }

    return { type: "ema", alpha };
  }

  throw new Error("Unsupported scoringModel type.");
}

function getConfiguredCleanlinessScoringModel() {
  const modelType = normaliseText(process.env.WHERETOI_CLEANLINESS_SCORING_MODEL).toLowerCase();

  if (modelType === "ema" || modelType === "exponential_moving_average") {
    return normaliseScoringModel({
      type: "ema",
      alpha: process.env.WHERETOI_CLEANLINESS_EMA_ALPHA
    });
  }

  return normaliseScoringModel(modelType || "average");
}

function calculateCleanlinessScore({ yesCount, noCount, previousCleanliness = 3, answer, scoringModel = null }) {
  const model = normaliseScoringModel(scoringModel);

  if (model.type === "ema") {
    const previousScore = Number.isFinite(Number(previousCleanliness)) ? Number(previousCleanliness) : 3;
    const voteScore = answer === "yes" ? 5 : 1;
    return clampCleanlinessScore(model.alpha * voteScore + (1 - model.alpha) * previousScore);
  }

  const total = yesCount + noCount;
  if (total <= 0) return 3;

  return clampCleanlinessScore(1 + (yesCount / total) * 4);
}

function inferBidetOrWashingFlag(record) {
  const searchableText = normaliseText(
    `${record.name ?? ""} ${record.notes ?? ""} ${record.payment_details ?? ""}`
  ).toLowerCase();

  if (!searchableText) return "?";

  if (
    /\b(bidet|wudu|ablution|shattaf)\b/.test(searchableText) ||
    searchableText.includes("muslim") ||
    searchableText.includes("prayer room washroom")
  ) {
    return "Y";
  }

  return "?";
}

function parseAreaName(areasField) {
  if (!areasField) return "Unknown area";

  try {
    const parsed = JSON.parse(areasField);
    if (typeof parsed?.name === "string" && parsed.name.trim().length > 0) {
      return parsed.name.trim();
    }
  } catch {
    // Ignore malformed area payloads.
  }

  return "Unknown area";
}

function parseOpeningTimes(openingTimesField) {
  if (!openingTimesField) return [];

  if (Array.isArray(openingTimesField)) {
    return openingTimesField;
  }

  try {
    const parsed = JSON.parse(openingTimesField);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDayHours(openingTimes, dayIndex) {
  const dayLabel = dayLabels[dayIndex] ?? "Day";
  const slot = openingTimes[dayIndex];

  if (!Array.isArray(slot) || slot.length < 2) {
    return `${dayLabel} Closed`;
  }

  const [openTime, closeTime] = slot;
  if (!openTime || !closeTime) {
    return `${dayLabel} Closed`;
  }

  return `${dayLabel} ${openTime} - ${closeTime}`;
}

function mapRecordToToilet(record) {
  if (record.active !== "true") return null;

  const lat = Number(record.latitude);
  const lng = Number(record.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const openingTimes = parseOpeningTimes(record.opening_times);
  const note = normaliseText(record.notes);
  const paymentDetails = normaliseText(record.payment_details);
  const commentBody = note || paymentDetails || "No notes yet.";
  const name = normaliseText(record.name) || "Unnamed toilet";
  const area = parseAreaName(record.areas);
  const noPayment = normaliseText(record.no_payment).toLowerCase();
  const paid = noPayment === "false" || paymentDetails.length > 0;

  return {
    id: record.id || `${name}-${lat}-${lng}`,
    name,
    area,
    lat,
    lng,
    paid,
    comment: `Comment: ${commentBody}`,
    features: {
      women: toFeatureFlag(record.women),
      men: toFeatureFlag(record.men),
      accessible: toFeatureFlag(record.accessible),
      neutral: toFeatureFlag(record.all_gender),
      children: toFeatureFlag(record.children),
      babyChanging: toFeatureFlag(record.baby_change),
      bidet: inferBidetOrWashingFlag(record),
      automatic: toFeatureFlag(record.automatic),
      urinalOnly: toFeatureFlag(record.urinal_only),
      radarKey: toFeatureFlag(record.radar),
      free: toFeatureFlag(record.no_payment)
    },
    openingTimes
  };
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    return normalised === "1" || normalised === "true" || normalised === "t";
  }
  return false;
}

function mapRowToToilet(row) {
  const openingTimes = parseOpeningTimes(row.opening_times);

  return {
    id: row.id,
    name: row.name,
    area: row.area,
    lat: Number(row.lat),
    lng: Number(row.lng),
    paid: toBoolean(row.paid),
    comment: row.comment,
    features: {
      women: row.women,
      men: row.men,
      accessible: row.accessible,
      neutral: row.neutral,
      children: row.children,
      babyChanging: row.baby_changing,
      bidet: row.bidet,
      automatic: row.automatic,
      urinalOnly: row.urinal_only,
      radarKey: row.radar_key,
      free: row.free_access
    },
    hours: {
      today: formatDayHours(openingTimes, todayDayIndex),
      sat: formatDayHours(openingTimes, 5),
      sun: formatDayHours(openingTimes, 6)
    },
    cleanliness: Number(row.cleanliness ?? 3),
    cleanlinessSurvey: {
      yes: Number(row.cleanliness_yes_count ?? 0),
      no: Number(row.cleanliness_no_count ?? 0)
    }
  };
}

function resolvePath(rootDirectory, targetPath) {
  if (!targetPath) return null;
  return isAbsolute(targetPath) ? targetPath : resolve(rootDirectory, targetPath);
}

async function loadSeedToilets(csvPath) {
  let toilets = [];

  try {
    const csv = await readFile(csvPath, "utf8");
    const records = rowsToObjects(parseCsv(csv));
    toilets = records.map(mapRecordToToilet).filter(Boolean);
  } catch {
    toilets = [];
  }

  if (toilets.length === 0) {
    toilets = fallbackToilets;
  }

  return toilets;
}

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
  const missingColumns = extendedFeatureColumns.filter((column) => !existingColumns.has(column.name));

  for (const column of missingColumns) {
    db.exec(`ALTER TABLE toilets ADD COLUMN ${column.name} ${column.definition};`);
  }

  return missingColumns;
}

function ensureSqliteCleanlinessColumns(db) {
  const existingColumns = new Set(
    db.prepare("PRAGMA table_info(toilets)").all().map((column) => column.name)
  );
  const missingColumns = extendedCleanlinessColumns.filter((column) => !existingColumns.has(column.name));

  for (const column of missingColumns) {
    db.exec(`ALTER TABLE toilets ADD COLUMN ${column.name} ${column.definition};`);
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
  const missingColumns = extendedFeatureColumns.filter((column) => !existingColumns.has(column.name));

  for (const column of extendedFeatureColumns) {
    await pool.query(`ALTER TABLE toilets ADD COLUMN IF NOT EXISTS ${column.name} ${column.definition}`);
  }

  return missingColumns;
}

async function ensurePostgresCleanlinessColumns(pool) {
  for (const column of extendedCleanlinessColumns) {
    await pool.query(`ALTER TABLE toilets ADD COLUMN IF NOT EXISTS ${column.name} ${column.definition}`);
  }
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

async function createSqliteDatabase({ dbFilePath, seedCsvPath, cleanlinessScoringModel }) {
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

  const missingFeatureColumns = ensureSqliteFeatureColumns(db);
  ensureSqliteCleanlinessColumns(db);
  if (missingFeatureColumns.length > 0) {
    await backfillSqliteFeatureColumns(db, seedCsvPath);
  }

  const toiletCount = Number(db.prepare("SELECT COUNT(*) AS count FROM toilets").get()?.count ?? 0);

  if (toiletCount === 0) {
    const toiletsToSeed = await loadSeedToilets(seedCsvPath);
    const insertToilet = db.prepare(`
      INSERT INTO toilets (
        id, name, area, lat, lng, paid, comment,
        women, men, accessible, neutral, children, baby_changing, bidet,
        automatic, urinal_only, radar_key, free_access, opening_times
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          JSON.stringify(toilet.openingTimes ?? [])
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

      const query = normaliseText(search).toLowerCase();

      return rows
        .map(mapRowToToilet)
        .filter((toilet) => {
          if (accessibleOnly && toilet.features.accessible !== "Y") return false;
          if (!query) return true;

          return (
            toilet.name.toLowerCase().includes(query) ||
            toilet.area.toLowerCase().includes(query)
          );
        });
    },
    async recordCleanlinessSurvey({ toiletId = null, toiletName = "", answer }) {
      const safeToiletId = normaliseText(toiletId);
      const safeToiletName = normaliseText(toiletName).replace(/\s+Toilet$/i, "");
      const safeAnswer = normaliseText(answer).toLowerCase();

      if (safeAnswer !== "yes" && safeAnswer !== "no") {
        throw new Error("answer must be yes or no.");
      }

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

      const yesCount = Number(row.cleanliness_yes_count ?? 0) + (safeAnswer === "yes" ? 1 : 0);
      const noCount = Number(row.cleanliness_no_count ?? 0) + (safeAnswer === "no" ? 1 : 0);
      const cleanliness = calculateCleanlinessScore({
        yesCount,
        noCount,
        previousCleanliness: row.cleanliness,
        answer: safeAnswer,
        scoringModel: cleanlinessScoringModel
      });

      db.prepare(
        `
        UPDATE toilets
        SET cleanliness = ?, cleanliness_yes_count = ?, cleanliness_no_count = ?
        WHERE id = ?
        `
      ).run(cleanliness, yesCount, noCount, row.id);

      return {
        toilet: {
          id: row.id,
          name: row.name,
          cleanliness,
          cleanlinessSurvey: {
            yes: yesCount,
            no: noCount
          },
          scoringModel: cleanlinessScoringModel
        }
      };
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

      return {
        walletBalanceGbp: Number(row.wallet_balance_gbp),
        subscriptionName: row.subscription_name,
        subscriptionRenewsOn: row.subscription_renews_on,
        monthlyFreeTicketsLeft: Number(row.monthly_free_tickets_left)
      };
    },
    async getAccessHistory(limit = 10) {
      const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 50) : 10;
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

      return rows.map((row) => ({
        id: Number(row.id),
        toiletId: row.toilet_id,
        toiletName: row.toilet_name,
        eventType: row.event_type,
        amountGbp: Number(row.amount_gbp),
        accessTime: row.access_time
      }));
    },
    async recordAccess({ toiletId = null, toiletName, eventType, amountGbp = 0, useFreeTicket = false }) {
      const safeToiletName = normaliseText(toiletName);
      const safeEventType = normaliseText(eventType);
      const safeAmount = Number(amountGbp);

      if (!safeToiletName) {
        throw new Error("toiletName is required.");
      }

      if (!safeEventType) {
        throw new Error("eventType is required.");
      }

      if (!Number.isFinite(safeAmount) || safeAmount < 0) {
        throw new Error("amountGbp must be a non-negative number.");
      }

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
        updateAccount.run(safeAmount, useFreeTicket ? 1 : 0);
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

async function createPostgresDatabase({ connectionString, seedCsvPath, cleanlinessScoringModel }) {
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

  const missingFeatureColumns = await ensurePostgresFeatureColumns(pool);
  await ensurePostgresCleanlinessColumns(pool);
  if (missingFeatureColumns.length > 0) {
    await backfillPostgresFeatureColumns(pool, seedCsvPath);
  }

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
            automatic, urinal_only, radar_key, free_access, opening_times
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
            JSON.stringify(toilet.openingTimes ?? [])
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
      const query = normaliseText(search).toLowerCase();
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
      const safeToiletId = normaliseText(toiletId);
      const safeToiletName = normaliseText(toiletName).replace(/\s+Toilet$/i, "");
      const safeAnswer = normaliseText(answer).toLowerCase();

      if (safeAnswer !== "yes" && safeAnswer !== "no") {
        throw new Error("answer must be yes or no.");
      }

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

      const yesCount = Number(row.cleanliness_yes_count ?? 0) + (safeAnswer === "yes" ? 1 : 0);
      const noCount = Number(row.cleanliness_no_count ?? 0) + (safeAnswer === "no" ? 1 : 0);
      const cleanliness = calculateCleanlinessScore({
        yesCount,
        noCount,
        previousCleanliness: row.cleanliness,
        answer: safeAnswer,
        scoringModel: cleanlinessScoringModel
      });

      await pool.query(
        `
        UPDATE toilets
        SET cleanliness = $1, cleanliness_yes_count = $2, cleanliness_no_count = $3
        WHERE id = $4
        `,
        [cleanliness, yesCount, noCount, row.id]
      );

      return {
        toilet: {
          id: row.id,
          name: row.name,
          cleanliness,
          cleanlinessSurvey: {
            yes: yesCount,
            no: noCount
          },
          scoringModel: cleanlinessScoringModel
        }
      };
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

      const row = result.rows[0];
      return {
        walletBalanceGbp: Number(row.wallet_balance_gbp),
        subscriptionName: row.subscription_name,
        subscriptionRenewsOn: row.subscription_renews_on,
        monthlyFreeTicketsLeft: Number(row.monthly_free_tickets_left)
      };
    },
    async getAccessHistory(limit = 10) {
      const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 50) : 10;
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

      return result.rows.map((row) => ({
        id: Number(row.id),
        toiletId: row.toilet_id,
        toiletName: row.toilet_name,
        eventType: row.event_type,
        amountGbp: Number(row.amount_gbp),
        accessTime: row.access_time
      }));
    },
    async recordAccess({ toiletId = null, toiletName, eventType, amountGbp = 0, useFreeTicket = false }) {
      const safeToiletName = normaliseText(toiletName);
      const safeEventType = normaliseText(eventType);
      const safeAmount = Number(amountGbp);

      if (!safeToiletName) {
        throw new Error("toiletName is required.");
      }

      if (!safeEventType) {
        throw new Error("eventType is required.");
      }

      if (!Number.isFinite(safeAmount) || safeAmount < 0) {
        throw new Error("amountGbp must be a non-negative number.");
      }

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
          [safeAmount, Boolean(useFreeTicket)]
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

export async function createDatabase({
  rootDirectory = ".",
  dbFilePath = process.env.WHERETOI_DB_FILE,
  seedCsvPath = process.env.WHERETOI_SEED_CSV,
  databaseUrl = process.env.WHERETOI_DATABASE_URL,
  cleanlinessScoringModel = getConfiguredCleanlinessScoringModel()
} = {}) {
  const resolvedSeedCsvPath =
    resolvePath(rootDirectory, seedCsvPath) ?? resolve(rootDirectory, "src", "data", "toilets.csv");

  if (databaseUrl) {
    return createPostgresDatabase({
      connectionString: databaseUrl,
      seedCsvPath: resolvedSeedCsvPath,
      cleanlinessScoringModel
    });
  }

  const resolvedDbFilePath =
    resolvePath(rootDirectory, dbFilePath) ?? resolve(rootDirectory, "data", "wheretoi.sqlite");

  return createSqliteDatabase({
    dbFilePath: resolvedDbFilePath,
    seedCsvPath: resolvedSeedCsvPath,
    cleanlinessScoringModel
  });
}
