import assert from "node:assert/strict";
import test from "node:test";
import {
  commentLongTextMinLength,
  filterAndSortComments,
  getCommentMediaAttachments,
  isLongComment
} from "../src/app/utils/comments.js";

const baseComments = [
  {
    id: 1,
    comment_text: "Older comment",
    created_at: "2026-06-01T10:00:00.000Z",
    like_count: 8,
    media_attachments: []
  },
  {
    id: 2,
    comment_text: "Middle comment with media",
    created_at: "2026-06-02T10:00:00.000Z",
    like_count: 2,
    media_attachments: [{ type: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" }]
  },
  {
    id: 3,
    comment_text: "Newest comment",
    created_at: "2026-06-03T10:00:00.000Z",
    like_count: 2,
    media_attachments: []
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

test("comment utilities filter comments with media", () => {
  const filtered = filterAndSortComments(baseComments, { filters: ["media"] });

  assert.deepEqual(filtered.map((comment) => comment.id), [2]);
});

test("comment utilities filter long comments", () => {
  const longComment = {
    id: 4,
    comment_text: "A".repeat(commentLongTextMinLength),
    created_at: "2026-06-04T10:00:00.000Z",
    like_count: 0,
    media_attachments: []
  };

  assert.equal(isLongComment(longComment), true);
  assert.deepEqual(filterAndSortComments([...baseComments, longComment], { filters: ["long"] }), [longComment]);
});

test("comment utilities read legacy single media fields", () => {
  const attachments = getCommentMediaAttachments({
    media_type: "video",
    media_mime_type: "video/mp4",
    media_name: "queue.mp4",
    media_url: "data:video/mp4;base64,dmlkZW8="
  });

  assert.deepEqual(attachments, [
    {
      type: "video",
      mimeType: "video/mp4",
      name: "queue.mp4",
      dataUrl: "data:video/mp4;base64,dmlkZW8="
    }
  ]);
});
