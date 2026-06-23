import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app/app.js";

class TestElement {
  constructor({ id = "", tagName = "div", dataset = {} } = {}) {
    this.id = id;
    this.tagName = tagName;
    this.dataset = dataset;
    this.attributes = {};
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.required = false;
    this.value = "";
    this.type = "";
    this.className = "";
    this.selectedOptions = [{ textContent: "Nearest" }];
    this.classList = {
      add: (className) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.add(className);
        this.className = [...classes].join(" ");
      },
      remove: (className) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.delete(className);
        this.className = [...classes].join(" ");
      },
      toggle: (className, enabled) => {
        if (enabled) {
          this.classList.add(className);
        } else {
          this.classList.remove(className);
        }
      },
      contains: (className) => this.className.split(/\s+/).includes(className)
    };
  }

  addEventListener() {}

  querySelector() {
    return null;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
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

function createTestDocument() {
  const elements = new Map();

  function getElement(selector) {
    if (!elements.has(selector)) {
      const id = selector.startsWith("#") ? selector.slice(1) : "";
      elements.set(selector, new TestElement({ id }));
    }
    return elements.get(selector);
  }

  return {
    addEventListener() {},
    createElement(tagName) {
      return new TestElement({ tagName });
    },
    createTextNode(text) {
      const node = new TestElement({ tagName: "#text" });
      node.textContent = text;
      return node;
    },
    querySelector: getElement,
    querySelectorAll(selector) {
      if (selector === ".tab") {
        return [
          new TestElement({ dataset: { tab: "map" } }),
          new TestElement({ dataset: { tab: "account" } })
        ];
      }

      if (selector === ".view") {
        return [new TestElement({ id: "map-panel" }), new TestElement({ id: "account-panel" })];
      }

      return [];
    }
  };
}

test("app initialization requests current location and centers the map when allowed", async () => {
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;

  let geolocationRequested = false;
  let csvFetchCount = 0;
  let toiletRequestUrl = "";
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
          return 51.4;
        },
        getNorth() {
          return 51.6;
        },
        getWest() {
          return -0.2;
        },
        getEast() {
          return 0.0;
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
    on() {
      return fakeMap;
    }
  };

  globalThis.document = createTestDocument();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition(onSuccess) {
          geolocationRequested = true;
          onSuccess({
            coords: {
              latitude: 51.51,
              longitude: -0.12
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
          getLatLng() {
            return mapCenter;
          },
          on() {},
          remove() {},
          setIcon() {},
          setLatLng() {}
        };
      }
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout
  };
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith(".csv")) {
      csvFetchCount += 1;
      throw new Error("Startup should not fetch the large CSV fallback.");
    }

    if (requestUrl.startsWith("/api/toilets")) {
      toiletRequestUrl = requestUrl;
      return {
        ok: true,
        json: async () => ({ toilets: [createTestToilet()] })
      };
    }

    if (requestUrl === "/api/me") {
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: "Not authenticated" })
      };
    }

    throw new Error(`Unexpected request: ${requestUrl}`);
  };
  console.error = () => {};

  try {
    const app = createApp();
    await app.initialize();

    assert.equal(csvFetchCount, 0);
    assert.equal(toiletRequestUrl, "/api/toilets?cleanlinessRange=3days");
    assert.equal(geolocationRequested, true);
    assert.deepEqual(mapCenter, { lat: 51.51, lng: -0.12 });
  } finally {
    globalThis.document = originalDocument;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator
    });
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});
