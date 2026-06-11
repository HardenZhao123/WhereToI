import assert from "node:assert/strict";
import test from "node:test";
import { buildCommentSummaryPrompt } from "../server/ai-service.mjs";

test("AI comment summary gives highly liked feedback more prompt weight", () => {
  const prompt = buildCommentSummaryPrompt([
    { comment_text: "The cubicle was clean.", like_count: 1 },
    { comment_text: "The accessible entrance was locked.", like_count: 15 },
    { comment_text: "Soap was available.", like_count: 3 }
  ]);

  assert.ok(prompt);
  assert.match(prompt, /community weight/);
  assert.match(prompt, /15 likes; community weight 5\.00/);
  assert.match(prompt, /3 likes; community weight 3\.00/);
  assert.match(prompt, /1 like; community weight 2\.00/);
  assert.ok(
    prompt.indexOf("The accessible entrance was locked.") < prompt.indexOf("Soap was available."),
    "higher-liked feedback should appear first"
  );
  assert.ok(
    prompt.indexOf("Soap was available.") < prompt.indexOf("The cubicle was clean."),
    "feedback should remain ordered by descending likes"
  );
  assert.match(prompt, /not proof that a claim is true/);
  assert.match(prompt, /Never omit a lower-weight safety, accessibility, or urgent access concern/);
});

test("AI comment summary ignores empty text and normalises invalid like counts", () => {
  const prompt = buildCommentSummaryPrompt([
    { comment_text: "   ", like_count: 100 },
    { comment_text: "Queue moved quickly.", like_count: -4 },
    { comment_text: "Dryer was broken.", like_count: "invalid" }
  ]);

  assert.ok(prompt);
  assert.doesNotMatch(prompt, /100 likes/);
  assert.match(prompt, /0 likes; community weight 1\.00.*Queue moved quickly\./);
  assert.match(prompt, /0 likes; community weight 1\.00.*Dryer was broken\./);
});

test("AI comment summary prompt is absent without written comments", () => {
  assert.equal(buildCommentSummaryPrompt([]), null);
  assert.equal(buildCommentSummaryPrompt([{ comment_text: "", like_count: 8 }]), null);
});
