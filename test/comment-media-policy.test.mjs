import assert from "node:assert/strict";
import test from "node:test";
import {
  commentMediaMaxAttachments,
  commentMediaMaxBytes,
  commentMediaMaxVideos,
  getCommentMediaStatus
} from "../src/shared/comment-media-policy.js";
import {
  addCommentMediaFiles,
  validateCommentMediaFile
} from "../src/app/utils/comment-media.js";

function createFile({ name = "proof.png", type = "image/png", size = 1024 } = {}) {
  return { name, type, size };
}

test("comment media policy formats status from shared limits", () => {
  assert.equal(
    getCommentMediaStatus([]),
    `Up to ${commentMediaMaxAttachments} attachments total, including up to ${commentMediaMaxVideos} videos.`
  );

  assert.equal(
    getCommentMediaStatus([{ type: "image" }, { type: "video" }]),
    "2/9 attachments selected. Images 1/9, videos 1/3."
  );
});

test("frontend comment media validation uses shared size and count limits", () => {
  assert.deepEqual(
    validateCommentMediaFile(createFile({ name: "notes.txt", type: "text/plain" })),
    { error: "notes.txt is not an image or video." }
  );

  assert.deepEqual(
    validateCommentMediaFile(createFile({ name: "large.png", size: commentMediaMaxBytes + 1 })),
    { error: "large.png is over 8 MB." }
  );

  const selectedMedia = Array.from({ length: commentMediaMaxAttachments }, () => ({ type: "image" }));
  assert.deepEqual(
    validateCommentMediaFile(createFile(), selectedMedia),
    { error: "You can attach up to 9 files total." }
  );
});

test("frontend comment media selection reports the last rejected file without mutating inputs", () => {
  const existingMedia = [{ id: "existing", type: "video", file: createFile({ type: "video/mp4" }) }];
  const result = addCommentMediaFiles({
    files: [
      createFile({ name: "sink.png", type: "image/png" }),
      createFile({ name: "notes.txt", type: "text/plain" })
    ],
    selectedMedia: existingMedia,
    createObjectUrl: (file) => `blob:${file.name}`,
    createId: () => "new-media"
  });

  assert.equal(existingMedia.length, 1);
  assert.equal(result.selectedMedia.length, 2);
  assert.equal(result.selectedMedia[1].previewUrl, "blob:sink.png");
  assert.equal(result.statusMessage, "notes.txt is not an image or video.");
});
