import { normaliseText } from "../mapper/toilet-mapper.mjs";
import { calculateCleanlinessScore } from "../scoring/cleanliness-scoring.mjs";

export function normaliseSearchQuery(search) {
  return normaliseText(search).toLowerCase();
}

export function normaliseUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("userId is required.");
  }
  return userId;
}

const COMMENT_VISIBILITIES = new Set(["real", "anonymous"]);
const COMMENT_PROFILE_VISIBILITIES = new Set(["private", "public"]);
const COMMENT_SCENE_FIXTURES = [
  "wall",
  "toilet",
  "urinal",
  "accessibleSupport",
  "accessibleAlarm",
  "accessibleDispenser",
  "accessibleMirror",
  "womenSanitaryBin",
  "womenProductDispenser",
  "womenShelf",
  "sink",
  "floor"
];
const COMMENT_SCENE_FIXTURE_SET = new Set(COMMENT_SCENE_FIXTURES);
const COMMENT_SCENE_FIXTURE_ID_BY_KEY = new Map(
  COMMENT_SCENE_FIXTURES.map((fixtureId) => [fixtureId.toLowerCase(), fixtureId])
);
const COMMENT_SCENE_TYPES = new Set(["standard", "women", "accessible"]);
const COMMENT_SCENE_DIRT_TYPES = new Set([
  "stain",
  "wet",
  "tissue",
  "dust",
  "urine",
  "feces",
  "mud",
  "soap",
  "hair"
]);
const COMMENT_SCENE_MAX_PLACEMENTS = 80;
export const CLEANLINESS_RATING_COOLDOWN_MS = 30 * 60 * 1000;
export const ANONYMOUS_COMMENT_AUTHOR = "Anonymous";
export const TOILET_DUPLICATE_RADIUS_METRES = 35;

const TOILET_FEATURE_KEYS = [
  "women",
  "men",
  "accessible",
  "neutral",
  "children",
  "babyChanging",
  "bidet",
  "automatic",
  "urinalOnly",
  "radarKey",
  "free"
];
const TIME_VALUE_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOILET_SUBMISSION_STATUSES = new Set(["pending", "approved", "rejected"]);
const TOILET_REPORT_ISSUE_TYPES = new Set(["missing", "location", "features", "hours", "other"]);
const TOILET_REPORT_EXISTENCE_VALUES = new Set(["yes", "no", "unsure"]);
const TOILET_REPORT_STATUSES = new Set(["pending", "applied", "removed", "rejected"]);
const TOILET_REPORT_ACTIONS = new Set(["apply", "remove", "reject"]);

export function getConfiguredAdminIdentifiers() {
  return new Set(
    String(process.env.WHERETOI_ADMIN_USERNAMES ?? "")
      .split(",")
      .map((value) => normaliseText(value).toLowerCase())
      .filter(Boolean)
  );
}

export function isConfiguredAdminUser(user, { enableDemoAccount = false } = {}) {
  const username = normaliseText(user?.username).toLowerCase();
  const email = normaliseText(user?.email).toLowerCase();
  const adminIdentifiers = getConfiguredAdminIdentifiers();

  return (
    (enableDemoAccount && username === "demo") ||
    (username && adminIdentifiers.has(username)) ||
    (email && adminIdentifiers.has(email))
  );
}

export function normaliseToiletSubmissionStatus(status, fallback = "pending") {
  const normalised = normaliseText(status || fallback).toLowerCase();
  if (!TOILET_SUBMISSION_STATUSES.has(normalised)) {
    throw new Error("submission status must be pending, approved, or rejected.");
  }
  return normalised;
}

export function normaliseToiletReportStatus(status, fallback = "pending") {
  const normalised = normaliseText(status || fallback).toLowerCase();
  if (!TOILET_REPORT_STATUSES.has(normalised)) {
    throw new Error("report status must be pending, applied, removed, or rejected.");
  }
  return normalised;
}

export function normaliseToiletReportAction(action) {
  const normalised = normaliseText(action).toLowerCase();
  if (!TOILET_REPORT_ACTIONS.has(normalised)) {
    throw new Error("report action must be apply, remove, or reject.");
  }
  return normalised;
}

