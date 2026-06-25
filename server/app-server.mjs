import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createBrotliCompress, createGzip } from "node:zlib";
import { createDatabase } from "./database.mjs";
import { normaliseCommentPayload } from "./database/repository/repository-utils.mjs";
import { createRegistrationEmailService } from "./email-service.mjs";
import { createAiService } from "./ai-service.mjs";

const STATIC_CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4"
};

const API_CACHE_CONTROL = "no-cache";
const PRIVATE_API_CACHE_CONTROL = "no-store";
const SENSITIVE_CACHE_CONTROL = "no-store";
const PUBLIC_TOILETS_CACHE_CONTROL = "public, max-age=10, stale-while-revalidate=20";
const PUBLIC_TOILETS_SERVER_CACHE_TTL_MS = 10_000;
const PUBLIC_TOILETS_SERVER_CACHE_MAX_ENTRIES = 12;
const STATIC_DOCUMENT_CACHE_CONTROL = "no-cache, max-age=0, must-revalidate";
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";
const STATIC_APP_CODE_CACHE_CONTROL = "no-cache, max-age=0, must-revalidate";
const STATIC_IMAGE_CACHE_CONTROL = "public, max-age=604800, immutable";
const STATIC_DEV_CACHE_CONTROL = "no-store";
const STATIC_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const STATIC_APP_CODE_EXTENSIONS = new Set([".js", ".css", ".json", ".webmanifest", ".csv", ".txt"]);
const COMPRESSIBLE_STATIC_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".webmanifest", ".csv", ".txt", ".svg"]);
const COMPRESSION_MIN_BYTES = 1024;
const responseRequests = new WeakMap();

const TRUTHY_QUERY_FLAGS = new Set(["1", "true", "yes"]);
const BODY_SIZE_LIMIT_BYTES = 8 * 1024 * 1024;
const DEFAULT_API_CORS_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost:8100"
]);
const CLIENT_ERROR_MESSAGE_MATCHERS = [
  "required",
  "non-negative",
  "integer from 1 to 5",
  "coordinate",
  "scoringModel",
  "Unsupported",
  "comment media",
  "Photo attachments",
  "comment scene",
  "comment visibility",
  "comment profile visibility",
  "too large",
  "openingTimes",
  "submission status",
  "report status",
  "report action",
  "report issue",
  "toiletExists",
  "not found"
];

function appendVaryHeader(headers, value) {
  const currentValue = headers.Vary ?? headers.vary ?? "";
  const values = new Set(
    String(currentValue)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  values.add(value);
  headers.Vary = [...values].join(", ");
  delete headers.vary;
}

function requestAcceptsEncoding(request, encoding) {
  const acceptEncoding = String(request?.headers?.["accept-encoding"] ?? "").toLowerCase();
  if (!acceptEncoding) return false;

  return acceptEncoding.split(",").some((entry) => {
    const [name, ...params] = entry.split(";").map((part) => part.trim());
    return name === encoding && !params.some((param) => /^q=0(?:\.0+)?$/.test(param));
  });
}

function selectCompressionEncoding(request, contentLength) {
  if (!request || contentLength < COMPRESSION_MIN_BYTES) return null;

  if (requestAcceptsEncoding(request, "br")) {
    return "br";
  }

  if (requestAcceptsEncoding(request, "gzip")) {
    return "gzip";
  }

  return null;
}

function createCompressionStream(encoding) {
  if (encoding === "br") return createBrotliCompress();
  if (encoding === "gzip") return createGzip();
  return null;
}

function sendResponseBody(response, statusCode, body, headers) {
  const request = responseRequests.get(response);
  const encoding = selectCompressionEncoding(request, body.byteLength);
  const responseHeaders = withCorsHeaders(request, { ...headers });

  if (encoding) {
    responseHeaders["Content-Encoding"] = encoding;
    appendVaryHeader(responseHeaders, "Accept-Encoding");
    response.writeHead(statusCode, responseHeaders);

    const compressor = createCompressionStream(encoding);
    compressor.pipe(response);
    compressor.end(body);
    return;
  }

  responseHeaders["Content-Length"] = body.byteLength;
  response.writeHead(statusCode, responseHeaders);
  response.end(body);
}

function sendJson(response, statusCode, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const responseHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": API_CACHE_CONTROL,
    ...headers
  };
  sendResponseBody(response, statusCode, body, responseHeaders);
}

