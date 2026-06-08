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

const COMMENT_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const COMMENT_MEDIA_MAX_ATTACHMENTS = 9;
const COMMENT_MEDIA_MAX_VIDEOS = 3;
const COMMENT_MEDIA_MAX_IMAGES = 9;
const COMMENT_MEDIA_TYPES = new Set(["image", "video"]);
const COMMENT_MEDIA_DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/;
const COMMENT_VISIBILITIES = new Set(["real", "anonymous"]);
const COMMENT_PROFILE_VISIBILITIES = new Set(["private", "public"]);
export const ANONYMOUS_COMMENT_AUTHOR = "Anonymous";

function normaliseCommentMediaAttachment(media) {
  if (typeof media !== "object" || Array.isArray(media) || media === null) {
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
    type: mediaType,
    mimeType: mediaMimeType,
    name: mediaName,
    size: mediaSize,
    dataUrl: mediaUrl
  };
}

function normaliseCommentMedia(media = null) {
  const rawAttachments =
    media === null || media === undefined
      ? []
      : Array.isArray(media) ? media : [media];

  if (rawAttachments.length > COMMENT_MEDIA_MAX_ATTACHMENTS) {
    throw new Error("comment media can include at most 9 attachments.");
  }

  const attachments = rawAttachments.map(normaliseCommentMediaAttachment);
  const videoCount = attachments.filter((attachment) => attachment.type === "video").length;
  const imageCount = attachments.filter((attachment) => attachment.type === "image").length;

  if (videoCount > COMMENT_MEDIA_MAX_VIDEOS) {
    throw new Error("comment media can include at most 3 videos.");
  }

  if (imageCount > COMMENT_MEDIA_MAX_IMAGES) {
    throw new Error("comment media can include at most 9 images.");
  }

  const firstAttachment = attachments[0] ?? null;

  if (!firstAttachment) {
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

  return {
    mediaAttachments: attachments,
    mediaAttachmentsJson: JSON.stringify(attachments),
    mediaType: firstAttachment.type,
    mediaMimeType: firstAttachment.mimeType,
    mediaName: firstAttachment.name,
    mediaSize: firstAttachment.size,
    mediaUrl: firstAttachment.dataUrl
  };
}

function parseCommentMediaAttachments(row) {
  if (Array.isArray(row.media_attachments)) {
    return row.media_attachments;
  }

  if (typeof row.media_attachments === "string" && row.media_attachments.trim()) {
    try {
      const parsed = JSON.parse(row.media_attachments);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  if (row.media_url && row.media_type && row.media_mime_type) {
    return [
      {
        type: row.media_type,
        mimeType: row.media_mime_type,
        name: row.media_name ?? "attachment",
        size: Number(row.media_size ?? 0),
        dataUrl: row.media_url
      }
    ];
  }

  return [];
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
      Number.isInteger(cleanlinessRating) && cleanlinessRating >= 1 && cleanlinessRating <= 5
        ? cleanlinessRating
        : null,
    like_count: Number(row.like_count ?? 0),
    viewer_has_liked: Boolean(row.viewer_has_liked),
    media_attachments: parseCommentMediaAttachments(row)
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
  cleanlinessRating
}) {
  const safeToiletId = normaliseText(toiletId);
  const safeCommentText = typeof commentText === "string" ? commentText.trim() : "";

  if (!safeToiletId || !safeCommentText) {
    throw new Error("toiletId and commentText are required.");
  }

  return {
    toiletId: safeToiletId,
    commentText: safeCommentText,
    commentVisibility: normaliseCommentVisibility(commentVisibility),
    cleanlinessRating: normaliseRating(cleanlinessRating),
    ...normaliseCommentMedia(media)
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

export function getCleanlinessRangeStartDate(range = "3days") {
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