export function createCleanlinessRatingCooldownError(latestCreatedAt, nowMs = Date.now()) {
  const latestTime = Date.parse(latestCreatedAt);
  const retryAtMs = Number.isFinite(latestTime)
    ? latestTime + CLEANLINESS_RATING_COOLDOWN_MS
    : nowMs + CLEANLINESS_RATING_COOLDOWN_MS;
  const remainingMs = Math.max(0, retryAtMs - nowMs);
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const error = new Error(
    `You can rate this toilet again in ${remainingMinutes} ${remainingMinutes === 1 ? "minute" : "minutes"}.`
  );
  error.statusCode = 429;
  error.retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return error;
}

export function createDuplicateToiletError(toilet, distanceMetres = null) {
  const roundedDistance = Number.isFinite(distanceMetres) ? Math.round(distanceMetres) : null;
  const distanceText = roundedDistance === null ? "" : ` (${roundedDistance}m away)`;
  const error = new Error(`${toilet?.name ?? "This toilet"} is already on the map${distanceText}.`);
  error.statusCode = 409;
  error.duplicateToilet = toilet ?? null;
  error.distanceMetres = roundedDistance;
  return error;
}

export function distanceInMetres(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getCoordinateBounds(lat, lng, radiusMetres = TOILET_DUPLICATE_RADIUS_METRES) {
  const latitudeDelta = radiusMetres / 111320;
  const longitudeScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const longitudeDelta = radiusMetres / (111320 * longitudeScale);

  return {
    minLat: lat - latitudeDelta,
    maxLat: lat + latitudeDelta,
    minLng: lng - longitudeDelta,
    maxLng: lng + longitudeDelta
  };
}

function normaliseFeatureFlag(value, fallback = "?") {
  if (value === true || value === 1) return "Y";
  if (value === false || value === 0) return "N";

  const normalised = normaliseText(value).toLowerCase();
  if (["y", "yes", "true", "1", "available"].includes(normalised)) return "Y";
  if (["n", "no", "false", "0", "unavailable"].includes(normalised)) return "N";
  return fallback;
}

function normaliseCoordinate(value, label, min, max) {
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
    throw new Error(`${label} must be a valid coordinate.`);
  }
  return coordinate;
}

function normaliseOpeningSlot(slot) {
  if (slot === undefined || slot === null) return null;

  if (typeof slot === "string") {
    const status = normaliseText(slot).toLowerCase();
    if (!status || status === "unknown") return null;
    if (status === "closed") return [];
  }

  if (Array.isArray(slot)) {
    if (slot.length === 0) return [];
    const [openTime, closeTime] = slot.map(normaliseText);
    if (!openTime && !closeTime) return [];
    if (!TIME_VALUE_PATTERN.test(openTime) || !TIME_VALUE_PATTERN.test(closeTime)) {
      throw new Error("openingTimes must use HH:MM times.");
    }
    return [openTime, closeTime];
  }

  if (typeof slot === "object") {
    const status = normaliseText(slot.status ?? slot.state).toLowerCase();
    if (slot.unknown === true || status === "unknown") return null;
    if (slot.closed === true) return [];
    if (status === "closed") return [];
    return normaliseOpeningSlot([slot.open, slot.close]);
  }

  throw new Error("openingTimes must be an array of daily time pairs, closed days, or unknown days.");
}

function normaliseOpeningTimes(openingTimes) {
  if (openingTimes === undefined || openingTimes === null || openingTimes === "") {
    return [null, null, null, null, null, null, null];
  }

  let rawOpeningTimes = openingTimes;
  if (typeof openingTimes === "string") {
    try {
      rawOpeningTimes = JSON.parse(openingTimes);
    } catch {
      throw new Error("openingTimes must be valid JSON.");
    }
  }

  if (!Array.isArray(rawOpeningTimes) || rawOpeningTimes.length !== 7) {
    throw new Error("openingTimes must include seven days.");
  }

  return rawOpeningTimes.map(normaliseOpeningSlot);
}

export function normaliseToiletContributionPayload(payload = {}) {
  const name = normaliseText(payload.name).slice(0, 160);
  const area = (normaliseText(payload.area) || "User submitted").slice(0, 160);
  const note = normaliseText(payload.comment ?? payload.notes).slice(0, 600);
  const lat = normaliseCoordinate(payload.lat ?? payload.latitude, "lat", -90, 90);
  const lng = normaliseCoordinate(payload.lng ?? payload.longitude, "lng", -180, 180);

  if (!name) {
    throw new Error("name is required.");
  }

  const rawFeatures = payload.features && typeof payload.features === "object" ? payload.features : {};
  const features = TOILET_FEATURE_KEYS.reduce((result, key) => {
    result[key] = normaliseFeatureFlag(rawFeatures[key]);
    return result;
  }, {});
  const accessCost = normaliseText(payload.accessCost).toLowerCase();
  if (accessCost === "free") {
    features.free = "Y";
  } else if (accessCost === "paid") {
    features.free = "N";
  }

  return {
    name,
    area,
    lat,
    lng,
    paid: features.free === "N",
    comment: note ? `Comment: ${note}` : "Comment: User submitted toilet.",
    features,
    openingTimes: normaliseOpeningTimes(payload.openingTimes),
    cleanliness: 3
  };
}

