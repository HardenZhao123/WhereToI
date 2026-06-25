import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scrypt, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mapRowToToilet } from "../mapper/toilet-mapper.mjs";
import { applySqliteToiletMigrations } from "../migration/toilet-schema-migration.mjs";
import { loadSeedToilets } from "../seed/toilet-seed-loader.mjs";
import {
  ANONYMOUS_COMMENT_AUTHOR,
  CLEANLINESS_RATING_COOLDOWN_MS,
  createCleanlinessRatingCooldownError,
  createDuplicateToiletError,
  distanceInMetres,
  getCoordinateBounds,
  mapAccessHistoryRow,
  mapAccountRow,
  mapCleanlinessSurveyResponse,
  mapCommentRow,
  getCleanlinessRangeStartDate,
  isConfiguredAdminUser,
  normaliseAccessPayload,
  normaliseBounds,
  normaliseCleanlinessSurveyPayload,
  normaliseCommentDeletePayload,
  normaliseCommentLikePayload,
  normaliseCommentPayload,
  normaliseCommentProfileVisibility,
  normaliseToiletContributionPayload,
  normaliseHistoryLimit,
  normaliseSearchQuery,
  normaliseToiletReportAction,
  normaliseToiletReportPayload,
  normaliseToiletReportStatus,
  normaliseToiletSubmissionStatus,
  normaliseUserId,
  TOILET_DUPLICATE_RADIUS_METRES,
  toCleanlinessUpdate
} from "./repository-utils.mjs";

const scryptAsync = promisify(scrypt);

const LEGACY_DEMO_ACCESS_HISTORY_NAMES = [
  "city & guilds building",
  "imperial library",
  "museum quater",
  "museum quarter",
  "south kensington station",
  "southkensington station"
];

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, hash) {
  const [salt, key] = hash.split(":");
  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return timingSafeEqual(keyBuffer, derivedKey);
}

async function isBuiltInDemoUser(user) {
  if (user?.username !== "demo" || user?.email !== "demo@example.com") {
    return false;
  }

  try {
    return await verifyPassword("demo123", user.password_hash);
  } catch {
    return false;
  }
}

