const defaultCleanlinessScore = 3;
const maxStarRating = 5;
const fullStar = "\u2605";
const emptyStar = "\u2606";

function normaliseLegacyScore(score) {
  if (score > maxStarRating && score <= 10) {
    return score / 2;
  }

  return score;
}

function clampCleanlinessScore(score) {
  return Math.min(Math.max(score, 0), maxStarRating);
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
  const full = Math.min(Math.floor(rating), maxStarRating);
  const half = 0;
  const empty = Math.max(maxStarRating - full, 0);

  return { full, half, empty };
}

function getDisplayRating(rating) {
  const rounded = Math.round(rating * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

export function getCleanlinessScore(toilet) {
  const surveyAverage = getSurveyAverage(toilet);
  if (Number.isFinite(surveyAverage)) {
    return clampCleanlinessScore(surveyAverage);
  }

  if (toilet?.cleanliness === null) return 0;

  const score = Number(toilet?.cleanliness);
  if (!Number.isFinite(score)) return defaultCleanlinessScore;
  return clampCleanlinessScore(normaliseLegacyScore(score));
}

export function getCleanlinessVisualLevel(toilet) {
  const score = getCleanlinessScore(toilet);
  if (!Number.isFinite(score)) return defaultCleanlinessScore;

  const visualLevel = Math.round(score * 2) / 2;
  return Math.min(Math.max(visualLevel, 0.5), maxStarRating);
}

export function getCleanlinessStars(toilet) {
  const rating = getCleanlinessScore(toilet);
  const displayRating = getDisplayRating(rating);
  const { full, half, empty } = getStarCounts(rating);

  return {
    rating,
    displayRating,
    maxRating: maxStarRating,
    full,
    half,
    empty,
    text: `${fullStar.repeat(full)}${emptyStar.repeat(empty)}`
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