export function normaliseToiletReportPayload(payload = {}) {
  const toiletId = normaliseText(payload.toiletId).slice(0, 240);
  if (!toiletId) {
    throw new Error("toiletId is required.");
  }

  const issueTypes = Array.isArray(payload.issueTypes)
    ? [...new Set(
        payload.issueTypes
          .map((value) => normaliseText(value).toLowerCase())
          .filter((value) => TOILET_REPORT_ISSUE_TYPES.has(value))
      )]
    : [];
  if (issueTypes.length === 0) {
    throw new Error("At least one report issue is required.");
  }

  const toiletExists = normaliseText(payload.toiletExists || "unsure").toLowerCase();
  if (!TOILET_REPORT_EXISTENCE_VALUES.has(toiletExists)) {
    throw new Error("toiletExists must be yes, no, or unsure.");
  }

  const rawChanges =
    payload.proposedChanges && typeof payload.proposedChanges === "object" && !Array.isArray(payload.proposedChanges)
      ? payload.proposedChanges
      : {};
  const proposedChanges = {};

  if (issueTypes.includes("location")) {
    proposedChanges.lat = normaliseCoordinate(rawChanges.lat, "lat", -90, 90);
    proposedChanges.lng = normaliseCoordinate(rawChanges.lng, "lng", -180, 180);
  }

  if (issueTypes.includes("features")) {
    const rawFeatures =
      rawChanges.features && typeof rawChanges.features === "object" && !Array.isArray(rawChanges.features)
        ? rawChanges.features
        : {};
    proposedChanges.features = TOILET_FEATURE_KEYS.reduce((result, key) => {
      result[key] = normaliseFeatureFlag(rawFeatures[key]);
      return result;
    }, {});
  }

  if (issueTypes.includes("hours")) {
    proposedChanges.openingTimes = normaliseOpeningTimes(rawChanges.openingTimes);
  }

  return {
    toiletId,
    issueTypes,
    toiletExists,
    details: normaliseText(payload.details).slice(0, 1200),
    proposedChanges
  };
}

function getEmptyCommentMedia() {
  return {
    mediaAttachments: [],
    mediaAttachmentsJson: null,
    mediaType: null,
    mediaMimeType: null,
    mediaName: null,
    mediaSize: null,
    mediaUrl: null
  };
}

function hasCommentMediaPayload(media = null) {
  if (media === null || media === undefined || media === "") return false;
  if (Array.isArray(media)) return media.length > 0;
  return true;
}

function normaliseSceneCoordinate(value, max, fallback = 0) {
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate)) return fallback;
  return Math.round(Math.min(Math.max(coordinate, 0), max));
}

function normaliseCommentSceneType(value) {
  const sceneType = normaliseText(value).toLowerCase();
  return COMMENT_SCENE_TYPES.has(sceneType) ? sceneType : "standard";
}

function getDefaultCommentSceneFixtures(sceneType) {
  if (sceneType === "accessible") {
    return ["wall", "toilet", "accessibleSupport", "accessibleAlarm", "accessibleDispenser", "accessibleMirror", "sink", "floor"];
  }

  if (sceneType === "women") {
    return ["wall", "toilet", "womenProductDispenser", "womenShelf", "womenSanitaryBin", "sink", "floor"];
  }

  return ["wall", "toilet", "urinal", "sink", "floor"];
}

function normaliseCommentSceneActiveFixtures(rawActiveFixtures, sceneType) {
  const activeFixtures = Array.isArray(rawActiveFixtures)
    ? rawActiveFixtures
        .map((fixtureId) => COMMENT_SCENE_FIXTURE_ID_BY_KEY.get(normaliseText(fixtureId).toLowerCase()))
        .filter(Boolean)
    : [];

  const validActiveFixtures = activeFixtures.filter((fixtureId) => COMMENT_SCENE_FIXTURE_SET.has(fixtureId));
  if (validActiveFixtures.length === 0) {
    return getDefaultCommentSceneFixtures(sceneType);
  }

  return [...new Set(validActiveFixtures)];
}

