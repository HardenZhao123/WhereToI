import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCleanlinessRating,
  getCleanlinessScore,
  getCleanlinessStars
} from "../src/app/utils/cleanliness.js";

const fullStar = "\u2605";
const emptyStar = "\u2606";
const halfStar = "\u00bd";

test("formats cleanliness as a 1-5 star rating", () => {
  const toilet = { cleanliness: 4 };

  assert.deepEqual(getCleanlinessStars(toilet), {
    rating: 4,
    displayRating: "4.0",
    maxRating: 5,
    full: 4,
    half: 0,
    empty: 1,
    text: `${fullStar.repeat(4)}${emptyStar}`
  });
  assert.equal(formatCleanlinessRating(toilet), `${fullStar.repeat(4)}${emptyStar} 4.0/5`);
});

test("formats cleanliness survey averages with one decimal and a half star", () => {
  const toilet = {
    cleanliness: 4,
    cleanlinessSurvey: {
      ratingTotal: 7,
      ratingCount: 2
    }
  };

  assert.equal(getCleanlinessScore(toilet), 3.5);
  assert.deepEqual(getCleanlinessStars(toilet), {
    rating: 3.5,
    displayRating: "3.5",
    maxRating: 5,
    full: 3,
    half: 1,
    empty: 1,
    text: `${fullStar.repeat(3)}${halfStar}${emptyStar}`
  });
  assert.equal(formatCleanlinessRating(toilet), `${fullStar.repeat(3)}${halfStar}${emptyStar} 3.5/5`);
});

test("normalises missing and legacy cleanliness scores to star ratings", () => {
  assert.equal(getCleanlinessScore({}), 3);
  assert.equal(getCleanlinessScore({ cleanliness: 9.4 }), 4.7);
  assert.equal(getCleanlinessScore({ cleanliness: "bad" }), 3);
});

test("keeps existing score available for internal cleanliness sorting", () => {
  assert.equal(getCleanlinessScore({ cleanliness: 4 }), 4);
  assert.equal(getCleanlinessScore({ cleanliness: 1 }), 1);
});