function sendSensitiveJson(response, statusCode, payload, headers = {}) {
  sendJson(response, statusCode, payload, {
    "Cache-Control": SENSITIVE_CACHE_CONTROL,
    ...headers
  });
}

function sendPlainText(response, statusCode, message) {
  response.writeHead(statusCode, withCorsHeaders(responseRequests.get(response)));
  response.end(message);
}

function getAllowedApiCorsOrigins() {
  const configuredOrigins = String(process.env.WHERETOI_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins.length > 0) {
    return new Set(configuredOrigins);
  }

  return DEFAULT_API_CORS_ORIGINS;
}

function getAllowedCorsOrigin(request) {
  const origin = String(request?.headers?.origin ?? "");
  if (!origin) return null;

  const allowedOrigins = getAllowedApiCorsOrigins();
  if (allowedOrigins.has(origin)) {
    return origin;
  }

  return null;
}

function withCorsHeaders(request, headers = {}) {
  const origin = getAllowedCorsOrigin(request);
  if (!origin) return headers;

  const nextHeaders = {
    ...headers,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true"
  };
  appendVaryHeader(nextHeaders, "Origin");
  return nextHeaders;
}

function getCorsPreflightHeaders(request) {
  const requestedHeaders = String(request?.headers?.["access-control-request-headers"] ?? "Content-Type");

  return withCorsHeaders(request, {
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": requestedHeaders,
    "Access-Control-Max-Age": "600",
    "Content-Length": "0"
  });
}

function buildSessionCookie(request, value, maxAgeSeconds) {
  const crossOriginNativeRequest = Boolean(getAllowedCorsOrigin(request));
  const sameSitePolicy = crossOriginNativeRequest ? "SameSite=None; Secure" : "SameSite=Strict";
  return `session=${value}; HttpOnly; Path=/; ${sameSitePolicy}; Max-Age=${maxAgeSeconds}`;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(";").forEach((cookie) => {
      const parts = cookie.split("=");
      cookies[parts.shift().trim()] = decodeURI(parts.join("="));
    });
  }
  return cookies;
}

function getSessionUserId(request) {
  const cookies = parseCookies(request.headers.cookie);
  return cookies.session ? Number(cookies.session) : null;
}

async function readJsonBody(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
    if (body.length > BODY_SIZE_LIMIT_BYTES) {
      throw new Error("Request body is too large.");
    }
  }

  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function isRequestBodyError(error) {
  return error instanceof Error && error.message.includes("Request body");
}

function isKnownClientError(error) {
  return (
    error instanceof Error &&
    CLIENT_ERROR_MESSAGE_MATCHERS.some((matcher) => error.message.includes(matcher))
  );
}

function getHttpClientErrorStatus(error) {
  const statusCode = Number(error?.statusCode ?? error?.status);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500
    ? statusCode
    : null;
}

function getHttpClientErrorHeaders(error) {
  const retryAfterSeconds = Number(error?.retryAfterSeconds);
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return {};
  }

  return { "Retry-After": String(Math.ceil(retryAfterSeconds)) };
}

function normaliseOptionalToiletId(toiletId) {
  if (typeof toiletId !== "string") return null;

  const trimmedToiletId = toiletId.trim();
  return trimmedToiletId.length > 0 ? trimmedToiletId : null;
}

function parseAccessibleOnly(queryValue) {
  return TRUTHY_QUERY_FLAGS.has((queryValue ?? "").toLowerCase());
}

function isAdminUser(user) {
  return Boolean(user?.isAdmin || user?.is_admin);
}

async function getAuthenticatedUser(request, database) {
  const userId = getSessionUserId(request);
  return userId ? database.getUserById(userId) : null;
}

async function requireAdminUser(request, response, database) {
  const user = await getAuthenticatedUser(request, database);
  if (!user) {
    sendSensitiveJson(response, 401, { error: "Not authenticated" });
    return null;
  }

  if (!isAdminUser(user)) {
    sendSensitiveJson(response, 403, { error: "Admin access required." });
    return null;
  }

  return user;
}