async function removeBuiltInDemoUser(db) {
  const demoUser = db.prepare(
    "SELECT id, username, email, password_hash FROM users WHERE username = ?"
  ).get("demo");

  if (!(await isBuiltInDemoUser(demoUser))) {
    return;
  }

  const affectedToiletIds = db.prepare(
    "SELECT DISTINCT toilet_id FROM cleanliness_surveys WHERE user_id = ?"
  ).all(demoUser.id).map((row) => row.toilet_id);

  db.exec("BEGIN;");
  try {
    db.prepare(
      "DELETE FROM comment_likes WHERE user_id = ? OR comment_id IN (SELECT id FROM toilet_comments WHERE user_id = ?)"
    ).run(demoUser.id, demoUser.id);
    db.prepare(
      "DELETE FROM comment_dislikes WHERE user_id = ? OR comment_id IN (SELECT id FROM toilet_comments WHERE user_id = ?)"
    ).run(demoUser.id, demoUser.id);
    db.prepare("DELETE FROM toilet_comments WHERE user_id = ?").run(demoUser.id);
    db.prepare("DELETE FROM cleanliness_surveys WHERE user_id = ?").run(demoUser.id);
    db.prepare("DELETE FROM access_history WHERE user_id = ?").run(demoUser.id);
    db.prepare("DELETE FROM app_account WHERE user_id = ?").run(demoUser.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(demoUser.id);

    const recalculateToilet = db.prepare(`
      UPDATE toilets
      SET
        cleanliness = COALESCE(
          (SELECT AVG(rating) FROM cleanliness_surveys WHERE toilet_id = ?),
          3
        ),
        cleanliness_rating_total = COALESCE(
          (SELECT SUM(rating) FROM cleanliness_surveys WHERE toilet_id = ?),
          0
        ),
        cleanliness_rating_count = (
          SELECT COUNT(*) FROM cleanliness_surveys WHERE toilet_id = ?
        ),
        cleanliness_rating_sum_squares = COALESCE(
          (SELECT SUM(rating * rating) FROM cleanliness_surveys WHERE toilet_id = ?),
          0
        ),
        bias = 0
      WHERE id = ?
    `);
    for (const toiletId of affectedToiletIds) {
      recalculateToilet.run(toiletId, toiletId, toiletId, toiletId, toiletId);
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function mapUserRow(row, { includePasswordHash = false } = {}) {
  if (!row) return null;

  const user = {
    id: row.id,
    username: row.username,
    email: row.email,
    gender: row.gender ?? null,
    preferences: row.preferences ?? "[]",
    rating_total: row.rating_total ?? 0,
    rating_count: row.rating_count ?? 0,
    rating_sum_squares: row.rating_sum_squares ?? 0,
    bias: row.bias ?? 0.0,
    isAdmin: Boolean(row.is_admin)
  };

  if (includePasswordHash) {
    user.password_hash = row.password_hash;
  }

  return user;
}

function mapToiletSubmissionRow(row) {
  if (!row) return null;

  const toilet = mapRowToToilet(row);
  return {
    ...toilet,
    submissionStatus: row.submission_status ?? "approved",
    submittedByUserId: row.submitted_by_user_id ?? null,
    submittedByUsername: row.submitted_by_username ?? null,
    submittedAt: row.submitted_at ?? null,
    reviewedByUserId: row.reviewed_by_user_id ?? null,
    reviewedByUsername: row.reviewed_by_username ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? ""
  };
}

function parseStoredJson(value, fallback) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapToiletReportRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    toiletId: row.toilet_id ?? null,
    toiletName: row.toilet_name,
    toiletArea: row.toilet_area,
    currentLocation:
      row.current_lat !== null &&
      row.current_lat !== undefined &&
      row.current_lng !== null &&
      row.current_lng !== undefined &&
      Number.isFinite(Number(row.current_lat)) && Number.isFinite(Number(row.current_lng))
        ? { lat: Number(row.current_lat), lng: Number(row.current_lng) }
        : null,
    issueTypes: parseStoredJson(row.issue_types, []),
    toiletExists: row.toilet_exists ?? "unsure",
    details: row.details ?? "",
    proposedChanges: parseStoredJson(row.proposed_changes, {}),
    status: row.status ?? "pending",
    reportedByUserId: row.reported_by_user_id ?? null,
    reportedByUsername: row.reported_by_username ?? null,
    createdAt: row.created_at ?? null,
    reviewedByUserId: row.reviewed_by_user_id ?? null,
    reviewedByUsername: row.reviewed_by_username ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewAction: row.review_action ?? null,
    reviewNote: row.review_note ?? ""
  };
}

export async function createSqliteDatabase({
  dbFilePath,
  seedCsvPath,
  cleanlinessScoringModel,
  enableDemoAccount = false
}) {
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
      submission_status TEXT NOT NULL DEFAULT 'approved',
      submitted_by_user_id INTEGER,
      submitted_at TEXT,
      reviewed_by_user_id INTEGER,
      reviewed_at TEXT,
      review_note TEXT,
      cleanliness REAL NOT NULL DEFAULT 3,
      cleanliness_yes_count INTEGER NOT NULL DEFAULT 0,
      cleanliness_no_count INTEGER NOT NULL DEFAULT 0,
      cleanliness_rating_total REAL NOT NULL DEFAULT 0,
      cleanliness_rating_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      gender TEXT,
      preferences TEXT,
      rating_total REAL NOT NULL DEFAULT 0,
      rating_count INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS app_account (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      wallet_balance_gbp REAL NOT NULL,
      subscription_name TEXT NOT NULL,
      subscription_renews_on TEXT NOT NULL,
      monthly_free_tickets_left INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS access_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      toilet_id TEXT,
      toilet_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount_gbp REAL NOT NULL,
      access_time TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE SET NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS toilet_comments (
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
      scene_snapshot TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS cleanliness_surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      toilet_id TEXT NOT NULL,
      user_id INTEGER,
      rating REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (toilet_id) REFERENCES toilets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_toilet_id ON cleanliness_surveys(toilet_id);
    CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_created_at ON cleanliness_surveys(created_at);
    CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_created_at_toilet_id ON cleanliness_surveys(created_at, toilet_id, rating);

    CREATE TABLE IF NOT EXISTS comment_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (comment_id, user_id),
      FOREIGN KEY (comment_id) REFERENCES toilet_comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS comment_dislikes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (comment_id, user_id),
      FOREIGN KEY (comment_id) REFERENCES toilet_comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_access_history_access_time
    ON access_history(access_time DESC);

    CREATE INDEX IF NOT EXISTS idx_toilet_comments_toilet_id
    ON toilet_comments(toilet_id);

    CREATE INDEX IF NOT EXISTS idx_toilet_comments_toilet_created_id
    ON toilet_comments(toilet_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_toilet_comments_user_id
    ON toilet_comments(user_id);

    CREATE INDEX IF NOT EXISTS idx_toilet_comments_user_created_id
    ON toilet_comments(user_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_toilet_comments_public_profile
    ON toilet_comments(user_id, created_at DESC, id DESC)
    WHERE comment_visibility = 'real' AND profile_visibility = 'public';

    CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id
    ON comment_likes(comment_id);

    CREATE INDEX IF NOT EXISTS idx_comment_dislikes_comment_id
    ON comment_dislikes(comment_id);

    CREATE INDEX IF NOT EXISTS idx_cleanliness_surveys_toilet_user_created_id
    ON cleanliness_surveys(toilet_id, user_id, created_at DESC, id DESC);
  `);

  await applySqliteToiletMigrations({ db, seedCsvPath });

  // Now that migrations have run and user_id columns are guaranteed to exist, we can create user indices
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_app_account_user_id
    ON app_account(user_id);
  `);

  const toiletCount = Number(db.prepare("SELECT COUNT(*) AS count FROM toilets").get()?.count ?? 0);

  if (toiletCount === 0) {
    const toiletsToSeed = await loadSeedToilets(seedCsvPath);
    const insertToilet = db.prepare(`
      INSERT INTO toilets (
        id, name, area, lat, lng, paid, comment,
        women, men, accessible, neutral, children, baby_changing, bidet,
        automatic, urinal_only, radar_key, free_access, opening_times, cleanliness
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          JSON.stringify(toilet.openingTimes ?? []),
          toilet.cleanliness
        );
      }
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }

  let demoUserId = null;

  if (enableDemoAccount) {
    const existingDemo = db.prepare("SELECT id FROM users WHERE username = ?").get("demo");
    demoUserId = existingDemo?.id ?? null;

    if (!demoUserId) {
      db.prepare(
        "INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)"
      ).run("demo", await hashPassword("demo123"), "demo@example.com", 1);
      demoUserId = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);

      db.prepare(
        `
        INSERT INTO app_account (
          user_id,
          wallet_balance_gbp,
          subscription_name,
          subscription_renews_on,
          monthly_free_tickets_left
        ) VALUES (?, ?, ?, ?, ?)
        `
      ).run(demoUserId, 8.4, "Campus Plus", "2026-06-26", 3);
    } else {
      db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(demoUserId);
    }

    const placeholders = LEGACY_DEMO_ACCESS_HISTORY_NAMES.map(() => "?").join(", ");
    db.prepare(
      `
      DELETE FROM access_history
      WHERE user_id = ?
        AND toilet_id IS NULL
        AND LOWER(TRIM(toilet_name)) IN (${placeholders})
      `
    ).run(demoUserId, ...LEGACY_DEMO_ACCESS_HISTORY_NAMES);
  } else {
    await removeBuiltInDemoUser(db);
  }

  const adminIdentifiers = Array.from(
    new Set(
      String(process.env.WHERETOI_ADMIN_USERNAMES ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  if (adminIdentifiers.length > 0) {
    const markAdmin = db.prepare("UPDATE users SET is_admin = 1 WHERE LOWER(username) = ? OR LOWER(COALESCE(email, '')) = ?");
    for (const identifier of adminIdentifiers) {
      markAdmin.run(identifier, identifier);
    }
  }

  function toggleCommentReaction({ toiletId, commentId, userId, reactionTable, oppositeTable }) {
    const comment = normaliseCommentLikePayload({ toiletId, commentId });
    const existingComment = db
      .prepare("SELECT id FROM toilet_comments WHERE id = ? AND toilet_id = ?")
      .get(comment.commentId, comment.toiletId);

    if (!existingComment) {
      return { found: false, active: false, toiletId: comment.toiletId };
    }

    const existingReaction = db
      .prepare(`SELECT id FROM ${reactionTable} WHERE comment_id = ? AND user_id = ?`)
      .get(comment.commentId, userId);

    if (existingReaction) {
      db.prepare(`DELETE FROM ${reactionTable} WHERE id = ?`).run(existingReaction.id);
      return { found: true, active: false, toiletId: comment.toiletId };
    }

    db.exec("BEGIN;");
    try {
      db.prepare(`DELETE FROM ${oppositeTable} WHERE comment_id = ? AND user_id = ?`)
        .run(comment.commentId, userId);
      db.prepare(
        `INSERT INTO ${reactionTable} (comment_id, user_id, created_at) VALUES (?, ?, ?)`
      ).run(comment.commentId, userId, new Date().toISOString());
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }

    return { found: true, active: true, toiletId: comment.toiletId };
  }

  function findDuplicateToilet(toilet) {
    const bounds = getCoordinateBounds(toilet.lat, toilet.lng);
    const candidates = db
      .prepare(
        `
        SELECT id, name, area, lat, lng
        FROM toilets
        WHERE lat >= ? AND lat <= ?
          AND lng >= ? AND lng <= ?
          AND submission_status != 'rejected'
        `
      )
      .all(bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng);

    return candidates.reduce((closest, candidate) => {
      const distanceMetres = distanceInMetres(toilet.lat, toilet.lng, candidate.lat, candidate.lng);
      if (distanceMetres > TOILET_DUPLICATE_RADIUS_METRES) return closest;
      if (closest && closest.distanceMetres <= distanceMetres) return closest;
      return {
        toilet: {
          id: candidate.id,
          name: candidate.name,
          area: candidate.area,
          lat: Number(candidate.lat),
          lng: Number(candidate.lng)
        },
        distanceMetres
      };
    }, null);
  }

  return {
    backend: "sqlite",
    async close() {
      db.close();
    },
    async createUser({ username, password, email }) {
      const passwordHash = await hashPassword(password);
      const isAdmin = isConfiguredAdminUser({ username, email }) ? 1 : 0;
      db.exec("BEGIN;");
      try {
        db.prepare(
          "INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)"
        ).run(username, passwordHash, email, isAdmin);
        const userId = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);

        // Every user gets a default account
        db.prepare(
          `
          INSERT INTO app_account (
            user_id,
            wallet_balance_gbp,
            subscription_name,
            subscription_renews_on,
            monthly_free_tickets_left
          ) VALUES (?, ?, ?, ?, ?)
          `
        ).run(userId, 5.0, "Standard", new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), 0);

        db.exec("COMMIT;");
        return { id: userId, username, email, isAdmin: Boolean(isAdmin) };
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    },
    async getUserByUsername(username) {
      return mapUserRow(
        db.prepare("SELECT id, username, password_hash, email, gender, preferences, rating_total, rating_count, rating_sum_squares, bias, is_admin FROM users WHERE username = ?").get(username),
        { includePasswordHash: true }
      );
    },
    async getUserById(userId) {
      return mapUserRow(
        db.prepare("SELECT id, username, email, gender, preferences, rating_total, rating_count, rating_sum_squares, bias, is_admin FROM users WHERE id = ?").get(userId)
      );
    },
    async getToiletById(toiletId, { cleanlinessRange = "all" } = {}) {
      const startDate = getCleanlinessRangeStartDate(cleanlinessRange);
      const isAllTime = startDate === null;
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
            WHERE toilet_id = ? AND created_at >= ?
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
      const params = isAllTime ? [toiletId] : [toiletId, startDate, toiletId];

      const row = db.prepare(
        `
        ${recentCleanlinessCte}
        SELECT
          t.id, t.name, t.area, t.lat, t.lng, t.paid, t.comment,
          t.women, t.men, t.accessible, t.neutral, t.children, t.baby_changing, t.bidet,
          t.automatic, t.urinal_only, t.radar_key, t.free_access, t.opening_times,
          ${cleanlinessColumns}
        FROM toilets t
        ${joinClause}
        WHERE t.id = ?
          AND t.submission_status = 'approved'
        `
      ).get(...params);

      return row ? mapRowToToilet(row) : null;
    },
    async getToiletSubmissionById(toiletId) {
      const safeToiletId = String(toiletId ?? "").trim();
      if (!safeToiletId) return null;

      const row = db.prepare(
        `
        SELECT
          t.id, t.name, t.area, t.lat, t.lng, t.paid, t.comment,
          t.women, t.men, t.accessible, t.neutral, t.children, t.baby_changing, t.bidet,
          t.automatic, t.urinal_only, t.radar_key, t.free_access, t.opening_times,
          t.submission_status, t.submitted_by_user_id, t.submitted_at,
          t.reviewed_by_user_id, t.reviewed_at, t.review_note,
          t.cleanliness AS cleanliness, t.cleanliness_yes_count, t.cleanliness_no_count,
          t.cleanliness_rating_total AS cleanliness_rating_total,
          t.cleanliness_rating_count AS cleanliness_rating_count,
          submitter.username AS submitted_by_username,
          reviewer.username AS reviewed_by_username
        FROM toilets t
        LEFT JOIN users submitter ON submitter.id = t.submitted_by_user_id
        LEFT JOIN users reviewer ON reviewer.id = t.reviewed_by_user_id
        WHERE t.id = ?
        LIMIT 1
        `
      ).get(safeToiletId);

      return mapToiletSubmissionRow(row);
    },
    async getToiletSubmissions({ status = "pending" } = {}) {
      const safeStatus = status === "all" ? "all" : normaliseToiletSubmissionStatus(status, "pending");
      const params = [];
      const statusClause = safeStatus === "all" ? "" : "AND t.submission_status = ?";
      if (safeStatus !== "all") {
        params.push(safeStatus);
      }

      const rows = db.prepare(
        `
        SELECT
          t.id, t.name, t.area, t.lat, t.lng, t.paid, t.comment,
          t.women, t.men, t.accessible, t.neutral, t.children, t.baby_changing, t.bidet,
          t.automatic, t.urinal_only, t.radar_key, t.free_access, t.opening_times,
          t.submission_status, t.submitted_by_user_id, t.submitted_at,
          t.reviewed_by_user_id, t.reviewed_at, t.review_note,
          t.cleanliness AS cleanliness, t.cleanliness_yes_count, t.cleanliness_no_count,
          t.cleanliness_rating_total AS cleanliness_rating_total,
          t.cleanliness_rating_count AS cleanliness_rating_count,
          submitter.username AS submitted_by_username,
          reviewer.username AS reviewed_by_username
        FROM toilets t
        LEFT JOIN users submitter ON submitter.id = t.submitted_by_user_id
        LEFT JOIN users reviewer ON reviewer.id = t.reviewed_by_user_id
        WHERE (t.submitted_by_user_id IS NOT NULL OR t.id LIKE 'user-%')
          ${statusClause}
        ORDER BY COALESCE(t.submitted_at, '') DESC, t.id DESC
        LIMIT 200
        `
      ).all(...params);

      return rows.map(mapToiletSubmissionRow);
    },
    async reviewToiletSubmission({ toiletId, reviewerUserId, status, reviewNote = "" }) {
      const safeToiletId = String(toiletId ?? "").trim();
      if (!safeToiletId) {
        throw new Error("toiletId is required.");
      }

      const safeStatus = normaliseToiletSubmissionStatus(status);
      if (safeStatus === "pending") {
        throw new Error("submission status must be approved or rejected.");
      }

      const reviewedAt = new Date().toISOString();
      const result = db.prepare(
        `
        UPDATE toilets
        SET submission_status = ?,
            reviewed_by_user_id = ?,
            reviewed_at = ?,
            review_note = ?
        WHERE id = ?
          AND (submitted_by_user_id IS NOT NULL OR id LIKE 'user-%')
        `
      ).run(
        safeStatus,
        reviewerUserId ?? null,
        reviewedAt,
        String(reviewNote ?? "").slice(0, 600),
        safeToiletId
      );

      if (result.changes === 0) return null;
      return this.getToiletSubmissionById(safeToiletId);
    },
    async createToiletContribution(payload) {
      const toilet = normaliseToiletContributionPayload(payload);
      const duplicate = findDuplicateToilet(toilet);
      if (duplicate) {
        throw createDuplicateToiletError(duplicate.toilet, duplicate.distanceMetres);
      }

      const toiletId = `user-${randomUUID()}`;
      const submittedAt = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO toilets (
          id, name, area, lat, lng, paid, comment,
          women, men, accessible, neutral, children, baby_changing, bidet,
          automatic, urinal_only, radar_key, free_access, opening_times,
          submission_status, submitted_by_user_id, submitted_at, cleanliness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        toiletId,
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
        JSON.stringify(toilet.openingTimes),
        "pending",
        payload.userId ?? null,
        submittedAt,
        toilet.cleanliness
      );

      return this.getToiletSubmissionById(toiletId);
    },
    async createToiletReport(payload) {
      const report = normaliseToiletReportPayload(payload);
      const toilet = db.prepare(
        "SELECT id, name, area FROM toilets WHERE id = ? AND submission_status = 'approved'"
      ).get(report.toiletId);
      if (!toilet) {
        const error = new Error("Toilet not found.");
        error.statusCode = 404;
        throw error;
      }

      const existing = db.prepare(
        `
        SELECT id
        FROM toilet_reports
        WHERE toilet_id = ? AND reported_by_user_id = ? AND status = 'pending'
        LIMIT 1
        `
      ).get(report.toiletId, payload.userId ?? null);
      if (existing) {
        const error = new Error("You already have a pending report for this toilet.");
        error.statusCode = 409;
        throw error;
      }

      const createdAt = new Date().toISOString();
      const result = db.prepare(
        `
        INSERT INTO toilet_reports (
          toilet_id, toilet_name, toilet_area, reported_by_user_id,
          issue_types, toilet_exists, details, proposed_changes, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `
      ).run(
        toilet.id,
        toilet.name,
        toilet.area,
        payload.userId ?? null,
        JSON.stringify(report.issueTypes),
        report.toiletExists,
        report.details,
        JSON.stringify(report.proposedChanges),
        createdAt
      );

      return this.getToiletReportById(Number(result.lastInsertRowid));
    },
    async getToiletReportById(reportId) {
      const safeReportId = Number(reportId);
      if (!Number.isInteger(safeReportId) || safeReportId <= 0) return null;

      const row = db.prepare(
        `
        SELECT
          r.*,
          t.lat AS current_lat,
          t.lng AS current_lng,
          reporter.username AS reported_by_username,
          reviewer.username AS reviewed_by_username
        FROM toilet_reports r
        LEFT JOIN toilets t ON t.id = r.toilet_id
        LEFT JOIN users reporter ON reporter.id = r.reported_by_user_id
        LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by_user_id
        WHERE r.id = ?
        LIMIT 1
        `
      ).get(safeReportId);
      return mapToiletReportRow(row);
    },
    async getToiletReports({ status = "pending" } = {}) {
      const safeStatus = status === "all" ? "all" : normaliseToiletReportStatus(status, "pending");
      const rows = db.prepare(
        `
        SELECT
          r.*,
          t.lat AS current_lat,
          t.lng AS current_lng,
          reporter.username AS reported_by_username,
          reviewer.username AS reviewed_by_username
        FROM toilet_reports r
        LEFT JOIN toilets t ON t.id = r.toilet_id
        LEFT JOIN users reporter ON reporter.id = r.reported_by_user_id
        LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by_user_id
        ${safeStatus === "all" ? "" : "WHERE r.status = ?"}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 200
        `
      ).all(...(safeStatus === "all" ? [] : [safeStatus]));
      return rows.map(mapToiletReportRow);
    },
    async reviewToiletReport({ reportId, reviewerUserId, action, reviewNote = "" }) {
      const safeReportId = Number(reportId);
      if (!Number.isInteger(safeReportId) || safeReportId <= 0) {
        throw new Error("reportId is required.");
      }
      const safeAction = normaliseToiletReportAction(action);
      const report = db.prepare(
        "SELECT * FROM toilet_reports WHERE id = ? AND status = 'pending'"
      ).get(safeReportId);
      if (!report) return null;

      const proposedChanges = parseStoredJson(report.proposed_changes, {});
      const reviewedAt = new Date().toISOString();
      const nextStatus = safeAction === "apply" ? "applied" : safeAction === "remove" ? "removed" : "rejected";

      db.exec("BEGIN;");
      try {
        if (safeAction === "apply") {
          const toilet = db.prepare("SELECT * FROM toilets WHERE id = ?").get(report.toilet_id);
          if (!toilet) {
            const error = new Error("Toilet not found.");
            error.statusCode = 404;
            throw error;
          }
          const features = proposedChanges.features ?? {};
          const openingTimes = Array.isArray(proposedChanges.openingTimes)
            ? proposedChanges.openingTimes
            : parseStoredJson(toilet.opening_times, []);
          const freeAccess = features.free ?? toilet.free_access;
          db.prepare(
            `
            UPDATE toilets
            SET lat = ?, lng = ?, paid = ?,
                women = ?, men = ?, accessible = ?, neutral = ?, children = ?,
                baby_changing = ?, bidet = ?, automatic = ?, urinal_only = ?,
                radar_key = ?, free_access = ?, opening_times = ?
            WHERE id = ?
            `
          ).run(
            proposedChanges.lat ?? toilet.lat,
            proposedChanges.lng ?? toilet.lng,
            freeAccess === "N" ? 1 : 0,
            features.women ?? toilet.women,
            features.men ?? toilet.men,
            features.accessible ?? toilet.accessible,
            features.neutral ?? toilet.neutral,
            features.children ?? toilet.children,
            features.babyChanging ?? toilet.baby_changing,
            features.bidet ?? toilet.bidet,
            features.automatic ?? toilet.automatic,
            features.urinalOnly ?? toilet.urinal_only,
            features.radarKey ?? toilet.radar_key,
            freeAccess,
            JSON.stringify(openingTimes),
            toilet.id
          );
        } else if (safeAction === "remove") {
          db.prepare("DELETE FROM toilets WHERE id = ?").run(report.toilet_id);
        }

        db.prepare(
          `
          UPDATE toilet_reports
          SET status = ?, reviewed_by_user_id = ?, reviewed_at = ?,
              review_action = ?, review_note = ?
          WHERE id = ?
          `
        ).run(
          nextStatus,
          reviewerUserId ?? null,
          reviewedAt,
          safeAction,
          String(reviewNote ?? "").slice(0, 600),
          safeReportId
        );
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }

      return this.getToiletReportById(safeReportId);
    },
    async updateUserProfile(userId, { gender, preferences }) {
      db.prepare(
        "UPDATE users SET gender = ?, preferences = ? WHERE id = ?"
      ).run(gender, JSON.stringify(preferences), userId);
      return this.getUserById(userId);
    },
    async verifyUserPassword(username, password) {
      const user = await this.getUserByUsername(username);
      if (!user) return null;
      if (await verifyPassword(password, user.password_hash)) {
        const { password_hash, ...rest } = user;
        return rest;
      }
      return null;
    },
    async getToilets({ search = "", accessibleOnly = false, cleanlinessRange = "all", bounds = null } = {}) {
      const query = normaliseSearchQuery(search);
      const safeBounds = normaliseBounds(bounds);
      const startDate = getCleanlinessRangeStartDate(cleanlinessRange);
      const isAllTime = startDate === null;
      const params = [];
      const conditions = [];

      conditions.push("t.submission_status = 'approved'");

      if (accessibleOnly) {
        conditions.push("t.accessible = 'Y'");
      }

      if (query) {
        params.push(`%${query}%`);
        conditions.push(`(LOWER(t.name) LIKE ? OR LOWER(t.area) LIKE ?)`);
        params.push(`%${query}%`);
      }

      if (safeBounds) {
        conditions.push("t.lat >= ? AND t.lat <= ?");
        params.push(safeBounds.minLat, safeBounds.maxLat);
        conditions.push("t.lng >= ? AND t.lng <= ?");
        params.push(safeBounds.minLng, safeBounds.maxLng);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
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
            WHERE created_at >= ?
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
      const queryParams = isAllTime ? params : [startDate, ...params];

      const rows = db
        .prepare(
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
          LIMIT 2000
          `
        )
        .all(...queryParams);

      return rows.map(mapRowToToilet);
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
        const userRow = db.prepare("SELECT rating_total, rating_count, rating_sum_squares, bias FROM users WHERE id = ?").get(userId);
        if (userRow) {
          userAverageRating = userRow.rating_count > 0 ? userRow.rating_total / userRow.rating_count : 3;
          userBias = Number(userRow.bias ?? 0.0);
          
          if (userRow.rating_count > 1) {
            const variance = (userRow.rating_sum_squares / userRow.rating_count) - (userAverageRating * userAverageRating);
            userStandardDeviation = Math.sqrt(Math.max(variance, 0));
          }
        }
      }

      const row = safeToiletId
        ? db
            .prepare("SELECT id, name, cleanliness, cleanliness_yes_count, cleanliness_no_count, cleanliness_rating_total, cleanliness_rating_count, cleanliness_rating_sum_squares, bias FROM toilets WHERE id = ?")
            .get(safeToiletId)
        : db
            .prepare(
              `
              SELECT id, name, cleanliness, cleanliness_yes_count, cleanliness_no_count, cleanliness_rating_total, cleanliness_rating_count, cleanliness_rating_sum_squares, bias
              FROM toilets
              WHERE LOWER(name) = LOWER(?)
              LIMIT 1
              `
            )
            .get(safeToiletName);

      if (!row) {
        throw new Error("toilet not found.");
      }

      const now = new Date();
      if (userId) {
        const latestSurvey = db
          .prepare(
            `
            SELECT created_at
            FROM cleanliness_surveys
            WHERE toilet_id = ? AND user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            `
          )
          .get(row.id, userId);
        const latestSurveyTime = Date.parse(latestSurvey?.created_at ?? "");
        if (
          Number.isFinite(latestSurveyTime) &&
          now.getTime() - latestSurveyTime < CLEANLINESS_RATING_COOLDOWN_MS
        ) {
          throw createCleanlinessRatingCooldownError(latestSurvey.created_at, now.getTime());
        }
      }

      const globalStats = db.prepare("SELECT SUM(rating_total) AS total, SUM(rating_count) AS count, SUM(rating_sum_squares) AS sum_squares FROM users").get();
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
        db.prepare("UPDATE users SET rating_total = rating_total + ?, rating_count = rating_count + 1, rating_sum_squares = rating_sum_squares + ?, bias = ? WHERE id = ?")
          .run(safeRating, safeRating * safeRating, newUserBias ?? userBias, userId);
      }

      db.prepare(
        `
        UPDATE toilets
        SET cleanliness = ?, cleanliness_rating_total = ?, cleanliness_rating_count = ?, cleanliness_rating_sum_squares = ?, bias = ?
        WHERE id = ?
        `
      ).run(cleanliness, ratingTotal, ratingCount, ratingSumSquares, newToiletBias ?? row.bias ?? 0.0, row.id);

      db.prepare(
        "INSERT INTO cleanliness_surveys (toilet_id, user_id, rating, created_at) VALUES (?, ?, ?, ?)"
      ).run(row.id, userId, safeRating, now.toISOString());

      return mapCleanlinessSurveyResponse({
        row,
        cleanliness,
        ratingTotal,
        ratingCount,
        cleanlinessScoringModel
      });
    },
    async getAccount(userId) {
      const row = db
        .prepare(
          `
          SELECT
            wallet_balance_gbp,
            subscription_name,
            subscription_renews_on,
            monthly_free_tickets_left
          FROM app_account
          WHERE user_id = ?
          `
        )
        .get(userId);

      return mapAccountRow(row);
    },
    async getAccessHistory(userId, limit = 10) {
      const safeLimit = normaliseHistoryLimit(limit);
      const rows = db
        .prepare(
          `
        SELECT
          access_history.id,
          access_history.toilet_id,
          COALESCE(toilets.name, access_history.toilet_name) AS toilet_name,
          access_history.event_type,
          access_history.amount_gbp,
          access_history.access_time
        FROM access_history
        LEFT JOIN toilets ON toilets.id = access_history.toilet_id
        WHERE access_history.user_id = ?
        ORDER BY access_history.access_time DESC
        LIMIT ?
          `
        )
        .all(userId, safeLimit);

      return rows.map(mapAccessHistoryRow);
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

      const insert = db.prepare(
        `
        INSERT INTO access_history (user_id, toilet_id, toilet_name, event_type, amount_gbp, access_time)
        VALUES (?, ?, ?, ?, ?, ?)
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
        WHERE user_id = ?
        `
      );

      const nowIso = new Date().toISOString();

      db.exec("BEGIN;");
      try {
        insert.run(userId, toiletId, safeToiletName, safeEventType, safeAmount, nowIso);
        updateAccount.run(safeAmount, shouldUseFreeTicket ? 1 : 0, userId);
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }

      return {
        account: await this.getAccount(userId),
        history: await this.getAccessHistory(userId, 10)
      };
    },
    async getComments(toiletId, { viewerUserId = null } = {}) {
      if (!toiletId) return [];

      return db
        .prepare(
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
            media_url,
            media_attachments,
            scene_snapshot,
            created_at,
            (
              SELECT COUNT(*)
              FROM comment_likes
              WHERE comment_likes.comment_id = toilet_comments.id
            ) AS like_count,
            EXISTS (
              SELECT 1
              FROM comment_likes
              WHERE comment_likes.comment_id = toilet_comments.id
                AND comment_likes.user_id = ?
            ) AS viewer_has_liked,
            (
              SELECT COUNT(*)
              FROM comment_dislikes
              WHERE comment_dislikes.comment_id = toilet_comments.id
            ) AS dislike_count,
            EXISTS (
              SELECT 1
              FROM comment_dislikes
              WHERE comment_dislikes.comment_id = toilet_comments.id
                AND comment_dislikes.user_id = ?
            ) AS viewer_has_disliked
          FROM toilet_comments
          WHERE toilet_id = ?
          ORDER BY created_at DESC, id DESC
          `
        )
        .all(viewerUserId, viewerUserId, toiletId)
        .map((row) => mapCommentRow(row, { viewerUserId }));
    },
    async getUserComments(userId, limit = 30) {
      const safeLimit = normaliseHistoryLimit(limit);

      return db
        .prepare(
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
            toilet_comments.media_url,
            toilet_comments.media_attachments,
            toilet_comments.scene_snapshot,
            toilet_comments.created_at,
            toilets.name AS toilet_name,
            toilets.area AS toilet_area,
            (
              SELECT COUNT(*)
              FROM comment_likes
              WHERE comment_likes.comment_id = toilet_comments.id
            ) AS like_count,
            EXISTS (
              SELECT 1
              FROM comment_likes
              WHERE comment_likes.comment_id = toilet_comments.id
                AND comment_likes.user_id = ?
            ) AS viewer_has_liked,
            (
              SELECT COUNT(*)
              FROM comment_dislikes
              WHERE comment_dislikes.comment_id = toilet_comments.id
            ) AS dislike_count,
            EXISTS (
              SELECT 1
              FROM comment_dislikes
              WHERE comment_dislikes.comment_id = toilet_comments.id
                AND comment_dislikes.user_id = ?
            ) AS viewer_has_disliked
          FROM toilet_comments
          LEFT JOIN toilets ON toilets.id = toilet_comments.toilet_id
          WHERE toilet_comments.user_id = ?
          ORDER BY toilet_comments.created_at DESC, toilet_comments.id DESC
          LIMIT ?
          `
        )
        .all(userId, userId, userId, safeLimit)
        .map((row) => mapCommentRow(row, { viewerUserId: userId }));
    },
    async getPublicProfile(userId, { viewerUserId = null, limit = 30 } = {}) {
      const safeUserId = normaliseUserId(userId);
      const safeLimit = normaliseHistoryLimit(limit);
      const user = db
        .prepare("SELECT id, username FROM users WHERE id = ?")
        .get(safeUserId);

      if (!user) return null;

      const comments = db
        .prepare(
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
            toilet_comments.media_url,
            toilet_comments.media_attachments,
            toilet_comments.scene_snapshot,
            toilet_comments.created_at,
            toilets.name AS toilet_name,
            toilets.area AS toilet_area,
            (
              SELECT COUNT(*)
              FROM comment_likes
              WHERE comment_likes.comment_id = toilet_comments.id
            ) AS like_count,
            EXISTS (
              SELECT 1
              FROM comment_likes
              WHERE comment_likes.comment_id = toilet_comments.id
                AND comment_likes.user_id = ?
            ) AS viewer_has_liked,
            (
              SELECT COUNT(*)
              FROM comment_dislikes
              WHERE comment_dislikes.comment_id = toilet_comments.id
            ) AS dislike_count,
            EXISTS (
              SELECT 1
              FROM comment_dislikes
              WHERE comment_dislikes.comment_id = toilet_comments.id
                AND comment_dislikes.user_id = ?
            ) AS viewer_has_disliked
          FROM toilet_comments
          LEFT JOIN toilets ON toilets.id = toilet_comments.toilet_id
          WHERE toilet_comments.user_id = ?
            AND toilet_comments.comment_visibility = 'real'
            AND toilet_comments.profile_visibility = 'public'
          ORDER BY toilet_comments.created_at DESC, toilet_comments.id DESC
          LIMIT ?
          `
        )
        .all(viewerUserId, viewerUserId, safeUserId, safeLimit)
        .map((row) => mapCommentRow(row, { viewerUserId }));

      return {
        user: {
          id: user.id,
          username: user.username
        },
        comments
      };
    },
    async saveComment({ toiletId, userId, username, commentText, media, commentVisibility, cleanlinessRating, sceneSnapshot }) {
      const comment = normaliseCommentPayload({ toiletId, commentText, media, commentVisibility, cleanlinessRating, sceneSnapshot });
      const displayUsername =
        comment.commentVisibility === "anonymous" ? ANONYMOUS_COMMENT_AUTHOR : username;

      const nowIso = new Date().toISOString();
      db.prepare(
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
          scene_snapshot,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
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
        comment.sceneSnapshotJson,
        nowIso
      );

      return this.getComments(comment.toiletId, { viewerUserId: userId });
    },
    async deleteComment({ toiletId, commentId, userId }) {
      const comment = normaliseCommentDeletePayload({ toiletId, commentId });
      const result = db
        .prepare(
          `
          DELETE FROM toilet_comments
          WHERE id = ?
            AND toilet_id = ?
            AND user_id = ?
          `
        )
        .run(comment.commentId, comment.toiletId, userId);

      return {
        deleted: result.changes > 0,
        comments: await this.getComments(comment.toiletId, { viewerUserId: userId })
      };
    },
    async updateCommentProfileVisibility({ commentId, userId, profileVisibility }) {
      const safeCommentId = Number(commentId);
      if (!Number.isInteger(safeCommentId) || safeCommentId <= 0) {
        throw new Error("commentId is required.");
      }

      const safeProfileVisibility = normaliseCommentProfileVisibility(profileVisibility);
      const result = db
        .prepare(
          `
          UPDATE toilet_comments
          SET profile_visibility = ?
          WHERE id = ?
            AND user_id = ?
          `
        )
        .run(safeProfileVisibility, safeCommentId, userId);

      return {
        updated: result.changes > 0,
        comments: await this.getUserComments(userId, 30)
      };
    },
    async toggleCommentLike({ toiletId, commentId, userId }) {
      const result = toggleCommentReaction({
        toiletId,
        commentId,
        userId,
        reactionTable: "comment_likes",
        oppositeTable: "comment_dislikes"
      });

      return {
        found: result.found,
        liked: result.active,
        comments: await this.getComments(result.toiletId, { viewerUserId: userId })
      };
    },
    async toggleCommentDislike({ toiletId, commentId, userId }) {
      const result = toggleCommentReaction({
        toiletId,
        commentId,
        userId,
        reactionTable: "comment_dislikes",
        oppositeTable: "comment_likes"
      });

      return {
        found: result.found,
        disliked: result.active,
        comments: await this.getComments(result.toiletId, { viewerUserId: userId })
      };
    }
  };
}
