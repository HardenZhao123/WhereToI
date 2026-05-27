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

  return normaliseScoringModel(modelType || "average");
}

export function calculateCleanlinessScore({
  yesCount,
  noCount,
  previousCleanliness = 3,
  answer,
  scoringModel = null
}) {
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