function createPublicToiletsCache() {
  const entries = new Map();
  const pendingLoads = new Map();
  let generation = 0;

  function setEntry(key, value) {
    entries.delete(key);
    entries.set(key, {
      value,
      expiresAt: Date.now() + PUBLIC_TOILETS_SERVER_CACHE_TTL_MS
    });

    while (entries.size > PUBLIC_TOILETS_SERVER_CACHE_MAX_ENTRIES) {
      entries.delete(entries.keys().next().value);
    }
  }

  return {
    clear() {
      generation += 1;
      entries.clear();
    },
    async getOrLoad(key, load, { refresh = false } = {}) {
      if (!refresh) {
        const entry = entries.get(key);
        if (entry?.expiresAt > Date.now()) {
          entries.delete(key);
          entries.set(key, entry);
          return entry.value;
        }
        entries.delete(key);
      }

      const loadGeneration = generation;
      const pendingKey = `${loadGeneration}:${key}`;
      const pendingLoad = pendingLoads.get(pendingKey);
      if (pendingLoad) return pendingLoad;

      const loadPromise = Promise.resolve().then(load);
      pendingLoads.set(pendingKey, loadPromise);

      try {
        const value = await loadPromise;
        if (generation === loadGeneration) {
          setEntry(key, value);
        }
        return value;
      } finally {
        if (pendingLoads.get(pendingKey) === loadPromise) {
          pendingLoads.delete(pendingKey);
        }
      }
    }
  };
}

function queueRegistrationEmail({ emailService, logger, user }) {
  if (typeof emailService?.sendRegistrationSuccessEmail !== "function") return;

  try {
    const sendResult = emailService.sendRegistrationSuccessEmail(user);
    Promise.resolve(sendResult).catch((error) => {
      logger.error("Registration confirmation email failed:", error);
    });
  } catch (error) {
    logger.error("Registration confirmation email failed:", error);
  }
}

