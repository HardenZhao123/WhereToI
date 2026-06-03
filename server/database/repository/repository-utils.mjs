import { normaliseText } from "../mapper/toilet-mapper.mjs";
import { calculateCleanlinessScore } from "../scoring/cleanliness-scoring.mjs";

export function normaliseSearchQuery(search) {
  return normaliseText(search).toLowerCase();
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
  userAverageRating = 3,
  userStandardDeviation = 1,
  globalAverageRating = 3,
  globalStandardDeviation = 1,
  cleanlinessScoringModel
}) {
  const legacyRatingTotal = Number(row.cleanliness_yes_count ?? 0) * 5 + Number(row.cleanliness_no_count ?? 0);
  const legacyRatingCount = Number(row.cleanliness_yes_count ?? 0) + Number(row.cleanliness_no_count ?? 0);
  const legacyRatingSumSquares = Number(row.cleanliness_yes_count ?? 0) * 25 + Number(row.cleanliness_no_count ?? 0);

  const previousRatingTotal = Number(row.cleanliness_rating_total ?? legacyRatingTotal);
  const previousRatingCount = Number(row.cleanliness_rating_count ?? legacyRatingCount);
  const previousRatingSumSquares = Number(row.cleanliness_rating_sum_squares ?? legacyRatingSumSquares);

  const ratingTotal = Math.max(previousRatingTotal, 0) + rating;
  const ratingCount = Math.max(previousRatingCount, 0) + 1;
  const ratingSumSquares = Math.max(previousRatingSumSquares, 0) + (rating * rating);

  const cleanliness = calculateCleanlinessScore({
    rating,
    ratingTotal,
    ratingCount,
    previousCleanliness: row.cleanliness,
    userAverageRating,
    userStandardDeviation,
    globalAverageRating,
    globalStandardDeviation,
    scoringModel: cleanlinessScoringModel
  });

  return { cleanliness, ratingTotal, ratingCount, ratingSumSquares };
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
