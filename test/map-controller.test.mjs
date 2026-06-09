import assert from "node:assert/strict";
import test from "node:test";
import { createMapController } from "../src/app/controllers/map-controller.js";

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
  const svgClassList = createRecordingClassList();

  return {
    element: {
      dataset: {},
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      querySelector(selector) {
        if (selector === ".cartoon-toilet-svg") {
          return { classList: svgClassList };
        }

        return null;
      }
    },
    svgClassList
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

test("map controller keeps overview visual state synced with the current preview level", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const { element: overviewVisualPreview, svgClassList: overviewSvgClassList } = createPreviewElement();
  const { element: visualCleanlinessPreview, svgClassList: visualSvgClassList } = createPreviewElement();
  const overviewVisualState = createTextElement();
  const visualCleanlinessState = createTextElement();
  const overviewVisualImage = {
    src: "",
    classList: createRecordingClassList()
  };
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
      overviewVisualPreview,
      overviewVisualImage,
      overviewVisualState,
      visualCleanlinessPreview,
      visualCleanlinessImage,
      visualCleanlinessState
    });

    controller.setVisualCleanlinessLevel(4.5);

    assert.equal(overviewVisualPreview.dataset.cleanliness, "4.5");
    assert.equal(overviewVisualImage.src, "toilet_levels/level_45.png");
    assert.equal(overviewVisualImage.classList.contains("is-hidden"), false);
    assert.equal(overviewVisualState.textContent, "Very clean - Almost spotless");
    assert.equal(overviewSvgClassList.contains("is-hidden"), true);

    assert.equal(visualCleanlinessPreview.dataset.cleanliness, "4.5");
    assert.equal(visualCleanlinessImage.src, "toilet_levels/level_45.png");
    assert.equal(visualCleanlinessImage.classList.contains("is-hidden"), false);
    assert.equal(visualSvgClassList.contains("is-hidden"), true);
    assert.equal(visualCleanlinessState.textContent, "Very clean - Almost spotless");
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

test("map controller lazy-loads comments when the feedback section opens", async () => {
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

    assert.equal(commentsFetchCount, 1);
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
    assert.equal(elementsBySelector.get("#cleanliness-score").textContent, "0.0/5");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
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
