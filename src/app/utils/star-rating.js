const maxStarRating = 5;

export function getHalfStepRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 0.5 && rating <= maxStarRating && Number.isInteger(rating * 2)
    ? rating
    : null;
}

export function createStarRatingElement(value, className) {
  const rating = getHalfStepRating(value);
  if (rating === null) return null;

  const ratingElement = document.createElement("span");
  ratingElement.className = className;
  ratingElement.setAttribute("aria-label", `Cleanliness rating ${rating} out of ${maxStarRating}`);

  for (let position = 1; position <= maxStarRating; position += 1) {
    const star = document.createElement("span");
    const fill = rating - (position - 1);
    star.className = `rating-star ${fill >= 1 ? "is-full" : fill >= 0.5 ? "is-half" : "is-empty"}`;
    star.textContent = fill >= 1 ? "\u2605" : "\u2606";
    star.setAttribute("aria-hidden", "true");
    ratingElement.append(star);
  }

  return ratingElement;
}
