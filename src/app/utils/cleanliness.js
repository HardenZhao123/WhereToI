const defaultCleanlinessScore = 3;
const maxStarRating = 5;
const fullStar = "\u2605";
const emptyStar = "\u2606";
const halfStar = "\u00bd";

function normaliseLegacyScore(score) {
  if (score > maxStarRating && score <= 10) {
    return score / 2;
  }

  return score;
}

function clampCleanlinessScore(score) {
  return Math.min(Math.max(score, 1), maxStarRating);
}

function getSurveyAverage(toilet) {
  const ratingTotal = Number(toilet?.cleanlinessSurvey?.ratingTotal);
  const ratingCount = Number(toilet?.cleanlinessSurvey?.ratingCount);

  if (!Number.isFinite(ratingTotal) || !Number.isFinite(ratingCount) || ratingCount <= 0) {
    return null;
  }

  return ratingTotal / ratingCount;
}

function getStarCounts(rating) {
  const full = Math.floor(rating);
  const half = rating > full && full < maxStarRating ? 1 : 0;
  const empty = Math.max(maxStarRating - full - half, 0);

  return { full, half, empty };
}

function getDisplayRating(rating) {
  return Number(rating.toFixed(1));
}

export function getCleanlinessScore(toilet) {
  const surveyAverage = getSurveyAverage(toilet);
  if (Number.isFinite(surveyAverage)) {
    return clampCleanlinessScore(surveyAverage);
  }

  const score = Number(toilet?.cleanliness);
  if (!Number.isFinite(score)) return defaultCleanlinessScore;
  return clampCleanlinessScore(normaliseLegacyScore(score));
}

export function getCleanlinessStars(toilet) {
  const rating = getDisplayRating(getCleanlinessScore(toilet));
  const { full, half, empty } = getStarCounts(rating);

  return {
    rating,
    displayRating: rating.toFixed(1),
    maxRating: maxStarRating,
    full,
    half,
    empty,
    text: `${fullStar.repeat(full)}${half ? halfStar : ""}${emptyStar.repeat(empty)}`
  };
}

export function getCleanlinessRatingCount(toilet) {
  const ratingCount = Number(toilet?.cleanlinessSurvey?.ratingCount);
  if (!Number.isFinite(ratingCount) || ratingCount <= 0) return 0;
  return Math.floor(ratingCount);
}

export function formatCleanlinessRatingCount(toilet) {
  const ratingCount = getCleanlinessRatingCount(toilet);
  return `${ratingCount} ${ratingCount === 1 ? "rating" : "ratings"}`;
}

export function formatCleanlinessRating(toilet) {
  const { displayRating, maxRating, text } = getCleanlinessStars(toilet);
  return `${text} ${displayRating}/${maxRating} · ${formatCleanlinessRatingCount(toilet)}`;
}
