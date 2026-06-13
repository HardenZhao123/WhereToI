import assert from "node:assert/strict";
import test from "node:test";
import {
  commentLongTextMinLength,
  filterAndSortComments,
  isLongComment
} from "../src/app/utils/comments.js";

const baseComments = [
  {
    id: 1,
    comment_text: "Older comment",
    created_at: "2026-06-01T10:00:00.000Z",
    like_count: 8
  },
  {
    id: 2,
    comment_text: "Middle comment",
    created_at: "2026-06-02T10:00:00.000Z",
    like_count: 2
  },
  {
    id: 3,
    comment_text: "Newest comment",
    created_at: "2026-06-03T10:00:00.000Z",
    like_count: 2
  }
];

test("comment utilities sort by newest by default", () => {
  const sorted = filterAndSortComments(baseComments);

  assert.deepEqual(sorted.map((comment) => comment.id), [3, 2, 1]);
});

test("comment utilities can sort by most liked with newest as tie-breaker", () => {
  const sorted = filterAndSortComments(baseComments, { sortMode: "liked" });

  assert.deepEqual(sorted.map((comment) => comment.id), [1, 3, 2]);
});

test("comment utilities filter long comments", () => {
  const longComment = {
    id: 4,
    comment_text: "A".repeat(commentLongTextMinLength),
    created_at: "2026-06-04T10:00:00.000Z",
    like_count: 0
  };

  assert.equal(isLongComment(longComment), true);
  assert.deepEqual(filterAndSortComments([...baseComments, longComment], { filters: ["long"] }), [longComment]);
});