function normaliseCommentSceneSnapshot(sceneSnapshot = null, expectedToiletId = "") {
  if (sceneSnapshot === null || sceneSnapshot === undefined || sceneSnapshot === "") {
    return {
      sceneSnapshot: null,
      sceneSnapshotJson: null
    };
  }

  let rawSnapshot = sceneSnapshot;
  if (typeof sceneSnapshot === "string") {
    try {
      rawSnapshot = JSON.parse(sceneSnapshot);
    } catch {
      throw new Error("comment scene must be valid JSON.");
    }
  }

  if (!rawSnapshot || typeof rawSnapshot !== "object" || Array.isArray(rawSnapshot)) {
    throw new Error("comment scene must be an object.");
  }

  const rawFixtures = rawSnapshot.fixtures;
  if (!rawFixtures || typeof rawFixtures !== "object" || Array.isArray(rawFixtures)) {
    throw new Error("comment scene fixtures are required.");
  }

  let totalPlacements = 0;
  const sceneType = normaliseCommentSceneType(rawSnapshot.sceneType);
  const activeFixtures = normaliseCommentSceneActiveFixtures(rawSnapshot.activeFixtures, sceneType);
  const fixtures = activeFixtures.reduce((snapshot, fixtureId) => {
    const rawPlacements = Array.isArray(rawFixtures[fixtureId]) ? rawFixtures[fixtureId] : [];
    snapshot[fixtureId] = rawPlacements
      .map((placement, index) => {
        if (!placement || typeof placement !== "object" || Array.isArray(placement)) return null;
        const dirtId = normaliseText(placement.dirtId).toLowerCase();
        if (!COMMENT_SCENE_DIRT_TYPES.has(dirtId)) return null;
        totalPlacements += 1;
        if (totalPlacements > COMMENT_SCENE_MAX_PLACEMENTS) {
          throw new Error(`comment scene can include at most ${COMMENT_SCENE_MAX_PLACEMENTS} dirt placements.`);
        }
        return {
          id: normaliseText(placement.id).slice(0, 80) || `${fixtureId}-${dirtId}-${index + 1}`,
          dirtId,
          x: normaliseSceneCoordinate(placement.x, 820),
          y: normaliseSceneCoordinate(placement.y, 500)
        };
      })
      .filter(Boolean);
    return snapshot;
  }, {});

  if (totalPlacements === 0) {
    return {
      sceneSnapshot: null,
      sceneSnapshotJson: null
    };
  }

  const snapshot = {
    version: 3,
    sceneType,
    activeFixtures,
    toiletId: normaliseText(rawSnapshot.toiletId) || expectedToiletId,
    toiletName: normaliseText(rawSnapshot.toiletName).slice(0, 160),
    fixtures
  };

  if (snapshot.toiletId && expectedToiletId && snapshot.toiletId !== expectedToiletId) {
    throw new Error("comment scene toiletId must match the comment toiletId.");
  }

  return {
    sceneSnapshot: snapshot,
    sceneSnapshotJson: JSON.stringify(snapshot)
  };
}

