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

function createTextElement() {
  return {
    textContent: "",
    hidden: false,
    classList: createClassList(),
    setAttribute() {},
    closest() {
      return null;
    },
    replaceChildren(...children) {
      this.children = children;
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

test("map controller keeps submitted rating count after a stale toilet reload", () => {
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
    controller.setToilet(staleToilet.id, { fly: false });

    assert.equal(elementsBySelector.get("#cleanliness-rating-count").textContent, "1 rating");
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