function createApiRouteHandlers(database, { emailService, logger }) {
  const publicToiletsCache = createPublicToiletsCache();

  return {
    "GET /api/health": async ({ response }) => {
      sendJson(response, 200, {
        status: "ok",
        commit: process.env.RENDER_GIT_COMMIT ?? null,
        database: database.backend
      });
    },
    "POST /api/register": async ({ request, response }) => {
      const body = await readJsonBody(request);
      try {
        const user = await database.createUser({
          username: body.username,
          password: body.password,
          email: body.email
        });
        queueRegistrationEmail({ emailService, logger, user });
        sendSensitiveJson(response, 201, { user });
      } catch (error) {
        if (error.code === "23505" || error.message?.includes("UNIQUE constraint failed")) {
          sendSensitiveJson(response, 400, { error: "Username already exists." });
        } else {
          throw error;
        }
      }
    },
    "POST /api/login": async ({ request, response }) => {
      const body = await readJsonBody(request);
      const user = await database.verifyUserPassword(body.username, body.password);

      if (user) {
        sendSensitiveJson(response, 200, { user }, {
          "Set-Cookie": buildSessionCookie(request, user.id, 86400)
        });
      } else {
        sendSensitiveJson(response, 401, { error: "Invalid username or password." });
      }
    },
    "POST /api/logout": async ({ request, response }) => {
      sendSensitiveJson(response, 200, { status: "logged out" }, {
        "Set-Cookie": buildSessionCookie(request, "", 0)
      });
    },
    "GET /api/me": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      if (!userId) {
        sendSensitiveJson(response, 401, { error: "Not authenticated" });
        return;
      }
      const user = await database.getUserById(userId);
      sendSensitiveJson(response, 200, { user });
    },
    "POST /api/me/profile": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      if (!userId) {
        sendSensitiveJson(response, 401, { error: "Not authenticated" });
        return;
      }
      const body = await readJsonBody(request);
      const user = await database.updateUserProfile(userId, {
        gender: body.gender,
        preferences: body.preferences
      });
      sendSensitiveJson(response, 200, { user });
    },
    "GET /api/toilets": async ({ response, url }) => {
      const search = url.searchParams.get("search") ?? "";
      const accessibleOnly = parseAccessibleOnly(url.searchParams.get("accessibleOnly"));
      const cleanlinessRange = url.searchParams.get("cleanlinessRange") ?? "all";

      const bounds = {
        minLat: url.searchParams.get("minLat"),
        maxLat: url.searchParams.get("maxLat"),
        minLng: url.searchParams.get("minLng"),
        maxLng: url.searchParams.get("maxLng")
      };

      const hasBounds = Object.values(bounds).every((val) => val !== null);
      const safeBounds = hasBounds ? bounds : null;
      const cacheKey = JSON.stringify(["list", search, accessibleOnly, cleanlinessRange, safeBounds]);
      const toilets = await publicToiletsCache.getOrLoad(
        cacheKey,
        () => database.getToilets({
          search,
          accessibleOnly,
          cleanlinessRange,
          bounds: safeBounds
        }),
        { refresh: parseAccessibleOnly(url.searchParams.get("refresh")) }
      );

      sendJson(response, 200, { toilets }, {
        "Cache-Control": PUBLIC_TOILETS_CACHE_CONTROL
      });
    },
    "GET /api/toilets/detail": async ({ response, url }) => {
      const toiletId = url.searchParams.get("toiletId");
      if (!toiletId) {
        sendJson(response, 400, { error: "toiletId is required." });
        return;
      }

      const cleanlinessRange = url.searchParams.get("cleanlinessRange") ?? "all";
      const toilet = await publicToiletsCache.getOrLoad(
        JSON.stringify(["detail", toiletId, cleanlinessRange]),
        () => database.getToiletById(toiletId, { cleanlinessRange }),
        { refresh: parseAccessibleOnly(url.searchParams.get("refresh")) }
      );
      if (!toilet) {
        sendJson(response, 404, { error: "Toilet not found." });
        return;
      }

      sendJson(response, 200, { toilet }, {
        "Cache-Control": PUBLIC_TOILETS_CACHE_CONTROL
      });
    },
    "POST /api/toilets": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      const user = userId ? await database.getUserById(userId) : null;
      if (!user) {
        sendSensitiveJson(response, 401, { error: "Log in to add a missing toilet." });
        return;
      }

      const body = await readJsonBody(request);
      const toilet = await database.createToiletContribution({
        userId,
        ...body
      });

      sendSensitiveJson(response, 201, {
        toilet,
        submission: toilet,
        status: toilet?.submissionStatus ?? "pending"
      });
    },
    "POST /api/toilets/report": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      const user = userId ? await database.getUserById(userId) : null;
      if (!user) {
        sendSensitiveJson(response, 401, { error: "Log in to report incorrect toilet information." });
        return;
      }

      const body = await readJsonBody(request);
      const report = await database.createToiletReport({
        userId,
        ...body
      });
      sendSensitiveJson(response, 201, { report, status: report?.status ?? "pending" });
    },
    "GET /api/admin/toilet-submissions": async ({ request, response, url }) => {
      const admin = await requireAdminUser(request, response, database);
      if (!admin) return;

      const status = url.searchParams.get("status") ?? "pending";
      const submissions = await database.getToiletSubmissions({ status });
      sendSensitiveJson(response, 200, { submissions });
    },
    "POST /api/admin/toilet-submissions/review": async ({ request, response }) => {
      const admin = await requireAdminUser(request, response, database);
      if (!admin) return;

      const body = await readJsonBody(request);
      const submission = await database.reviewToiletSubmission({
        toiletId: body.toiletId,
        reviewerUserId: admin.id,
        status: body.status,
        reviewNote: body.reviewNote
      });

      if (!submission) {
        sendSensitiveJson(response, 404, { error: "Toilet submission not found." });
        return;
      }

      publicToiletsCache.clear();
      sendSensitiveJson(response, 200, { submission });
    },
    "GET /api/admin/toilet-reports": async ({ request, response, url }) => {
      const admin = await requireAdminUser(request, response, database);
      if (!admin) return;

      const status = url.searchParams.get("status") ?? "pending";
      const reports = await database.getToiletReports({ status });
      sendSensitiveJson(response, 200, { reports });
    },
    "POST /api/admin/toilet-reports/review": async ({ request, response }) => {
      const admin = await requireAdminUser(request, response, database);
      if (!admin) return;

      const body = await readJsonBody(request);
      const report = await database.reviewToiletReport({
        reportId: body.reportId,
        reviewerUserId: admin.id,
        action: body.action,
        reviewNote: body.reviewNote
      });
      if (!report) {
        sendSensitiveJson(response, 404, { error: "Toilet report not found." });
        return;
      }

      publicToiletsCache.clear();
      sendSensitiveJson(response, 200, { report });
    },
    "GET /api/toilets/summary": async ({ request, response, url, aiService }) => {
      const toiletId = url.searchParams.get("toiletId");
      if (!toiletId) {
        sendJson(response, 400, { error: "toiletId is required." });
        return;
      }

      if (!aiService) {
        sendJson(response, 503, { error: "AI service is not configured." });
        return;
      }

      const comments = await database.getComments(toiletId);
      if (comments.length === 0) {
        sendJson(response, 200, { summary: "No comments yet to summarize." });
        return;
      }

      try {
        const summary = await aiService.summarizeComments(comments);
        sendJson(response, 200, { summary });
      } catch (error) {
        logger.error("AI Summary generation failed for toilet:", toiletId, error);
        sendJson(response, 500, { error: `AI error: ${error.message}` });
      }
    },
    "GET /api/account": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      if (!userId) {
        sendSensitiveJson(response, 401, { error: "Not authenticated" });
        return;
      }
      const [account, history, comments] = await Promise.all([
        database.getAccount(userId),
        database.getAccessHistory(userId, 10),
        database.getUserComments(userId, 30)
      ]);

      sendSensitiveJson(response, 200, { account, history, comments });
    },
    "POST /api/account/comment-profile-visibility": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      if (!userId) {
        sendSensitiveJson(response, 401, { error: "Not authenticated" });
        return;
      }

      const body = await readJsonBody(request);
      const result = await database.updateCommentProfileVisibility({
        commentId: body.commentId,
        userId,
        profileVisibility: body.profileVisibility
      });

      if (!result.updated) {
        sendSensitiveJson(response, 404, { error: "Comment not found." });
        return;
      }

      sendSensitiveJson(response, 200, { comments: result.comments });
    },
    "GET /api/public-profile": async ({ request, response, url }) => {
      const viewerUserId = getSessionUserId(request);
      const profile = await database.getPublicProfile(url.searchParams.get("userId"), {
        viewerUserId,
        limit: Number(url.searchParams.get("limit") ?? 30)
      });

      if (!profile) {
        sendJson(response, 404, { error: "User not found." });
        return;
      }

      sendJson(response, 200, { profile });
    },
    "GET /api/access-history": async ({ request, response, url }) => {
      const userId = getSessionUserId(request);
      if (!userId) {
        sendSensitiveJson(response, 401, { error: "Not authenticated" });
        return;
      }
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const history = await database.getAccessHistory(userId, limit);

      sendSensitiveJson(response, 200, { history });
    },
    "POST /api/access-history": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      if (!userId) {
        sendSensitiveJson(response, 401, { error: "Not authenticated" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await database.recordAccess({
        userId,
        toiletId: normaliseOptionalToiletId(body.toiletId),
        toiletName: body.toiletName,
        eventType: body.eventType,
        amountGbp: body.amountGbp,
        useFreeTicket: Boolean(body.useFreeTicket)
      });

      sendSensitiveJson(response, 201, result);
    },
    "POST /api/cleanliness-survey": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      const user = userId ? await database.getUserById(userId) : null;
      if (!user) {
        sendSensitiveJson(response, 401, { error: "Log in to rate cleanliness." });
        return;
      }

      const body = await readJsonBody(request);
      const result = await database.recordCleanlinessSurvey({
        userId,
        toiletId: normaliseOptionalToiletId(body.toiletId),
        toiletName: body.toiletName,
        rating: body.rating,
        answer: body.answer
      });
      publicToiletsCache.clear();

      sendSensitiveJson(response, 201, result);
    },
    "GET /api/comments": async ({ request, response, url }) => {
      const userId = getSessionUserId(request);
      const toiletId = url.searchParams.get("toiletId");
      const comments = await database.getComments(toiletId, { viewerUserId: userId });

      sendJson(response, 200, { comments }, {
        "Cache-Control": PRIVATE_API_CACHE_CONTROL,
        "Vary": "Cookie"
      });
    },
    "POST /api/comments": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      const user = userId ? await database.getUserById(userId) : null;
      if (!user) {
        sendSensitiveJson(response, 401, { error: "Log in to post comments." });
        return;
      }

      const body = await readJsonBody(request);
      const media = body.mediaAttachments ?? body.media;
      const comment = normaliseCommentPayload({
        toiletId: body.toiletId,
        commentText: body.commentText,
        commentVisibility: body.commentVisibility,
        cleanlinessRating: body.cleanlinessRating,
        media,
        sceneSnapshot: body.sceneSnapshot
      });
      const cleanlinessResult = await database.recordCleanlinessSurvey({
        userId,
        toiletId: comment.toiletId,
        rating: comment.cleanlinessRating
      });
      const comments = await database.saveComment({
        toiletId: comment.toiletId,
        userId: userId,
        username: user.username,
        commentText: comment.commentText,
        commentVisibility: comment.commentVisibility,
        cleanlinessRating: comment.cleanlinessRating,
        media,
        sceneSnapshot: comment.sceneSnapshot
      });
      publicToiletsCache.clear();

      sendSensitiveJson(response, 201, { comments, toilet: cleanlinessResult.toilet });
    },
    "DELETE /api/comments": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      const user = userId ? await database.getUserById(userId) : null;
      if (!user) {
        sendSensitiveJson(response, 401, { error: "Log in to delete comments." });
        return;
      }

      const body = await readJsonBody(request);
      const result = await database.deleteComment({
        toiletId: body.toiletId,
        commentId: body.commentId,
        userId
      });

      if (!result.deleted) {
        sendSensitiveJson(response, 404, { error: "Comment not found." });
        return;
      }

      sendSensitiveJson(response, 200, { comments: result.comments });
    },
    "POST /api/comment-likes": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      const user = userId ? await database.getUserById(userId) : null;
      if (!user) {
        sendSensitiveJson(response, 401, { error: "Log in to like comments." });
        return;
      }

      const body = await readJsonBody(request);
      const result = await database.toggleCommentLike({
        toiletId: body.toiletId,
        commentId: body.commentId,
        userId
      });

      if (!result.found) {
        sendSensitiveJson(response, 404, { error: "Comment not found." });
        return;
      }

      sendSensitiveJson(response, 200, {
        liked: result.liked,
        comments: result.comments
      });
    },
    "POST /api/comment-dislikes": async ({ request, response }) => {
      const userId = getSessionUserId(request);
      const user = userId ? await database.getUserById(userId) : null;
      if (!user) {
        sendSensitiveJson(response, 401, { error: "Log in to dislike comments." });
        return;
      }

      const body = await readJsonBody(request);
      const result = await database.toggleCommentDislike({
        toiletId: body.toiletId,
        commentId: body.commentId,
        userId
      });

      if (!result.found) {
        sendSensitiveJson(response, 404, { error: "Comment not found." });
        return;
      }

      sendSensitiveJson(response, 200, {
        disliked: result.disliked,
        comments: result.comments
      });
    }
  };
}

