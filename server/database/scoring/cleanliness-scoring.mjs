import { normaliseText } from "../mapper/toilet-mapper.mjs";

function clampCleanlinessScore(value) {
  return Math.min(Math.max(value, 1), 5);
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

  if (modelType === "z_score") {
    return { type: "z_score" };
  }

  if (modelType === "bias_training") {
    const learningRate = Number(scoringModel?.learningRate ?? 0.01);
    const regularization = Number(scoringModel?.regularization ?? 0.02);
    return { type: "bias_training", learningRate, regularization };
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

  if (modelType === "z_score") {
    return { type: "z_score" };
  }

  if (modelType === "bias_training") {
    return normaliseScoringModel({
      type: "bias_training",
      learningRate: process.env.WHERETOI_CLEANLINESS_BIAS_LEARNING_RATE,
      regularization: process.env.WHERETOI_CLEANLINESS_BIAS_REGULARIZATION
    });
  }

  return normaliseScoringModel(modelType || "average");
}

/* To use mean centering, set
WHERETOI_CLEANLINESS_SCORING_MODEL=mean_centering
in environment
*/

/* To use z-score, set
WHERETOI_CLEANLINESS_SCORING_MODEL=z_score
in environment
*/

/* To use bias model set 
WHERETOI_CLEANLINESS_SCORING_MODEL=bias_training
in environment
*/



export function calculateCleanlinessScore({
  rating,
  ratingTotal,
  ratingCount,
  previousCleanliness = 3,
  userAverageRating = 3,
  userStandardDeviation = 1,
  userBias = 0,
  toiletBias = 0,
  globalAverageRating = 3,
  globalStandardDeviation = 1,
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

  if (model.type === "z_score") {
    const z = (safeRating - userAverageRating) / (userStandardDeviation || 1);
    const adjustedRating = globalStandardDeviation * z + globalAverageRating;

    const safeRatingTotal = Number(ratingTotal);
    const safeRatingCount = Number(ratingCount);
    if (!Number.isFinite(safeRatingTotal) || !Number.isFinite(safeRatingCount) || safeRatingCount <= 0) {
      return clampCleanlinessScore(adjustedRating);
    }

    const previousTotal = safeRatingTotal - safeRating;
    return clampCleanlinessScore((previousTotal + adjustedRating) / safeRatingCount);
  }

  if (model.type === "bias_training") {
    const error = safeRating - (globalAverageRating + userBias + toiletBias);
    const newUserBias = userBias + model.learningRate * (error - model.regularization * userBias);
    const newToiletBias = toiletBias + model.learningRate * (error - model.regularization * toiletBias);
    
    const adjustedRating = globalAverageRating + newToiletBias;

    return {
      cleanliness: clampCleanlinessScore(adjustedRating),
      newUserBias,
      newToiletBias
    };
  }

  const safeRatingTotal = Number(ratingTotal);
  const safeRatingCount = Number(ratingCount);
  if (!Number.isFinite(safeRatingTotal) || !Number.isFinite(safeRatingCount) || safeRatingCount <= 0) {
    return safeRating;
  }

  return clampCleanlinessScore(safeRatingTotal / safeRatingCount);
}
