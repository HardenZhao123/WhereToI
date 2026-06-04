import assert from "node:assert/strict";
import test from "node:test";
import { renderMyComments, renderPublicProfile } from "../src/app/views/account-view.js";

class TestElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
    this.className = "";
    this.hidden = false;
    this.type = "";
    this._textContent = "";
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  append(...children) {
    this._textContent = "";
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this._textContent = "";
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener() {}
}

class TestTextNode {
  constructor(text) {
    this.children = [];
    this.textContent = String(text);
  }
}

function withTestDocument(callback) {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      return new TestElement(tagName);
    },
    createTextNode(text) {
      return new TestTextNode(text);
    }
  };

  try {
    callback();
  } finally {
    globalThis.document = originalDocument;
  }
}

function findByClass(node, className) {
  if (node?.className?.split(/\s+/).includes(className)) return node;
  for (const child of node?.children || []) {
    const match = findByClass(child, className);
    if (match) return match;
  }
  return null;
}

function collectText(node) {
  return `${node?.textContent || ""}${(node?.children || []).map(collectText).join("")}`;
}

function createComment(overrides = {}) {
  return {
    id: 1,
    toilet_name: "City & Guilds building",
    comment_text: "Clean enough.",
    cleanliness_rating: 4,
    like_count: 2,
    created_at: "2026-06-02T18:14:10.000Z",
    comment_visibility: "real",
    profile_visibility: "public",
    is_anonymous: false,
    media: [],
    ...overrides
  };
}

test("account feedback history renders cleanliness ratings as stars", () => {
  withTestDocument(() => {
    const container = new TestElement("div");

    renderMyComments(container, [createComment({ cleanliness_rating: 3 })]);

    const heading = findByClass(container, "profile-feedback-heading");
    const rating = findByClass(heading, "profile-feedback-rating");
    assert.equal(rating?.textContent, "\u2605\u2605\u2605\u2606\u2606");
    assert.equal(rating?.attributes["aria-label"], "Cleanliness rating 3 out of 5");
    assert.doesNotMatch(collectText(container), /Rating:|3\/5/);
  });
});

test("public profiles render feedback ratings as stars", () => {
  withTestDocument(() => {
    const publicProfileUsername = new TestElement("h2");
    const publicProfileSummary = new TestElement("p");
    const publicProfileCommentsList = new TestElement("div");

    renderPublicProfile(
      { publicProfileUsername, publicProfileSummary, publicProfileCommentsList },
      {
        user: { username: "carlie" },
        comments: [createComment({ cleanliness_rating: 5 })]
      }
    );

    const heading = findByClass(publicProfileCommentsList, "profile-feedback-heading");
    const rating = findByClass(heading, "profile-feedback-rating");
    assert.equal(rating?.textContent, "\u2605\u2605\u2605\u2605\u2605");
    assert.equal(rating?.attributes["aria-label"], "Cleanliness rating 5 out of 5");
    assert.doesNotMatch(collectText(publicProfileCommentsList), /Rating:|5\/5/);
  });
});