async function handleApiRoute({ routeHandlers, request, response, url, aiService }) {
  const method = request.method?.toUpperCase() ?? "GET";
  const pathname = url.pathname.length > 1 && url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;

  const routeKey = `${method} ${pathname}`;
  let routeHandler = routeHandlers[routeKey];

  if (!routeHandler && method === "HEAD") {
    routeHandler = routeHandlers[`GET ${pathname}`];
  }

  if (!routeHandler) {
    return false;
  }

  await routeHandler({ request, response, url, aiService });
  return true;
}

function resolveStaticFilePath(root, pathname) {
  const safePathname = normalize(decodeURIComponent(pathname)).replace(/^([.][./\\])+/, "");
  return resolve(join(root, safePathname === "/" ? "index.html" : safePathname));
}

function getStaticCacheControl(file, staticCacheMode = "production") {
  if (staticCacheMode === "development") {
    return STATIC_DEV_CACHE_CONTROL;
  }

  const extension = extname(file).toLowerCase();

  if (extension === ".html") {
    return STATIC_DOCUMENT_CACHE_CONTROL;
  }

  if (STATIC_APP_CODE_EXTENSIONS.has(extension)) {
    return STATIC_APP_CODE_CACHE_CONTROL;
  }

  if (STATIC_IMAGE_EXTENSIONS.has(extension)) {
    return STATIC_IMAGE_CACHE_CONTROL;
  }

  return STATIC_ASSET_CACHE_CONTROL;
}

