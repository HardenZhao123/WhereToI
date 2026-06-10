import assert from "node:assert/strict";
import test from "node:test";
import { createFeedbackThreadController } from "../src/app/controllers/feedback-thread-controller.js";

function createClassList() {
  const classes = new Set();

  return {
    add(className) {
      classes.add(className);
    },
    remove(className) {
      classes.delete(className);
    },
    toggle(className, enabled) {
      if (enabled) {
        classes.add(className);
      } else {
        classes.delete(className);
      }
    },
    contains(className) {
      return classes.has(className);
    }
  };
}

function createElement(tagName = "div") {
  return {
    tagName,
    children: [],
    className: "",
    textContent: "",
    hidden: false,
    dataset: {},
    classList: createClassList(),
    attributes: {},
    style: {},
    addEventListener() {},
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    scrollIntoView() {},
    get childElementCount() {
      return this.children.length;
    }
  };
}

test("feedback thread controller renders and filters comment threads", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  globalThis.document = {
    createElement
  };
  globalThis.window = {
    setTimeout(callback) {
      callback();
    }
  };

  try {
    const commentsList = createElement("div");
    const commentsSummary = createElement("p");
    const commentSortSelect = {
      selectedOptions: [{ textContent: "Newest" }],
      value: "newest"
    };
    const mediaFilterInput = { checked: false };
    const controller = createFeedbackThreadController({
      commentsList,
      commentsSummary,
      commentSortSelect,
      commentFilterInputs: [mediaFilterInput]
    });

    controller.renderComments([
      {
        id: 1,
        author_name: "Demo",
        comment_text: "Plain feedback",
        created_at: "2026-06-01T10:00:00.000Z",
        like_count: 0,
        media_attachments: []
      },
      {
        id: 2,
        author_name: "Demo",
        cleanliness_rating: 4.5,
        comment_text: "Photo feedback",
        created_at: "2026-06-02T10:00:00.000Z",
        like_count: 0,
        media_attachments: [
          {
            type: "image",
            mimeType: "image/png",
            name: "sink.png",
            dataUrl: "data:image/png;base64,aW1hZ2U="
          }
        ]
      }
    ]);

    assert.equal(commentsSummary.textContent, "2 feedback - Newest");
    assert.equal(commentsList.children.length, 2);
    assert.equal(commentsList.children[0].dataset.commentId, "2");
    const rating = commentsList.children[0].children[0].children[0].children
      .find((child) => child.className === "comment-rating");
    assert.equal(rating?.textContent, "\u2605\u2605\u2605\u2605\u00bd");
    assert.equal(rating?.attributes["aria-label"], "Cleanliness rating 4.5 out of 5");

    controller.setCommentFilter("media", true);

    assert.equal(commentsSummary.textContent, "1 of 2 feedback - Newest");
    assert.equal(commentsList.children.length, 1);
    assert.equal(commentsList.children[0].dataset.commentId, "2");

    controller.resetCommentControls();

    assert.equal(mediaFilterInput.checked, false);
    assert.equal(commentSortSelect.value, "newest");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
