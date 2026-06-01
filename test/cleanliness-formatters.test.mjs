import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCleanlinessVotes,
  getCleanlinessScore,
  getCleanlinessVoteStats
} from "../src/app/utils/cleanliness.js";

test("formats clean and not clean vote counts with percentages", () => {
  const toilet = {
    cleanlinessSurvey: {
      yes: 18,
      no: 5
    }
  };

  assert.deepEqual(getCleanlinessVoteStats(toilet), {
    cleanCount: 18,
    notCleanCount: 5,
    cleanPercent: 78,
    notCleanPercent: 22,
    total: 23
  });
  assert.equal(formatCleanlinessVotes(toilet), "18 clean (78%) | 5 not clean (22%)");
});

test("formats missing cleanliness votes as zero counts", () => {
  assert.deepEqual(getCleanlinessVoteStats({}), {
    cleanCount: 0,
    notCleanCount: 0,
    cleanPercent: 0,
    notCleanPercent: 0,
    total: 0
  });
  assert.equal(formatCleanlinessVotes({}), "0 clean (0%) | 0 not clean (0%)");
});

test("keeps existing score available for internal cleanliness sorting", () => {
  assert.equal(getCleanlinessScore({ cleanliness: 9.4 }), 9.4);
  assert.equal(getCleanlinessScore({ cleanliness: "bad" }), 7);
});