function isStaticFileCompressible(file) {
  return COMPRESSIBLE_STATIC_EXTENSIONS.has(extname(file).toLowerCase());
}

function getRoundedModifiedTime(fileStat) {
  return Math.floor(fileStat.mtimeMs / 1000) * 1000;
}

function isStaticFileFresh(request, fileStat) {
  const modifiedSince = request.headers["if-modified-since"];
  if (!modifiedSince) return false;

  const modifiedSinceTime = Date.parse(modifiedSince);
  if (!Number.isFinite(modifiedSinceTime)) return false;

  return modifiedSinceTime >= getRoundedModifiedTime(fileStat);
}

async function serveStaticFile({ root, pathname, request, response, staticCacheMode }) {
  const candidate = resolveStaticFilePath(root, pathname);

  if (!candidate.startsWith(root)) {
    sendPlainText(response, 403, "Forbidden");
    return;
  }

  const candidateStat = await stat(candidate);
  const file = candidateStat.isDirectory() ? join(candidate, "index.html") : candidate;
  const fileStat = candidateStat.isDirectory() ? await stat(file) : candidateStat;
  const lastModified = new Date(getRoundedModifiedTime(fileStat)).toUTCString();
  const headers = {
    "Content-Type": STATIC_CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": getStaticCacheControl(file, staticCacheMode),
    "Last-Modified": lastModified
  };

  if (staticCacheMode !== "development" && isStaticFileFresh(request, fileStat)) {
    response.writeHead(304, headers);
    response.end();
    return;
  }

  const encoding = isStaticFileCompressible(file)
    ? selectCompressionEncoding(request, fileStat.size)
    : null;

  if (encoding) {
    headers["Content-Encoding"] = encoding;
    appendVaryHeader(headers, "Accept-Encoding");
    response.writeHead(200, headers);

    const compressor = createCompressionStream(encoding);
    createReadStream(file).pipe(compressor).pipe(response);
    return;
  }

  headers["Content-Length"] = fileStat.size;
  response.writeHead(200, headers);
  createReadStream(file).pipe(response);
}

