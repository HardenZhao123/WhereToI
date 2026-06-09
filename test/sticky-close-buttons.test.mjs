import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile("src/styles.css", "utf8");

function cssRuleFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\}`));
  return match?.groups?.body ?? "";
}

function assertStickyHeader(selector) {
  const rule = cssRuleFor(selector);

  assert.match(rule, /position:\s*sticky;/, `${selector} should remain visible while its panel scrolls.`);
  assert.match(rule, /top:\s*0;/, `${selector} should stay in its original top position.`);
  assert.match(rule, /z-index:\s*12;/, `${selector} should stay above scrolled panel content.`);
  assert.match(rule, /background:/, `${selector} should cover content scrolling underneath it.`);
}

test("subpage close-button headers stay sticky inside scrollable panels", () => {
  assertStickyHeader(".details-header");
  assertStickyHeader(".comment-composer-header");
  assertStickyHeader(".visual-feedback-header");
  assertStickyHeader(".auth-dialog > header");
});
