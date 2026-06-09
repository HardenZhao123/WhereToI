import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile("src/styles.css", "utf8");
const html = await readFile("index.html", "utf8");

function cssRuleFor(selector) {
  const blocks = css.matchAll(/(?<selectors>[^{}]+)\{(?<body>[\s\S]*?)\}/g);

  for (const block of blocks) {
    const selectors = block.groups.selectors
      .split(",")
      .map((value) => value.trim());

    if (selectors.includes(selector)) {
      return block.groups.body;
    }
  }

  return "";
}

function assertStickyCloseButton(selector) {
  const rule = cssRuleFor(selector);

  assert.match(rule, /position:\s*sticky;/, `${selector} should remain visible while its panel scrolls.`);
  assert.match(rule, /top:\s*0;/, `${selector} should stay in its original top position.`);
  assert.match(rule, /z-index:\s*12;/, `${selector} should stay above scrolled panel content.`);
}

function assertHeaderNotSticky(selector) {
  const rule = cssRuleFor(selector);

  assert.doesNotMatch(rule, /position:\s*sticky;/, `${selector} content should scroll away normally.`);
}

test("only subpage close buttons stay sticky inside scrollable panels", () => {
  assertStickyCloseButton(".sticky-close-button");

  assertHeaderNotSticky(".details-header");
  assertHeaderNotSticky(".comment-composer-header");
  assertHeaderNotSticky(".visual-feedback-header");
  assertHeaderNotSticky(".auth-dialog > header");
});

test("sticky close buttons are direct panel controls, not part of scrolling header content", () => {
  const detailPanelStart = html.indexOf("id=\"details-card\"");
  const detailCloseIndex = html.indexOf("id=\"close-details\"", detailPanelStart);
  const detailHeaderIndex = html.indexOf("class=\"details-header\"", detailPanelStart);

  const commentPanelStart = html.indexOf("id=\"comment-composer\"");
  const commentCloseIndex = html.indexOf("id=\"close-comment-composer\"", commentPanelStart);
  const commentHeaderIndex = html.indexOf("class=\"comment-composer-header\"", commentPanelStart);

  const visualPanelStart = html.indexOf("id=\"visual-feedback-panel\"");
  const visualCloseIndex = html.indexOf("id=\"close-visual-feedback\"", visualPanelStart);
  const visualHeaderIndex = html.indexOf("class=\"visual-feedback-header\"", visualPanelStart);

  assert.ok(detailCloseIndex > detailPanelStart && detailCloseIndex < detailHeaderIndex);
  assert.ok(commentCloseIndex > commentPanelStart && commentCloseIndex < commentHeaderIndex);
  assert.ok(visualCloseIndex > visualPanelStart && visualCloseIndex < visualHeaderIndex);

  assert.match(html, /class="close-button sticky-close-button" id="close-details"/);
  assert.match(html, /class="close-button sticky-close-button" id="close-comment-composer"/);
  assert.match(html, /class="close-button sticky-close-button" id="close-visual-feedback"/);
});
