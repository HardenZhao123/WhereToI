import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCleanlinessRating,
  getCleanlinessScore,
  getCleanlinessStars
} from "../src/app/utils/cleanliness.js";

test("formats cleanliness as a 1-5 star rating", () => {
  const toilet = { cleanliness: 4 };

  assert.deepEqual(getCleanlinessStars(toilet), {
    rating: 4,
    maxRating: 5,
    filled: "★★★★",
    empty: "☆"
  });
  assert.equal(formatCleanlinessRating(toilet), "★★★★☆ 4/5");
});

test("normalises missing and legacy cleanliness scores to star ratings", () => {
  assert.equal(getCleanlinessScore({}), 3);
  assert.equal(getCleanlinessScore({ cleanliness: 9.4 }), 5);
  assert.equal(getCleanlinessScore({ cleanliness: "bad" }), 3);
});

test("keeps existing score available for internal cleanliness sorting", () => {
  assert.equal(getCleanlinessScore({ cleanliness: 4 }), 4);
  assert.equal(getCleanlinessScore({ cleanliness: 1 }), 1);
});
