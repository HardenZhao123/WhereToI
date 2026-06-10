import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

async function readCssWithImports(filePath, seen = new Set()) {
  const fullPath = resolve(filePath);
  if (seen.has(fullPath)) return "";
  seen.add(fullPath);

  const content = await readFile(fullPath, "utf8");
  const importPattern = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?[^;]*;/g;
  let output = "";
  let lastIndex = 0;

  for (const match of content.matchAll(importPattern)) {
    output += content.slice(lastIndex, match.index);
    const specifier = match[1].split("?")[0];
    if (!/^(?:https?:)?\/\//.test(specifier)) {
      output += await readCssWithImports(resolve(dirname(fullPath), specifier), seen);
    }
    lastIndex = match.index + match[0].length;
  }

  return output + content.slice(lastIndex);
}

const css = await readCssWithImports("src/styles.css");
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
  assertHeaderNotSticky(".auth-dialog > header");
});

test("sticky close buttons are direct panel controls, not part of scrolling header content", () => {
  const detailPanelStart = html.indexOf("id=\"details-card\"");
  const detailCloseIndex = html.indexOf("id=\"close-details\"", detailPanelStart);
  const detailHeaderIndex = html.indexOf("class=\"details-header\"", detailPanelStart);

  const commentPanelStart = html.indexOf("id=\"comment-composer\"");
  const commentCloseIndex = html.indexOf("id=\"close-comment-composer\"", commentPanelStart);
  const commentHeaderIndex = html.indexOf("class=\"comment-composer-header\"", commentPanelStart);

  assert.ok(detailCloseIndex > detailPanelStart && detailCloseIndex < detailHeaderIndex);
  assert.ok(commentCloseIndex > commentPanelStart && commentCloseIndex < commentHeaderIndex);

  assert.match(html, /class="close-button sticky-close-button" id="close-details"/);
  assert.match(html, /class="close-button sticky-close-button" id="close-comment-composer"/);
});
