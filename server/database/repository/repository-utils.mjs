import { normaliseText } from "../mapper/toilet-mapper.mjs";
import { calculateCleanlinessScore } from "../scoring/cleanliness-scoring.mjs";

export function normaliseSearchQuery(search) {
  return normaliseText(search).toLowerCase();
}

export function normaliseCleanlinessSurveyPayload({ toiletId = null, toiletName = "", answer }) {
  const safeToiletId = normaliseText(toiletId);
  const safeToiletName = normaliseText(toiletName).replace(/\s+Toilet$/i, "");
  const safeAnswer = normaliseText(answer).toLowerCase();

  if (safeAnswer !== "yes" && safeAnswer !== "no") {
    throw new Error("answer must be yes or no.");
  }

  return { safeToiletId, safeToiletName, safeAnswer };
}

export function toCleanlinessUpdate({
  row,
  answer,
  cleanlinessScoringModel
}) {
  const yesCount = Number(row.cleanliness_yes_count ?? 0) + (answer === "yes" ? 1 : 0);
  const noCount = Number(row.cleanliness_no_count ?? 0) + (answer === "no" ? 1 : 0);
  const cleanliness = calculateCleanlinessScore({
    yesCount,
    noCount,
    previousCleanliness: row.cleanliness,
    answer,
    scoringModel: cleanlinessScoringModel
  });

  return { cleanliness, yesCount, noCount };
}

export function mapCleanlinessSurveyResponse({ row, cleanliness, yesCount, noCount, cleanlinessScoringModel }) {
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
