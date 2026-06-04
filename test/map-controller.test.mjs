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
