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
    const longFilterInput = { checked: false, value: "long" };
    const controller = createFeedbackThreadController({
      commentsList,
      commentsSummary,
      commentSortSelect,
      commentFilterInputs: [longFilterInput]
    });

    controller.renderComments([
      {
        id: 1,
        author_name: "Demo",
        comment_text: "Plain feedback",
        created_at: "2026-06-01T10:00:00.000Z",
        like_count: 0
      },
      {
        id: 2,
        author_name: "Demo",
        cleanliness_rating: 4.5,
        comment_text: "Detailed feedback ".repeat(10),
        created_at: "2026-06-02T10:00:00.000Z",
        like_count: 0,
        dislike_count: 3,
        viewer_has_disliked: true,
      }
    ]);

    assert.equal(commentsSummary.textContent, "2 feedback - Newest");
    assert.equal(commentsList.children.length, 2);
    assert.equal(commentsList.children[0].dataset.commentId, "2");
    const rating = commentsList.children[0].children[0].children[0].children
      .find((child) => child.className === "comment-rating");
    assert.equal(rating?.children.length, 5);
    assert.equal(rating?.children[3].className, "rating-star is-full");
    assert.equal(rating?.children[4].className, "rating-star is-half");
    assert.equal(rating?.children[4].textContent, "\u2606");
    assert.equal(rating?.attributes["aria-label"], "Cleanliness rating 4.5 out of 5");
    const commentActions = commentsList.children[0].children[0].children[1];
    const likeButton = commentActions.children[0];
    assert.equal(likeButton.className, "comment-like-button");
    assert.equal(likeButton.attributes["aria-label"], "Agree with feedback");
    assert.equal(likeButton.children[0].textContent, "agree");
    const dislikeButton = commentActions.children[1];
    assert.equal(dislikeButton.className, "comment-dislike-button");
    assert.equal(dislikeButton.attributes["aria-label"], "Remove disagreement from feedback");
    assert.equal(dislikeButton.attributes["aria-pressed"], "true");
    assert.equal(dislikeButton.classList.contains("is-disliked"), true);
    assert.equal(dislikeButton.children[0].textContent, "disagree");
    assert.equal(dislikeButton.children[1].textContent, "3");

    controller.setCommentFilter("long", true);

    assert.equal(commentsSummary.textContent, "1 of 2 feedback - Newest");
    assert.equal(commentsList.children.length, 1);
    assert.equal(commentsList.children[0].dataset.commentId, "2");

    controller.resetCommentControls();

    assert.equal(longFilterInput.checked, false);
    assert.equal(commentSortSelect.value, "newest");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
