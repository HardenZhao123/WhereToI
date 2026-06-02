import { normaliseText } from "../mapper/toilet-mapper.mjs";
import { calculateCleanlinessScore } from "../scoring/cleanliness-scoring.mjs";

export function normaliseSearchQuery(search) {
  return normaliseText(search).toLowerCase();
}

const COMMENT_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const COMMENT_MEDIA_TYPES = new Set(["image", "video"]);
const COMMENT_MEDIA_DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/;

function normaliseCommentMedia(media = null) {
  if (media === null || media === undefined) {
    return {
      mediaType: null,
      mediaMimeType: null,
      mediaName: null,
      mediaSize: null,
      mediaUrl: null
    };
  }

  if (typeof media !== "object" || Array.isArray(media)) {
    throw new Error("comment media must be an image or video attachment.");
  }

  const mediaType = normaliseText(media.type).toLowerCase();
  const mediaMimeType = normaliseText(media.mimeType).toLowerCase();
  const mediaName = normaliseText(media.name).replace(/[\\/]/g, "").slice(0, 120) || "attachment";
  const mediaUrl = typeof media.dataUrl === "string" ? media.dataUrl.trim() : "";
  const dataUrlMatch = mediaUrl.match(COMMENT_MEDIA_DATA_URL_PATTERN);

  if (!COMMENT_MEDIA_TYPES.has(mediaType)) {
    throw new Error("Unsupported comment media type.");
  }

  if (!mediaMimeType.startsWith(`${mediaType}/`)) {
    throw new Error("comment media MIME type must match the selected image or video type.");
  }

  if (!dataUrlMatch || dataUrlMatch[1].toLowerCase() !== mediaMimeType) {
    throw new Error("comment media must be a valid base64 data URL.");
  }

  const calculatedSize = Buffer.from(dataUrlMatch[2], "base64").byteLength;
  const suppliedSize = Number(media.size);
  const mediaSize = Number.isFinite(suppliedSize) && suppliedSize > 0
    ? Math.floor(suppliedSize)
    : calculatedSize;

  if (mediaSize > COMMENT_MEDIA_MAX_BYTES || calculatedSize > COMMENT_MEDIA_MAX_BYTES) {
    throw new Error("comment media file is too large.");
  }

  return {
    mediaType,
    mediaMimeType,
    mediaName,
    mediaSize,
    mediaUrl
  };
}

export function normaliseCommentPayload({ toiletId, commentText, media = null }) {
  const safeToiletId = normaliseText(toiletId);
  const safeCommentText = typeof commentText === "string" ? commentText.trim() : "";

  if (!safeToiletId || !safeCommentText) {
    throw new Error("toiletId and commentText are required.");
  }

  return {
    toiletId: safeToiletId,
    commentText: safeCommentText,
    ...normaliseCommentMedia(media)
  };
}

function normaliseRating(value) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("rating must be an integer from 1 to 5.");
  }
  return rating;
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
  cleanlinessScoringModel
}) {
  const legacyRatingTotal = Number(row.cleanliness_yes_count ?? 0) * 5 + Number(row.cleanliness_no_count ?? 0);
  const legacyRatingCount = Number(row.cleanliness_yes_count ?? 0) + Number(row.cleanliness_no_count ?? 0);
  const previousRatingTotal = Number(row.cleanliness_rating_total ?? legacyRatingTotal);
  const previousRatingCount = Number(row.cleanliness_rating_count ?? legacyRatingCount);
  const ratingTotal = Math.max(previousRatingTotal, 0) + rating;
  const ratingCount = Math.max(previousRatingCount, 0) + 1;
  const cleanliness = calculateCleanlinessScore({
    rating,
    ratingTotal,
    ratingCount,
    previousCleanliness: row.cleanliness,
    scoringModel: cleanlinessScoringModel
  });

  return { cleanliness, ratingTotal, ratingCount };
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