function createRequestHandler({ root, port, database, emailService, aiService, logger, staticCacheMode }) {
  const routeHandlers = createApiRouteHandlers(database, { emailService, logger });

  return async function handleRequest(request, response) {
    responseRequests.set(response, request);
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);

    try {
      if (request.method?.toUpperCase() === "OPTIONS" && url.pathname.startsWith("/api/")) {
        const headers = getCorsPreflightHeaders(request);
        response.writeHead(headers["Access-Control-Allow-Origin"] ? 204 : 403, headers);
        response.end();
        return;
      }

      const apiHandled = await handleApiRoute({ routeHandlers, request, response, url, aiService });
      if (apiHandled) return;

      await serveStaticFile({ root, pathname: url.pathname, request, response, staticCacheMode });
    } catch (error) {
      if (error?.code === "ENOENT") {
        sendPlainText(response, 404, "Not found");
        return;
      }

      const clientErrorStatus = getHttpClientErrorStatus(error);
      if (clientErrorStatus) {
        sendJson(response, clientErrorStatus, { error: error.message }, getHttpClientErrorHeaders(error));
        return;
      }

      if (isRequestBodyError(error) || isKnownClientError(error)) {
        sendJson(response, 400, { error: error.message });
        return;
      }

      logger.error("Server request failed:", error);
      sendJson(response, 500, { error: "Internal server error." });
    }
  };
}

export async function createAppServer({
  rootDirectory = ".",
  port = 4173,
  logger = console,
  emailService = createRegistrationEmailService(),
  aiService: providedAiService,
  staticCacheMode = "production",
  databaseOptions = {}
} = {}) {
  const root = resolve(rootDirectory);
  const database = await createDatabase({ rootDirectory: root, ...databaseOptions });
  const aiService = providedAiService ?? (await createAiService());
  const requestHandler = createRequestHandler({ root, port, database, emailService, aiService, logger, staticCacheMode });

  const server = createServer(requestHandler);

  return {
    listen(host = undefined) {
      return new Promise((resolveListen, rejectListen) => {
        const onError = (error) => {
          server.off("error", onError);
          rejectListen(error);
        };

        server.on("error", onError);

        server.listen(port, host, () => {
          server.off("error", onError);
          const address = server.address();
          const assignedPort = typeof address === "object" && address ? address.port : port;
          resolveListen(assignedPort);
        });
      });
    },
    async close() {
      if (!server.listening) {
        await database.close?.();
        return;
      }

      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
        server.closeAllConnections?.();
      });
      await database.close?.();
    }
  };
}
