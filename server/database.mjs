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
    features: { women: "Y", men: "Y", accessible: "N", neutral: "?" },
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
    features: { women: "Y", men: "Y", accessible: "Y", neutral: "N" },
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
    features: { women: "Y", men: "Y", accessible: "Y", neutral: "Y" },
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
    features: { women: "Y", men: "Y", accessible: "Y", neutral: "N" },
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
      neutral: toFeatureFlag(record.all_gender)
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
      neutral: row.neutral
    },
    hours: {
      today: formatDayHours(openingTimes, todayDayIndex),
      sat: formatDayHours(openingTimes, 5),
      sun: formatDayHours(openingTimes, 6)
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

async function createSqliteDatabase({ dbFilePath, seedCsvPath }) {
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
      opening_times TEXT NOT NULL DEFAULT '[]'
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

  const toiletCount = Number(db.prepare("SELECT COUNT(*) AS count FROM toilets").get()?.count ?? 0);

  if (toiletCount === 0) {
    const toiletsToSeed = await loadSeedToilets(seedCsvPath);
    const insertToilet = db.prepare(`
      INSERT INTO toilets (
        id, name, area, lat, lng, paid, comment,
        women, men, accessible, neutral, opening_times
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            opening_times
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

async function createPostgresDatabase({ connectionString, seedCsvPath }) {
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
      opening_times JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);

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
            women, men, accessible, neutral, opening_times
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
          opening_times
        FROM toilets
        ${whereClause}
        `,
        params
      );

      return result.rows.map(mapRowToToilet);
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
  databaseUrl = process.env.WHERETOI_DATABASE_URL
} = {}) {
  const resolvedSeedCsvPath =
    resolvePath(rootDirectory, seedCsvPath) ?? resolve(rootDirectory, "src", "data", "toilets.csv");

  if (databaseUrl) {
    return createPostgresDatabase({
      connectionString: databaseUrl,
      seedCsvPath: resolvedSeedCsvPath
    });
  }

  const resolvedDbFilePath =
    resolvePath(rootDirectory, dbFilePath) ?? resolve(rootDirectory, "data", "wheretoi.sqlite");

  return createSqliteDatabase({
    dbFilePath: resolvedDbFilePath,
    seedCsvPath: resolvedSeedCsvPath
  });
}
