const defaultCleanlinessScore = 3;
const maxStarRating = 5;

function normaliseLegacyScore(score) {
  if (score > maxStarRating && score <= 10) {
    return Math.round(score / 2);
  }

  return score;
}

export function getCleanlinessScore(toilet) {
  const score = Number(toilet?.cleanliness);
  if (!Number.isFinite(score)) return defaultCleanlinessScore;
  return Math.min(Math.max(normaliseLegacyScore(score), 1), maxStarRating);
}

export function getCleanlinessStars(toilet) {
  const rating = getCleanlinessScore(toilet);
  return {
    rating,
    maxRating: maxStarRating,
    filled: "★".repeat(rating),
    empty: "☆".repeat(maxStarRating - rating)
  };
}

export function formatCleanlinessRating(toilet) {
  const { rating, maxRating, filled, empty } = getCleanlinessStars(toilet);
  return `${filled}${empty} ${rating}/${maxRating}`;
}
