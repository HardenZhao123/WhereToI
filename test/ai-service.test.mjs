import assert from "node:assert/strict";
import test from "node:test";
import { buildCommentSummaryPrompt } from "../server/ai-service.mjs";

test("AI comment summary balances agreements and disagreements in prompt weight", () => {
  const prompt = buildCommentSummaryPrompt([
    { comment_text: "The cubicle was clean.", like_count: 1, dislike_count: 3, cleanliness_rating: 2.5 },
    { comment_text: "The accessible entrance was locked.", like_count: 15, dislike_count: 0, cleanliness_rating: 4 },
    { comment_text: "Soap was available.", like_count: 3, dislike_count: 1 }
  ]);

  assert.ok(prompt);
  assert.match(prompt, /community weight/);
  assert.match(prompt, /15 agreements; 0 disagreements; community weight 5\.00; community-supported; cleanliness rating 4\/5/);
  assert.match(prompt, /3 agreements; 1 disagreement; community weight 2\.00; community-supported; no cleanliness rating/);
  assert.match(prompt, /1 agreement; 3 disagreements; community weight 0\.25; community-disputed; cleanliness rating 2\.5\/5/);
  assert.ok(
    prompt.indexOf("The accessible entrance was locked.") < prompt.indexOf("Soap was available."),
    "higher-weight feedback should appear first"
  );
  assert.ok(
    prompt.indexOf("Soap was available.") < prompt.indexOf("The cubicle was clean."),
    "dislikes should lower feedback ordering"
  );
  assert.match(prompt, /not proof that a claim is true or false/);
  assert.match(prompt, /Do not present a strongly\s+community-disputed claim as consensus/);
  assert.match(prompt, /Never omit\s+a safety, accessibility, or urgent-access concern solely because it has a low weight/);
  assert.match(prompt, /max\(0\.25, 1 \+ log2\(agreements \+ 1\) - log2\(disagreements \+ 1\)\)/);
  assert.match(prompt, /one short objective paragraph of 2-4 sentences/);
  assert.match(prompt, /If comments conflict, say that feedback is mixed or disputed/);
  assert.match(prompt, /Do not infer facts, causes, opening status, or feature availability/);
});

test("AI comment summary handles balanced reactions and normalises invalid counts", () => {
  const prompt = buildCommentSummaryPrompt([
    { comment_text: "   ", like_count: 100, dislike_count: 0 },
    { comment_text: "Queue moved quickly.", like_count: -4, dislike_count: "invalid" },
    { comment_text: "Dryer was broken.", like_count: 3, dislike_count: 3 }
  ]);

  assert.ok(prompt);
  assert.doesNotMatch(prompt, /100 agreements/);
  assert.match(prompt, /0 agreements; 0 disagreements; community weight 1\.00; no community signal.*Queue moved quickly\./);
  assert.match(prompt, /3 agreements; 3 disagreements; community weight 1\.00; mixed community signal.*Dryer was broken\./);
});

test("AI comment summary prompt is absent without written comments", () => {
  assert.equal(buildCommentSummaryPrompt([]), null);
  assert.equal(buildCommentSummaryPrompt([{ comment_text: "", like_count: 8, dislike_count: 2 }]), null);
});
