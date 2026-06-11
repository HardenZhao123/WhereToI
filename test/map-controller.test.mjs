import assert from "node:assert/strict";
import test from "node:test";
import { createMapController } from "../src/app/controllers/map-controller.js";
import { clearToiletDetailCache } from "../src/app/services/toilets-service.js";

function createClassList() {
  return {
    add() {},
    remove() {},
    toggle() {}
  };
}

function createRecordingClassList() {
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

function createTextElement() {
  return {
    textContent: "",
    dataset: {},
    hidden: false,
    classList: createClassList(),
    setAttribute() {},
    closest() {
      return null;
    },
    append(...children) {
      this.children = [...(this.children ?? []), ...children];
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
}

function createPreviewElement() {
  const toiletSvgClassList = createRecordingClassList();
  const urinalSvgClassList = createRecordingClassList();

  return {
    element: {
      dataset: {},
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      querySelector(selector) {
        if (selector === ".cartoon-toilet-svg") {
          return { classList: toiletSvgClassList };
        }

        if (selector === ".cartoon-urinal-svg") {
          return { classList: urinalSvgClassList };
        }

        return null;
      }
    },
    svgClassList: toiletSvgClassList,
    toiletSvgClassList,
    urinalSvgClassList
  };
}

function createVisualStarRatingElement() {
  const buttons = Array.from({ length: 5 }, (_, index) => {
    const properties = new Map();
    const attributes = {};

    return {
      dataset: { visualStar: String(index + 1) },
      properties,
      attributes,
      classList: createRecordingClassList(),
      style: {
        setProperty(name, value) {
          properties.set(name, value);
        }
      },
      setAttribute(name, value) {
        attributes[name] = String(value);
      }
    };
  });
  const attributes = {};

  return {
    buttons,
    attributes,
    classList: createRecordingClassList(),
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    querySelectorAll(selector) {
      return selector === "[data-visual-star]" ? buttons : [];
    }
  };
}

function createTestToilet() {
  return {
    id: "test-toilet",
    name: "Test toilet",
    area: "Test area",
    lat: 51.5,
    lng: -0.17,
    paid: false,
    cleanliness: 3,
    cleanlinessSurvey: {
      ratingTotal: 0,
      ratingCount: 0
    },
    comment: "Test comment",
    features: {
      women: "Y",
      men: "Y",
      accessible: "Y",
      neutral: "?",
      children: "?",
      babyChanging: "?",
      bidet: "?",
      automatic: "?",
      urinalOnly: "?",
      radarKey: "?",
      free: "Y"
    },
    hours: {
      today: "Today 09:00 - 17:00",
      sat: "Sat Closed",
      sun: "Sun Closed"
    }
  };
}

function assertAssetSrc(actual, expectedPath) {
  assert.equal(String(actual).split("?")[0], expectedPath);
}

function createMapDetailTestHarness() {
  const selectorNames = [
    "#cleanliness-stars",
    "#cleanliness-star-icons",
    "#cleanliness-score",
    "#cleanliness-rating-count",
    "#toilet-name",
    "#toilet-area",
    "#toilet-comment",
    "#feature-women",
    "#feature-men",
    "#feature-accessible",
    "#feature-neutral",
    "#feature-children",
    "#feature-baby-changing",
    "#feature-bidet",
    "#feature-automatic",
    "#feature-urinal-only",
    "#feature-radar-key",
    "#feature-free",
    "#hours-today",
    "#hours-sat",
    "#hours-sun",
    "#distance-line"
  ];
  const elementsBySelector = new Map(selectorNames.map((selector) => [selector, createTextElement()]));

  const detailSectionLinks = ["overview", "comment"].map((section) => {
    const link = createTextElement();
    link.dataset = { detailSection: section };
    link.classList = createRecordingClassList();
    return link;
  });
  const detailPanels = ["overview", "comment"].map((section) => {
    const panel = createTextElement();
    panel.dataset = { detailPanel: section };
    panel.classList = createRecordingClassList();
    return panel;
  });
  const commentsList = createTextElement();
  const commentsSummary = createTextElement();
  const commentSortSelect = {
    selectedOptions: [{ textContent: "Newest" }],
    value: "newest"
  };

  return {
    elementsBySelector,
    elements: {
      statusText: { textContent: "" },
      detailsCard: { classList: createClassList() },
      mapPanel: { classList: createClassList() },
      directionsButton: { disabled: false },
      detailSectionLinks,
      detailPanels,
      commentsList,
      commentsSummary,
      commentSortSelect
    }
  };
}

test("map controller keeps feedback visual state synced with the current selected level", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const { element: visualCleanlinessPreview, toiletSvgClassList: visualSvgClassList } = createPreviewElement();
  const visualCleanlinessState = createTextElement();
  const visualCleanlinessImage = {
    src: "",
    classList: createRecordingClassList()
  };

  globalThis.document = {
    addEventListener() {},
    querySelector() {
      return null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  try {
    const controller = createMapController({
      visualCleanlinessPreview,
      visualCleanlinessImage,
      visualCleanlinessState
    });

    controller.setVisualCleanlinessLevel(4.5);

    assert.equal(visualCleanlinessPreview.dataset.cleanliness, "4.5");
    assertAssetSrc(visualCleanlinessImage.src, "toilet_levels/level_45_small.jpg");
    assert.equal(visualCleanlinessImage.classList.contains("is-hidden"), false);
    assert.equal(visualSvgClassList.contains("is-hidden"), true);
    assert.equal(visualCleanlinessState.textContent, "Very clean - Almost spotless");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("map controller shows half-star affordances before a cleanliness rating is selected", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const visualCleanlinessStars = createVisualStarRatingElement();

  globalThis.document = {
    addEventListener() {},
    querySelector() {
      return null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  try {
    const controller = createMapController({ visualCleanlinessStars });

    controller.setVisualCleanlinessLevel(0);

    assert.equal(visualCleanlinessStars.classList.contains("is-unrated"), true);
    assert.match(visualCleanlinessStars.attributes["aria-label"], /half-star or full-star rating/);
    assert.deepEqual(
      visualCleanlinessStars.buttons.map((button) => button.properties.get("--star-fill")),
      ["50%", "50%", "50%", "50%", "50%"]
    );
    assert.deepEqual(
      visualCleanlinessStars.buttons.map((button) => button.attributes["aria-pressed"]),
      ["false", "false", "false", "false", "false"]
    );

    controller.setVisualCleanlinessLevel(2.5);

    assert.equal(visualCleanlinessStars.classList.contains("is-unrated"), false);
    assert.deepEqual(
      visualCleanlinessStars.buttons.map((button) => button.properties.get("--star-fill")),
      ["100%", "100%", "50%", "0%", "0%"]
    );
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("map controller renders toilet map markers with cleanliness rating images", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const createdIcons = [];
  const markerLayer = {
    addTo() {
      return markerLayer;
    },
    clearLayers() {}
  };
  const fakeMap = {
    setView() {
      return fakeMap;
    },
    getCenter() {
      return { lat: 51.5, lng: -0.17 };
    },
    getBounds() {
      return {
        contains() {
          return true;
        }
      };
    },
    getZoom() {
      return 15;
    },
    on() {
      return fakeMap;
    }
  };

  globalThis.document = {
    addEventListener() {},
    querySelector() {
      return null;
    }
  };
  globalThis.window = {
    L: {
      map() {
        return fakeMap;
      },
      tileLayer() {
        return {
          addTo() {}
        };
      },
      layerGroup() {
        return markerLayer;
      },
      divIcon(options) {
        createdIcons.push(options);
        return options;
      },
      marker() {
        return {
          addTo() {
            return this;
          },
          on() {},
          setIcon() {}
        };
      }
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  try {
    const controller = createMapController({
      statusText: { textContent: "" },
      mapElement: {},
      detailsCard: { classList: createClassList() },
      mapPanel: { classList: createClassList() },
      directionsButton: { disabled: false }
    });
    const toilet = createTestToilet();
    toilet.cleanliness = 4.4;
    toilet.cleanlinessSurvey = {
      ratingTotal: 4.4,
      ratingCount: 1
    };

    assert.equal(controller.createInteractiveMap(), true);
    controller.setToilets([toilet], { cleanlinessRange: "3days" });

    const toiletIcon = createdIcons.find((icon) => icon.className === "map-marker-icon");
    assert.ok(toiletIcon);
    assert.deepEqual(toiletIcon.iconSize, [44, 58]);
    assert.deepEqual(toiletIcon.iconAnchor, [22, 58]);
    assert.match(toiletIcon.html, /class="map-marker"/);
    assert.match(toiletIcon.html, /class="map-marker-image"/);
    assert.match(toiletIcon.html, /src="toilet_levels\/level_45_small\.jpg(?:\?v=[^"]+)?"/);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("map controller keeps visual rating on toilet images for urinal-only toilets", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const { elementsBySelector, elements } = createMapDetailTestHarness();
  const { element: overviewVisualPreview, toiletSvgClassList: overviewSvgClassList } = createPreviewElement();
  const { element: visualCleanlinessPreview, toiletSvgClassList: visualSvgClassList } = createPreviewElement();
  const overviewVisualState = createTextElement();
  const visualCleanlinessState = createTextElement();
  const overviewVisualImage = {
    src: "",
    alt: "",
    classList: createRecordingClassList()
  };
  const visualCleanlinessImage = {
    src: "",
    alt: "",
    classList: createRecordingClassList()
  };

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    setTimeout: globalThis.setTimeout
  };

  try {
    const controller = createMapController({
      ...elements,
      overviewVisualPreview,
      overviewVisualImage,
      overviewVisualState,
      visualCleanlinessPreview,
      visualCleanlinessImage,
      visualCleanlinessState
    });
    const urinalToilet = createTestToilet();
    urinalToilet.features.urinalOnly = "Y";

    controller.setToilets([urinalToilet]);
    await controller.setToilet(urinalToilet.id, { fly: false });

    assertAssetSrc(overviewVisualImage.src, "toilet_levels/level_3_small.jpg");
    assert.equal(overviewVisualImage.alt, "Toilet cleanliness preview: OK");
    assert.equal(overviewVisualPreview.attributes["aria-label"], "Cartoon toilet cleanliness preview: OK");
    assert.equal(overviewSvgClassList.contains("is-hidden"), true);
    assert.equal(overviewVisualState.textContent, "OK - Usable but not spotless");

    assert.equal(visualCleanlinessImage.src, "");
    assert.equal(visualCleanlinessImage.alt, "Toilet cleanliness preview: No rating selected");
    assert.equal(visualCleanlinessPreview.dataset.cleanliness, "0");
    assert.equal(visualCleanlinessPreview.attributes["aria-label"], "Cartoon toilet cleanliness preview: No rating selected");
    assert.equal(visualSvgClassList.contains("is-hidden"), false);
    assert.equal(visualCleanlinessState.textContent, "No rating selected - Choose a cleanliness rating");

    controller.setVisualCleanlinessLevel(5);

    assertAssetSrc(overviewVisualImage.src, "toilet_levels/level_3_small.jpg");
    assert.equal(overviewVisualState.textContent, "OK - Usable but not spotless");
    assertAssetSrc(visualCleanlinessImage.src, "toilet_levels/level_5_small.jpg");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("map controller uses half-star visual rating as the feedback cleanliness rating", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  const { elementsBySelector, elements } = createMapDetailTestHarness();
  const { element: overviewVisualPreview } = createPreviewElement();
  const { element: visualCleanlinessPreview } = createPreviewElement();
  const overviewVisualState = createTextElement();
  const visualCleanlinessState = createTextElement();
  const overviewVisualImage = {
    src: "",
    alt: "",
    classList: createRecordingClassList()
  };
  const visualCleanlinessImage = {
    src: "",
    alt: "",
    classList: createRecordingClassList()
  };

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    setTimeout: globalThis.setTimeout
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

  try {
    const controller = createMapController({
      ...elements,
      overviewVisualPreview,
      overviewVisualImage,
      overviewVisualState,
      visualCleanlinessPreview,
      visualCleanlinessImage,
      visualCleanlinessState
    });

    controller.setToilets([createTestToilet()]);
    await controller.setToilet("test-toilet", { fly: false });

    assert.equal(visualCleanlinessImage.src, "");
    assert.equal(visualCleanlinessImage.alt, "Toilet cleanliness preview: No rating selected");
    assert.equal(visualCleanlinessPreview.dataset.cleanliness, "0");

    controller.selectCleanlinessRating(4.5);

    assertAssetSrc(overviewVisualImage.src, "toilet_levels/level_3_small.jpg");
    assert.equal(overviewVisualState.textContent, "OK - Usable but not spotless");
    assertAssetSrc(visualCleanlinessImage.src, "toilet_levels/level_45_small.jpg");
    assert.equal(visualCleanlinessImage.alt, "Toilet cleanliness preview: Very clean");
    assert.equal(visualCleanlinessPreview.attributes["aria-label"], "Cartoon toilet cleanliness preview: Very clean");
    assert.equal(visualCleanlinessState.textContent, "Very clean - Almost spotless");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
});

test("map controller opens feedback rating at zero instead of the previous local rating", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  const { elementsBySelector, elements } = createMapDetailTestHarness();
  const { element: overviewVisualPreview } = createPreviewElement();
  const { element: visualCleanlinessPreview } = createPreviewElement();
  const overviewVisualState = createTextElement();
  const visualCleanlinessState = createTextElement();
  const overviewVisualImage = {
    src: "",
    alt: "",
    classList: createRecordingClassList()
  };
  const visualCleanlinessImage = {
    src: "",
    alt: "",
    classList: createRecordingClassList()
  };
  const commentComposer = createTextElement();
  commentComposer.hidden = true;
  commentComposer.classList = createRecordingClassList();
  const commentComposerToggle = createTextElement();
  const commentInput = {
    focus() {}
  };

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return JSON.stringify({
          "test-toilet": {
            rating: 4.5,
            toiletName: "Test toilet",
            submittedAt: "2026-06-11T00:00:00.000Z"
          }
        });
      },
      setItem() {}
    },
    setTimeout: globalThis.setTimeout
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

  try {
    const controller = createMapController({
      ...elements,
      commentComposer,
      commentComposerToggle,
      commentInput,
      overviewVisualPreview,
      overviewVisualImage,
      overviewVisualState,
      visualCleanlinessPreview,
      visualCleanlinessImage,
      visualCleanlinessState
    });

    controller.setToilets([createTestToilet()]);
    await controller.setToilet("test-toilet", { fly: false });
    controller.toggleCommentComposer();

    assert.equal(visualCleanlinessPreview.dataset.cleanliness, "0");
    assert.equal(visualCleanlinessImage.src, "");
    assert.equal(visualCleanlinessState.textContent, "No rating selected - Choose a cleanliness rating");

    controller.selectCleanlinessRating(4.5);
    assert.equal(visualCleanlinessPreview.dataset.cleanliness, "4.5");
    assertAssetSrc(visualCleanlinessImage.src, "toilet_levels/level_45_small.jpg");

    controller.closeCommentComposer();
    controller.toggleCommentComposer();

    assert.equal(visualCleanlinessPreview.dataset.cleanliness, "0");
    assert.equal(visualCleanlinessImage.src, "");
    assert.equal(visualCleanlinessState.textContent, "No rating selected - Choose a cleanliness rating");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
});

test("map controller renders overview visual from the toilet cleanliness average", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const { elementsBySelector, elements } = createMapDetailTestHarness();
  const { element: overviewVisualPreview } = createPreviewElement();
  const { element: visualCleanlinessPreview } = createPreviewElement();
  const overviewVisualState = createTextElement();
  const visualCleanlinessState = createTextElement();
  const overviewVisualImage = {
    src: "",
    alt: "",
    classList: createRecordingClassList()
  };
  const visualCleanlinessImage = {
    src: "",
    alt: "",
    classList: createRecordingClassList()
  };

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    setTimeout: globalThis.setTimeout
  };

  try {
    const controller = createMapController({
      ...elements,
      overviewVisualPreview,
      overviewVisualImage,
      overviewVisualState,
      visualCleanlinessPreview,
      visualCleanlinessImage,
      visualCleanlinessState
    });
    const toilet = createTestToilet();
    toilet.cleanlinessSurvey = {
      ratingTotal: 13,
      ratingCount: 4
    };

    controller.setToilets([toilet]);
    await controller.setToilet("test-toilet", { fly: false });

    assert.equal(overviewVisualPreview.dataset.cleanliness, "3.5");
    assertAssetSrc(overviewVisualImage.src, "toilet_levels/level_35_small.jpg");
    assert.equal(overviewVisualState.textContent, "Above average - Decent condition");
    assert.equal(elementsBySelector.get("#cleanliness-score").textContent, "3.25/5");

    const starIcons = elementsBySelector.get("#cleanliness-star-icons").children;
    assert.deepEqual(
      starIcons.map((icon) => icon.className),
      ["star-icon is-full", "star-icon is-full", "star-icon is-full", "star-icon is-half", "star-icon is-empty"]
    );
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("map controller does not create a urinal overview visual rating for men's toilets", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const { elementsBySelector, elements } = createMapDetailTestHarness();
  const { element: overviewVisualPreview } = createPreviewElement();
  const { element: visualCleanlinessPreview } = createPreviewElement();
  const overviewVisualState = createTextElement();
  const visualCleanlinessState = createTextElement();
  const overviewVisualImage = {
    src: "",
    alt: "",
    classList: createRecordingClassList()
  };
  const visualCleanlinessImage = {
    src: "",
    alt: "",
    classList: createRecordingClassList()
  };

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    setTimeout: globalThis.setTimeout
  };

  try {
    const controller = createMapController({
      ...elements,
      overviewVisualPreview,
      overviewVisualImage,
      overviewVisualState,
      visualCleanlinessPreview,
      visualCleanlinessImage,
      visualCleanlinessState
    });

    controller.setToilets([createTestToilet()]);
    await controller.setToilet("test-toilet", { fly: false });

    assertAssetSrc(overviewVisualImage.src, "toilet_levels/level_3_small.jpg");
    assert.equal(overviewVisualState.textContent, "OK - Usable but not spotless");
    assert.equal(visualCleanlinessImage.src, "");
    assert.equal(visualCleanlinessState.textContent, "No rating selected - Choose a cleanliness rating");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("map controller can hide empty details after loading toilets", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  globalThis.document = {
    addEventListener() {},
    querySelector() {
      return null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  try {
    const statusText = { textContent: "" };
    const controller = createMapController({
      statusText,
      detailsCard: { classList: createClassList() },
      mapPanel: { classList: createClassList() },
      directionsButton: { disabled: false }
    });

    assert.doesNotThrow(() => controller.setToilets([createTestToilet()]));
    assert.equal(statusText.textContent, "Showing 1 toilets. 1 visible on map.");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("map controller reloads comments when the feedback section opens", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  const { elementsBySelector, elements } = createMapDetailTestHarness();
  let commentsFetchCount = 0;

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    setTimeout: globalThis.setTimeout
  };
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.startsWith("/api/comments")) {
      commentsFetchCount += 1;
      return {
        ok: true,
        json: async () => ({
          comments: [
            {
              id: 1,
              username: "tester",
              author_name: "tester",
              comment_text: "Clean and easy to find.",
              created_at: "2026-06-09T10:00:00.000Z",
              like_count: 0,
              viewer_has_liked: false,
              can_delete: false
            }
          ]
        })
      };
    }

    throw new Error(`Unexpected request: ${requestUrl}`);
  };

  try {
    const controller = createMapController(elements);
    const testToilet = createTestToilet();

    controller.setToilets([testToilet]);
    await controller.setToilet(testToilet.id, { fly: false });

    assert.equal(commentsFetchCount, 0);
    assert.equal(elements.commentsList.children[0].textContent, "Open Feedback to load comments.");

    controller.setDetailSection("comment");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(commentsFetchCount, 1);
    assert.equal(elements.commentsSummary.textContent, "1 feedback - Newest");
    assert.equal(elements.commentsList.children.length, 1);

    controller.setDetailSection("overview");
    controller.setDetailSection("comment");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(commentsFetchCount, 2);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("map controller keeps submitted rating count after a stale toilet reload", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const elementsBySelector = new Map(
    [
      "#cleanliness-stars",
      "#cleanliness-star-icons",
      "#cleanliness-score",
      "#cleanliness-rating-count",
      "#toilet-name",
      "#toilet-area",
      "#toilet-comment",
      "#feature-women",
      "#feature-men",
      "#feature-accessible",
      "#feature-neutral",
      "#feature-children",
      "#feature-baby-changing",
      "#feature-bidet",
      "#feature-automatic",
      "#feature-urinal-only",
      "#feature-radar-key",
      "#feature-free",
      "#hours-today",
      "#hours-sat",
      "#hours-sun",
      "#distance-line"
    ].map((selector) => [selector, createTextElement()])
  );

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  try {
    const controller = createMapController({
      statusText: { textContent: "" },
      detailsCard: { classList: createClassList() },
      mapPanel: { classList: createClassList() },
      directionsButton: { disabled: false }
    });

    const staleToilet = createTestToilet();
    controller.setToilets([staleToilet]);
    controller.updateToiletCleanliness({
      id: staleToilet.id,
      cleanliness: 4,
      cleanlinessSurvey: {
        ratingTotal: 4,
        ratingCount: 1
      }
    });

    controller.setToilets([staleToilet], { hideDetails: false });
    await controller.setToilet(staleToilet.id, { fly: false });

    assert.equal(elementsBySelector.get("#cleanliness-rating-count").textContent, "1 rating");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("map controller refreshes cleanliness when the rating period changes after a local rating", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const elementsBySelector = new Map(
    [
      "#cleanliness-stars",
      "#cleanliness-star-icons",
      "#cleanliness-score",
      "#cleanliness-rating-count",
      "#toilet-name",
      "#toilet-area",
      "#toilet-comment",
      "#feature-women",
      "#feature-men",
      "#feature-accessible",
      "#feature-neutral",
      "#feature-children",
      "#feature-baby-changing",
      "#feature-bidet",
      "#feature-automatic",
      "#feature-urinal-only",
      "#feature-radar-key",
      "#feature-free",
      "#hours-today",
      "#hours-sat",
      "#hours-sun",
      "#distance-line"
    ].map((selector) => [selector, createTextElement()])
  );

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  try {
    const controller = createMapController({
      statusText: { textContent: "" },
      detailsCard: { classList: createClassList() },
      mapPanel: { classList: createClassList() },
      directionsButton: { disabled: false }
    });

    const threeDayToilet = createTestToilet();
    controller.setToilets([threeDayToilet], { cleanlinessRange: "3days" });
    await controller.setToilet(threeDayToilet.id, { fly: false });
    controller.updateToiletCleanliness({
      id: threeDayToilet.id,
      cleanliness: 4,
      cleanlinessSurvey: {
        ratingTotal: 4,
        ratingCount: 1
      }
    });

    const oneDayToilet = {
      ...threeDayToilet,
      cleanliness: null,
      cleanlinessSurvey: {
        ratingTotal: 0,
        ratingCount: 0
      }
    };
    controller.setToilets([oneDayToilet], { hideDetails: false, cleanlinessRange: "1day" });
    await controller.setToilet(oneDayToilet.id, { fly: false });

    assert.equal(elementsBySelector.get("#cleanliness-rating-count").textContent, "0 ratings");
    assert.equal(elementsBySelector.get("#cleanliness-score").textContent, "3.0/5");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("map controller rating period changes only the selected detail rating", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  const elementsBySelector = new Map(
    [
      "#cleanliness-stars",
      "#cleanliness-star-icons",
      "#cleanliness-score",
      "#cleanliness-rating-count",
      "#toilet-name",
      "#toilet-area",
      "#toilet-comment",
      "#feature-women",
      "#feature-men",
      "#feature-accessible",
      "#feature-neutral",
      "#feature-children",
      "#feature-baby-changing",
      "#feature-bidet",
      "#feature-automatic",
      "#feature-urinal-only",
      "#feature-radar-key",
      "#feature-free",
      "#hours-today",
      "#hours-sat",
      "#hours-sun",
      "#distance-line"
    ].map((selector) => [selector, createTextElement()])
  );
  const resultsList = createTextElement();
  const cleanlinessRangeSelect = { value: "all" };

  function getResultTitle(button) {
    return button.children?.[0]?.children?.[0]?.textContent ?? "";
  }

  function getResultCleanliness(button) {
    return button.children?.[0]?.children?.[2]?.children?.[0]?.textContent ?? "";
  }

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    location: { href: "http://localhost/" },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    assert.match(
      requestUrl,
      /^\/api\/toilets\/detail\?toiletId=test-toilet&cleanlinessRange=(3days|1day)$/
    );
    const cleanliness = requestUrl.endsWith("cleanlinessRange=1day") ? 5 : 2;
    return {
      ok: true,
      async json() {
        return {
          toilet: {
            ...createTestToilet(),
            cleanliness,
            cleanlinessSurvey: {
              ratingTotal: cleanliness,
              ratingCount: 1
            }
          }
        };
      }
    };
  };

  try {
    const controller = createMapController({
      statusText: { textContent: "" },
      detailsCard: { classList: createClassList() },
      mapPanel: { classList: createClassList() },
      directionsButton: { disabled: false },
      resultsList,
      resultsSummary: createTextElement(),
      sortSelect: {
        selectedOptions: [{ textContent: "Cleanliness" }]
      },
      cleanlinessRangeSelect
    });

    const selectedToilet = {
      ...createTestToilet(),
      cleanliness: 1,
      cleanlinessSurvey: {
        ratingTotal: 1,
        ratingCount: 1
      }
    };
    const cleanerToilet = {
      ...createTestToilet(),
      id: "cleaner-toilet",
      name: "Cleaner toilet",
      lat: 51.5001,
      cleanliness: 4,
      cleanlinessSurvey: {
        ratingTotal: 8,
        ratingCount: 2
      }
    };

    controller.setToilets([selectedToilet, cleanerToilet], { cleanlinessRange: "all" });
    controller.setSortMode("cleanliness");
    await controller.setToilet(selectedToilet.id, { fly: false });

    assert.equal(getResultTitle(resultsList.children[0]), "Cleaner toilet");

    await controller.setCleanlinessRange("1day");

    assert.equal(elementsBySelector.get("#cleanliness-score").textContent, "5.0/5");
    assert.equal(elementsBySelector.get("#cleanliness-rating-count").textContent, "1 rating");
    assert.equal(getResultTitle(resultsList.children[0]), "Cleaner toilet");

    const selectedResult = resultsList.children.find((button) => getResultTitle(button) === "Test toilet");
    assert.match(getResultCleanliness(selectedResult), /1\.0\/5/);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("map controller keeps rating period independent per toilet", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  clearToiletDetailCache();

  const elementsBySelector = new Map(
    [
      "#cleanliness-stars",
      "#cleanliness-star-icons",
      "#cleanliness-score",
      "#cleanliness-rating-count",
      "#toilet-name",
      "#toilet-area",
      "#toilet-comment",
      "#feature-women",
      "#feature-men",
      "#feature-accessible",
      "#feature-neutral",
      "#feature-children",
      "#feature-baby-changing",
      "#feature-bidet",
      "#feature-automatic",
      "#feature-urinal-only",
      "#feature-radar-key",
      "#feature-free",
      "#hours-today",
      "#hours-sat",
      "#hours-sun",
      "#distance-line"
    ].map((selector) => [selector, createTextElement()])
  );
  const cleanlinessRangeSelect = { value: "all" };
  const requestedUrls = [];

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    location: { href: "http://localhost/" },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    requestedUrls.push(requestUrl);

    const searchParams = new URL(`http://localhost${requestUrl}`).searchParams;
    const toiletId = searchParams.get("toiletId");
    const range = searchParams.get("cleanlinessRange") ?? "all";
    const cleanliness = range === "1day" ? 5 : toiletId === "second-toilet" ? 4 : 3;

    return {
      ok: true,
      async json() {
        return {
          toilet: {
            ...createTestToilet(),
            id: toiletId,
            name: toiletId === "second-toilet" ? "Second toilet" : "Test toilet",
            cleanliness,
            cleanlinessSurvey: {
              ratingTotal: cleanliness,
              ratingCount: 1
            }
          }
        };
      }
    };
  };

  try {
    const firstToilet = createTestToilet();
    const secondToilet = {
      ...createTestToilet(),
      id: "second-toilet",
      name: "Second toilet",
      lat: 51.501,
      cleanliness: 2,
      cleanlinessSurvey: {
        ratingTotal: 2,
        ratingCount: 1
      }
    };

    const controller = createMapController({
      statusText: { textContent: "" },
      detailsCard: { classList: createClassList() },
      mapPanel: { classList: createClassList() },
      directionsButton: { disabled: false },
      cleanlinessRangeSelect
    });

    controller.setToilets([firstToilet, secondToilet], { cleanlinessRange: "all" });
    await controller.setToilet(firstToilet.id, { fly: false });
    assert.equal(cleanlinessRangeSelect.value, "3days");

    await controller.setCleanlinessRange("1day");
    assert.equal(cleanlinessRangeSelect.value, "1day");
    assert.equal(elementsBySelector.get("#cleanliness-score").textContent, "5.0/5");

    await controller.setToilet(secondToilet.id, { fly: false });
    assert.equal(cleanlinessRangeSelect.value, "3days");
    assert.equal(elementsBySelector.get("#cleanliness-score").textContent, "4.0/5");

    assert.deepEqual(requestedUrls, [
      "/api/toilets/detail?toiletId=test-toilet&cleanlinessRange=3days",
      "/api/toilets/detail?toiletId=test-toilet&cleanlinessRange=1day",
      "/api/toilets/detail?toiletId=second-toilet&cleanlinessRange=3days"
    ]);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("map controller patches saved cleanliness without reloading all toilets", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  const elementsBySelector = new Map(
    [
      "#cleanliness-stars",
      "#cleanliness-star-icons",
      "#cleanliness-score",
      "#cleanliness-rating-count",
      "#toilet-name",
      "#toilet-area",
      "#toilet-comment",
      "#feature-women",
      "#feature-men",
      "#feature-accessible",
      "#feature-neutral",
      "#feature-children",
      "#feature-baby-changing",
      "#feature-bidet",
      "#feature-automatic",
      "#feature-urinal-only",
      "#feature-radar-key",
      "#feature-free",
      "#hours-today",
      "#hours-sat",
      "#hours-sun",
      "#distance-line"
    ].map((selector) => [selector, createTextElement()])
  );

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  const testToilet = createTestToilet();
  let reloadCount = 0;
  let fetchCount = 0;

  globalThis.fetch = async (url, options) => {
    fetchCount += 1;
    assert.match(String(url), /\/api\/cleanliness-survey$/);
    assert.equal(options?.method, "POST");

    return {
      ok: true,
      async json() {
        return {
          toilet: {
            ...testToilet,
            cleanliness: 5,
            cleanlinessSurvey: {
              ratingTotal: 5,
              ratingCount: 1
            }
          }
        };
      }
    };
  };

  try {
    const controller = createMapController(
      {
        statusText: { textContent: "" },
        detailsCard: { classList: createClassList() },
        mapPanel: { classList: createClassList() },
        directionsButton: { disabled: false },
        mapSurveyStatus: createTextElement()
      },
      () => {},
      {
        isAuthenticated: () => true,
        onCleanlinessSaved: async () => {
          reloadCount += 1;
        }
      }
    );

    controller.setToilets([testToilet]);
    await controller.setToilet(testToilet.id);

    const saved = await controller.answerCleanlinessSurvey(5);

    assert.equal(saved, true);
    assert.equal(fetchCount, 1);
    assert.equal(reloadCount, 0);
    assert.equal(elementsBySelector.get("#cleanliness-rating-count").textContent, "1 rating");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("map controller patches saved cleanliness against the active rating period", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  const elementsBySelector = new Map(
    [
      "#cleanliness-stars",
      "#cleanliness-star-icons",
      "#cleanliness-score",
      "#cleanliness-rating-count",
      "#toilet-name",
      "#toilet-area",
      "#toilet-comment",
      "#feature-women",
      "#feature-men",
      "#feature-accessible",
      "#feature-neutral",
      "#feature-children",
      "#feature-baby-changing",
      "#feature-bidet",
      "#feature-automatic",
      "#feature-urinal-only",
      "#feature-radar-key",
      "#feature-free",
      "#hours-today",
      "#hours-sat",
      "#hours-sun",
      "#distance-line"
    ].map((selector) => [selector, createTextElement()])
  );

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  const testToilet = createTestToilet();

  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/api\/cleanliness-survey$/);
    assert.equal(options?.method, "POST");

    return {
      ok: true,
      async json() {
        return {
          toilet: {
            ...testToilet,
            cleanliness: 3,
            cleanlinessSurvey: {
              ratingTotal: 15,
              ratingCount: 5
            }
          }
        };
      }
    };
  };

  try {
    const controller = createMapController(
      {
        statusText: { textContent: "" },
        detailsCard: { classList: createClassList() },
        mapPanel: { classList: createClassList() },
        directionsButton: { disabled: false },
        mapSurveyStatus: createTextElement()
      },
      () => {},
      {
        isAuthenticated: () => true
      }
    );

    controller.setToilets([testToilet], { cleanlinessRange: "3days" });
    await controller.setToilet(testToilet.id, { fly: false });

    const saved = await controller.answerCleanlinessSurvey(5);

    assert.equal(saved, true);
    assert.equal(elementsBySelector.get("#cleanliness-rating-count").textContent, "1 rating");
    assert.equal(elementsBySelector.get("#cleanliness-score").textContent, "5.0/5");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("locate button returns to hollow state when the map is moved away from the user", () => {
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalWindow = globalThis.window;

  const eventHandlers = new Map();
  let mapCenter = { lat: 51.4974, lng: -0.1751 };
  const markerLayer = {
    addTo() {
      return markerLayer;
    },
    clearLayers() {}
  };
  const fakeMap = {
    setView(center) {
      mapCenter = { lat: center[0], lng: center[1] };
      return fakeMap;
    },
    getCenter() {
      return mapCenter;
    },
    getBounds() {
      return {
        contains() {
          return true;
        },
        getSouth() {
          return mapCenter.lat - 0.01;
        },
        getNorth() {
          return mapCenter.lat + 0.01;
        },
        getWest() {
          return mapCenter.lng - 0.01;
        },
        getEast() {
          return mapCenter.lng + 0.01;
        }
      };
    },
    getZoom() {
      return 15;
    },
    flyTo(center) {
      mapCenter = { lat: center[0], lng: center[1] };
      return fakeMap;
    },
    on(eventNames, handler) {
      eventNames.split(" ").forEach((eventName) => eventHandlers.set(eventName, handler));
      return fakeMap;
    }
  };

  globalThis.document = {
    addEventListener() {},
    querySelector() {
      return null;
    }
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition(onSuccess) {
          onSuccess({
            coords: {
              latitude: 51.5,
              longitude: -0.17
            }
          });
        }
      }
    }
  });
  globalThis.window = {
    L: {
      map() {
        return fakeMap;
      },
      tileLayer() {
        return {
          addTo() {}
        };
      },
      layerGroup() {
        return markerLayer;
      },
      divIcon(options) {
        return options;
      },
      marker() {
        return {
          addTo() {
            return this;
          },
          remove() {},
          setLatLng() {}
        };
      }
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  try {
    const locateButton = {
      id: "locate-button",
      classList: createRecordingClassList(),
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      }
    };
    const controller = createMapController({
      statusText: { textContent: "" },
      mapElement: {},
      locateButtons: [locateButton]
    });

    assert.equal(controller.createInteractiveMap(), true);
    controller.requestLocation();
    assert.equal(locateButton.classList.contains("is-located"), true);

    mapCenter = { lat: 51.3, lng: -0.4 };
    eventHandlers.get("moveend")();
    assert.equal(locateButton.classList.contains("is-located"), false);
    assert.equal(locateButton.attributes["aria-pressed"], "false");
  } finally {
    globalThis.document = originalDocument;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator
    });
    globalThis.window = originalWindow;
  }
});

test("map controller records access history when opening directions if authenticated", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  const elementsBySelector = new Map(
    [
      "#toilet-name",
      "#toilet-area",
      "#distance-line",
      "#hours-today",
      "#hours-sat",
      "#hours-sun",
      "#feature-women",
      "#feature-men",
      "#feature-accessible",
      "#feature-neutral",
      "#feature-children",
      "#feature-baby-changing",
      "#feature-bidet",
      "#feature-automatic",
      "#feature-urinal-only",
      "#feature-radar-key",
      "#feature-free",
      "#cleanliness-stars",
      "#cleanliness-star-icons",
      "#cleanliness-score",
      "#cleanliness-rating-count"
    ].map((selector) => [selector, createTextElement()])
  );

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };

  let recordedPayload = null;
  const mockAuth = {
    isAuthenticated: () => true,
    recordAccessHistory: async (payload) => {
      recordedPayload = payload;
    }
  };

  globalThis.window = {
    open: () => {},
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  try {
    const controller = createMapController(
      {
        statusText: { textContent: "" },
        detailsCard: { classList: createClassList() },
        mapPanel: { classList: createClassList() },
        directionsButton: { disabled: false }
      },
      () => {},
      mockAuth
    );

    const testToilet = createTestToilet();
    controller.setToilets([testToilet]);
    await controller.setToilet(testToilet.id);

    controller.openDirections();

    assert.notEqual(recordedPayload, null);
    assert.equal(recordedPayload.toiletName, testToilet.name);
    assert.equal(recordedPayload.eventType, "Directions");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("map controller does not record access history when opening directions if unauthenticated", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  const elementsBySelector = new Map(
    [
      "#toilet-name",
      "#toilet-area",
      "#distance-line",
      "#hours-today",
      "#hours-sat",
      "#hours-sun",
      "#feature-women",
      "#feature-men",
      "#feature-accessible",
      "#feature-neutral",
      "#feature-children",
      "#feature-baby-changing",
      "#feature-bidet",
      "#feature-automatic",
      "#feature-urinal-only",
      "#feature-radar-key",
      "#feature-free",
      "#cleanliness-stars",
      "#cleanliness-star-icons",
      "#cleanliness-score",
      "#cleanliness-rating-count"
    ].map((selector) => [selector, createTextElement()])
  );

  globalThis.document = {
    addEventListener() {},
    createElement() {
      return createTextElement();
    },
    querySelector(selector) {
      return elementsBySelector.get(selector) ?? null;
    }
  };

  let recordedPayload = null;
  const mockAuth = {
    isAuthenticated: () => false,
    recordAccessHistory: async (payload) => {
      recordedPayload = payload;
    }
  };

  globalThis.window = {
    open: () => {},
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    }
  };

  try {
    const controller = createMapController(
      {
        statusText: { textContent: "" },
        detailsCard: { classList: createClassList() },
        mapPanel: { classList: createClassList() },
        directionsButton: { disabled: false }
      },
      () => {},
      mockAuth
    );

    const testToilet = createTestToilet();
    controller.setToilets([testToilet]);
    await controller.setToilet(testToilet.id);

    controller.openDirections();

    assert.equal(recordedPayload, null);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