function parseCommentSceneSnapshot(row) {
  if (row.scene_snapshot && typeof row.scene_snapshot === "object" && !Array.isArray(row.scene_snapshot)) {
    return row.scene_snapshot;
  }

  if (typeof row.scene_snapshot === "string" && row.scene_snapshot.trim()) {
    try {
      const parsed = JSON.parse(row.scene_snapshot);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
}

export function mapCommentRow(row, { viewerUserId = null } = {}) {
  if (!row) return row;

  const commentVisibility = normaliseStoredCommentVisibility(row);
  const isAnonymous = commentVisibility === "anonymous";
  const cleanlinessRating = Number(row.cleanliness_rating);
  const hasOwnerUserId = row.user_id !== null && row.user_id !== undefined;
  const hasViewerUserId = viewerUserId !== null && viewerUserId !== undefined;
  const ownerUserId = Number(row.user_id);
  const currentViewerUserId = Number(viewerUserId);
  const canDelete =
    hasOwnerUserId &&
    hasViewerUserId &&
    Number.isInteger(ownerUserId) &&
    Number.isInteger(currentViewerUserId) &&
    ownerUserId === currentViewerUserId;
  const authorName = isAnonymous
    ? ANONYMOUS_COMMENT_AUTHOR
    : normaliseText(row.username) || ANONYMOUS_COMMENT_AUTHOR;

  return {
    ...row,
    user_id: isAnonymous ? null : row.user_id,
    username: authorName,
    comment_visibility: commentVisibility,
    profile_visibility: normaliseStoredCommentProfileVisibility(row),
    author_name: authorName,
    is_anonymous: isAnonymous,
    can_delete: canDelete,
    cleanliness_rating:
      isValidRating(cleanlinessRating)
        ? cleanlinessRating
        : null,
    like_count: Number(row.like_count ?? 0),
    viewer_has_liked: Boolean(row.viewer_has_liked),
    dislike_count: Number(row.dislike_count ?? 0),
    viewer_has_disliked: Boolean(row.viewer_has_disliked),
    media_url: null,
    media_attachments: [],
    scene_snapshot: parseCommentSceneSnapshot(row)
  };
}

function normaliseStoredCommentVisibility(row) {
  const visibility = normaliseText(row.comment_visibility).toLowerCase();
  if (COMMENT_VISIBILITIES.has(visibility)) return visibility;
  return row.user_id ? "real" : "anonymous";
}

function normaliseStoredCommentProfileVisibility(row) {
  const visibility = normaliseText(row.profile_visibility).toLowerCase();
  return COMMENT_PROFILE_VISIBILITIES.has(visibility) ? visibility : "private";
}

export function normaliseCommentVisibility(value = "real") {
  const visibility = normaliseText(value).toLowerCase() || "real";

  if (!COMMENT_VISIBILITIES.has(visibility)) {
    throw new Error("comment visibility must be real or anonymous.");
  }

  return visibility;
}

export function normaliseCommentProfileVisibility(value = "private") {
  const visibility = normaliseText(value).toLowerCase() || "private";

  if (!COMMENT_PROFILE_VISIBILITIES.has(visibility)) {
    throw new Error("comment profile visibility must be private or public.");
  }

  return visibility;
}

export function normaliseCommentPayload({
  toiletId,
  commentText,
  media = null,
  commentVisibility = "real",
  cleanlinessRating,
  sceneSnapshot = null
}) {
  const safeToiletId = normaliseText(toiletId);
  const safeCommentText = typeof commentText === "string" ? commentText.trim() : "";
  const normalisedScene = normaliseCommentSceneSnapshot(sceneSnapshot, safeToiletId);

  if (!safeToiletId) {
    throw new Error("toiletId is required.");
  }

  if (hasCommentMediaPayload(media)) {
    throw new Error("Photo attachments are no longer supported for comment feedback.");
  }

  if (!safeCommentText && !normalisedScene.sceneSnapshot) {
    throw new Error("commentText or interactive scene is required for comment feedback.");
  }

  return {
    toiletId: safeToiletId,
    commentText: safeCommentText,
    commentVisibility: normaliseCommentVisibility(commentVisibility),
    cleanlinessRating: normaliseRating(cleanlinessRating),
    ...normalisedScene,
    ...getEmptyCommentMedia()
  };
}

export function normaliseCommentDeletePayload({ toiletId, commentId }) {
  const safeToiletId = normaliseText(toiletId);
  const safeCommentId = Number(commentId);

  if (!safeToiletId || !Number.isInteger(safeCommentId) || safeCommentId <= 0) {
    throw new Error("toiletId and commentId are required.");
  }

  return {
    toiletId: safeToiletId,
    commentId: safeCommentId
  };
}

export function normaliseCommentLikePayload({ toiletId, commentId }) {
  return normaliseCommentDeletePayload({ toiletId, commentId });
}

export function normaliseRating(value) {
  const rating = Number(value);
  if (!isValidRating(rating)) {
    throw new Error("rating must be from 0.5 to 5 in 0.5-star steps.");
  }
  return rating;
}

export function isValidRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 0.5 && rating <= 5 && Number.isInteger(rating * 2);
}

export function normaliseCleanlinessSurveyPayload({ toiletId = null, toiletName = "", rating, answer }) {
  const safeToiletId = normaliseText(toiletId);
  const safeToiletName = normaliseText(toiletName).replace(/\s+Toilet$/i, "");
  const legacyAnswer = normaliseText(answer).toLowerCase();
  const safeRating =
    rating === undefined && (legacyAnswer === "yes" || legacyAnswer === "no")
      ? legacyAnswer === "yes" ? 5 : 1
      : normaliseRating(rating);

  return { safeToiletId, safeToiletName, safeRating };
}

export function toCleanlinessUpdate({
  row,
  rating,
  userAverageRating = 3,
  userStandardDeviation = 1,
  userBias = 0,
  globalAverageRating = 3,
  globalStandardDeviation = 1,
  cleanlinessScoringModel
}) {
  const legacyRatingTotal = Number(row.cleanliness_yes_count ?? 0) * 5 + Number(row.cleanliness_no_count ?? 0);
  const legacyRatingCount = Number(row.cleanliness_yes_count ?? 0) + Number(row.cleanliness_no_count ?? 0);
  const legacyRatingSumSquares = Number(row.cleanliness_yes_count ?? 0) * 25 + Number(row.cleanliness_no_count ?? 0);
  const legacyBias = 0.0;

  const previousRatingTotal = Number(row.cleanliness_rating_total ?? legacyRatingTotal);
  const previousRatingCount = Number(row.cleanliness_rating_count ?? legacyRatingCount);
  const previousRatingSumSquares = Number(row.cleanliness_rating_sum_squares ?? legacyRatingSumSquares);
  const toiletBias = Number(row.bias ?? legacyBias);

  const ratingTotal = Math.max(previousRatingTotal, 0) + rating;
  const ratingCount = Math.max(previousRatingCount, 0) + 1;
  const ratingSumSquares = Math.max(previousRatingSumSquares, 0) + (rating * rating);

  const result = calculateCleanlinessScore({
    rating,
    ratingTotal,
    ratingCount,
    previousCleanliness: row.cleanliness,
    userAverageRating,
    userStandardDeviation,
    userBias,
    toiletBias,
    globalAverageRating,
    globalStandardDeviation,
    scoringModel: cleanlinessScoringModel
  });

  if (typeof result === "object" && result !== null) {
    return {
      cleanliness: result.cleanliness,
      ratingTotal,
      ratingCount,
      ratingSumSquares,
      newUserBias: result.newUserBias,
      newToiletBias: result.newToiletBias
    };
  }

  return { cleanliness: result, ratingTotal, ratingCount, ratingSumSquares };
}

export function mapCleanlinessSurveyResponse({ row, cleanliness, ratingTotal, ratingCount, cleanlinessScoringModel }) {
  return {
    toilet: {
      id: row.id,
      name: row.name,
      cleanliness,
      cleanlinessSurvey: {
        ratingTotal,
        ratingCount
      },
      scoringModel: cleanlinessScoringModel
    }
  };
}

export function mapAccountRow(row) {
  if (!row) {
    return {
      walletBalanceGbp: 0,
      subscriptionName: "Free",
      subscriptionRenewsOn: null,
      monthlyFreeTicketsLeft: 0
    };
  }

  return {
    walletBalanceGbp: Number(row.wallet_balance_gbp),
    subscriptionName: row.subscription_name,
    subscriptionRenewsOn: row.subscription_renews_on,
    monthlyFreeTicketsLeft: Number(row.monthly_free_tickets_left)
  };
}

export function normaliseAccessPayload({
  toiletId = null,
  toiletName,
  eventType,
  amountGbp = 0,
  useFreeTicket = false
}) {
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

  return {
    toiletId,
    safeToiletName,
    safeEventType,
    safeAmount,
    useFreeTicket: Boolean(useFreeTicket)
  };
}

export function normaliseHistoryLimit(limit = 10) {
  return Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 50) : 10;
}

export function normaliseBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return null;

  const minLat = Number(bounds.minLat);
  const maxLat = Number(bounds.maxLat);
  const minLng = Number(bounds.minLng);
  const maxLng = Number(bounds.maxLng);

  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLng)
  ) {
    return null;
  }

  return {
    minLat: Math.min(minLat, maxLat),
    maxLat: Math.max(minLat, maxLat),
    minLng: Math.min(minLng, maxLng),
    maxLng: Math.max(minLng, maxLng)
  };
}

export function getCleanlinessRangeStartDate(range = "all") {
  const now = new Date();
  if (range === "1day") return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  if (range === "3days") return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  if (range === "1week") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (range === "1month") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

export function mapAccessHistoryRow(row) {
  return {
    id: Number(row.id),
    toiletId: row.toilet_id,
    toiletName: row.toilet_name,
    eventType: row.event_type,
    amountGbp: Number(row.amount_gbp),
    accessTime: row.access_time
  };
}
