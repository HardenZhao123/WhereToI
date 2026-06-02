import { normaliseText } from "../mapper/toilet-mapper.mjs";

function clampCleanlinessScore(value) {
  return Math.min(Math.max(Math.round(value), 1), 5);
}

export function normaliseScoringModel(scoringModel = null) {
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

  if (modelType === "mean_centering") {
    return { type: "mean_centering" };
  }

  throw new Error("Unsupported scoringModel type.");
}

export function getConfiguredCleanlinessScoringModel() {
  const modelType = normaliseText(process.env.WHERETOI_CLEANLINESS_SCORING_MODEL).toLowerCase();

  if (modelType === "ema" || modelType === "exponential_moving_average") {
    return normaliseScoringModel({
      type: "ema",
      alpha: process.env.WHERETOI_CLEANLINESS_EMA_ALPHA
    });
  }

  if (modelType === "mean_centering") {
    return { type: "mean_centering" };
  }

  return normaliseScoringModel(modelType || "average");
}

export function calculateCleanlinessScore({
  rating,
  ratingTotal,
  ratingCount,
  previousCleanliness = 3,
  userAverageRating = 3,
  scoringModel = null
}) {
  const model = normaliseScoringModel(scoringModel);
  const safeRating = clampCleanlinessScore(rating);

  if (model.type === "ema") {
    const previousScore = Number.isFinite(Number(previousCleanliness)) ? Number(previousCleanliness) : 3;
    return clampCleanlinessScore(model.alpha * safeRating + (1 - model.alpha) * previousScore);
  }

  if (model.type === "mean_centering") {
    const globalAverage = 3;
    const adjustedRating = safeRating - (userAverageRating - globalAverage);
    
    const safeRatingTotal = Number(ratingTotal);
    const safeRatingCount = Number(ratingCount);
    if (!Number.isFinite(safeRatingTotal) || !Number.isFinite(safeRatingCount) || safeRatingCount <= 0) {
      return clampCleanlinessScore(adjustedRating);
    }

    const previousTotal = safeRatingTotal - safeRating;
    return clampCleanlinessScore((previousTotal + adjustedRating) / safeRatingCount);
  }

  const safeRatingTotal = Number(ratingTotal);
  const safeRatingCount = Number(ratingCount);
  if (!Number.isFinite(safeRatingTotal) || !Number.isFinite(safeRatingCount) || safeRatingCount <= 0) {
    return safeRating;
  }

  return clampCleanlinessScore(safeRatingTotal / safeRatingCount);
}
