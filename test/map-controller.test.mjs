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
    controller.setToilet(testToilet.id);

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
    controller.setToilet(testToilet.id);

    controller.openDirections();

    assert.equal(recordedPayload, null);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
