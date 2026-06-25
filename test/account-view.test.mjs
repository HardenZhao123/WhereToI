import assert from "node:assert/strict";
import test from "node:test";
import {
  renderAccessHistory,
  renderMyComments,
  renderPublicProfile,
  renderToiletSubmissions
} from "../src/app/views/account-view.js";

class TestElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
    this.className = "";
    this.hidden = false;
    this.type = "";
    this.listeners = {};
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

  addEventListener(eventName, listener) {
    this.listeners[eventName] = listener;
  }

  click() {
    this.listeners.click?.({ currentTarget: this });
  }
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

function findAllByClass(node, className, matches = []) {
  if (node?.className?.split(/\s+/).includes(className)) matches.push(node);
  for (const child of node?.children || []) {
    findAllByClass(child, className, matches);
  }
  return matches;
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
    dislike_count: 1,
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
    assert.deepEqual(
      rating?.children.map((star) => star.className),
      [
        "rating-star is-full",
        "rating-star is-full",
        "rating-star is-full",
        "rating-star is-empty",
        "rating-star is-empty"
      ]
    );
    assert.equal(rating?.attributes["aria-label"], "Cleanliness rating 3 out of 5");
    assert.doesNotMatch(collectText(container), /Rating:|3\/5/);
    assert.match(collectText(container), /2 likes/);
    assert.match(collectText(container), /1 dislikes/);
  });
});

test("account feedback history renders half-star ratings as a visual half star", () => {
  withTestDocument(() => {
    const container = new TestElement("div");

    renderMyComments(container, [createComment({ cleanliness_rating: 3.5 })]);

    const rating = findByClass(container, "profile-feedback-rating");
    assert.equal(rating?.children.length, 5);
    assert.equal(rating?.children[2].className, "rating-star is-full");
    assert.equal(rating?.children[3].className, "rating-star is-half");
    assert.equal(rating?.children[4].className, "rating-star is-empty");
    assert.equal(rating?.attributes["aria-label"], "Cleanliness rating 3.5 out of 5");
  });
});

test("visit history entries with toilet ids open the related toilet", () => {
  withTestDocument(() => {
    const container = new TestElement("div");
    const openedEntries = [];

    renderAccessHistory(
      container,
      [
        {
          id: 12,
          toiletId: "city-guilds",
          toiletName: "City & Guilds building",
          eventType: "Directions",
          amountGbp: 0,
          accessTime: "2026-06-08T10:07:00.000Z"
        }
      ],
      { onOpenToilet: (entry) => openedEntries.push(entry) }
    );

    const historyItem = container.children[0];
    assert.equal(historyItem.tagName, "button");
    assert.equal(historyItem.className, "history-item");
    assert.equal(historyItem.type, "button");
    assert.equal(historyItem.attributes["aria-label"], "Open details for City & Guilds building");

    historyItem.click();
    assert.equal(openedEntries.length, 1);
    assert.equal(openedEntries[0].toiletId, "city-guilds");
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
    assert.deepEqual(
      rating?.children.map((star) => star.className),
      Array(5).fill("rating-star is-full")
    );
    assert.equal(rating?.attributes["aria-label"], "Cleanliness rating 5 out of 5");
    assert.doesNotMatch(collectText(publicProfileCommentsList), /Rating:|5\/5/);
    assert.match(collectText(publicProfileCommentsList), /2 likes/);
    assert.match(collectText(publicProfileCommentsList), /1 dislikes/);
  });
});

test("toilet submission review renders nearby comparisons and external map links", () => {
  withTestDocument(() => {
    const container = new TestElement("div");

    renderToiletSubmissions(container, [{
      id: "user-review-test",
      name: "New station toilet",
      area: "South Kensington",
      lat: 51.4945,
      lng: -0.1745,
      features: { accessible: "Y", free: "Y" },
      hours: { today: "Today 08:00-20:00" },
      hasEntrancePhoto: true,
      entrancePhotoSize: 32145,
      locationAccuracyMetres: 18,
      locationDistanceMetres: 24,
      locationCapturedAt: "2026-06-26T10:15:00.000Z",
      nearbyApprovedToilets: [{
        id: "detail-test",
        name: "Prayer room washroom",
        area: "South Kensington",
        lat: 51.49412,
        lng: -0.17392,
        distanceMetres: 58
      }]
    }]);

    const nearby = findByClass(container, "submission-nearby");
    const closeDistance = findByClass(container, "submission-nearby-distance");
    const mapLinks = findAllByClass(container, "submission-map-link");
    const evidence = findByClass(container, "submission-evidence");
    const evidencePhoto = findByClass(container, "submission-evidence-photo");

    assert.match(collectText(nearby), /Prayer room washroom/);
    assert.match(closeDistance.className, /is-close/);
    assert.match(closeDistance.textContent, /check for duplicate/);
    assert.equal(mapLinks.length, 3);
    assert.match(mapLinks[0].href, /openstreetmap\.org/);
    assert.match(mapLinks[1].href, /google\.com\/maps/);
    assert.equal(mapLinks.every((link) => link.target === "_blank"), true);
    assert.match(collectText(evidence), /GPS accuracy: \+\/- 18 m/);
    assert.match(collectText(evidence), /marker 24 m from device location/);
    assert.match(evidencePhoto.children[0].src, /admin\/toilet-submissions\/photo/);
    assert.equal(evidencePhoto.children[0].loading, "lazy");
  });
});

test("toilet submission review does not treat missing GPS evidence as zero metres", () => {
  withTestDocument(() => {
    const container = new TestElement("div");

    renderToiletSubmissions(container, [{
      id: "legacy-submission",
      name: "Legacy submission",
      area: "Unknown area",
      lat: 51.5,
      lng: -0.18
    }]);

    const evidence = findByClass(container, "submission-evidence");
    assert.match(collectText(evidence), /GPS accuracy unavailable/);
    assert.doesNotMatch(collectText(evidence), /GPS accuracy: \+\/- 0 m/);
    assert.match(collectText(evidence), /No entrance photo provided/);
  });
});
