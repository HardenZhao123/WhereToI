import assert from "node:assert/strict";
import test from "node:test";
import {
  addDirtToFixture,
  createInitialDirtState,
  createToiletPlayground,
  createSceneSnapshot,
  getFixtureStatusRows
} from "../src/app/toilet-playground/toilet-playground.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.textContent = "";
    this.className = "";
    this.ownerSVGElement = null;
    this.classList = {
      add: (className) => this.setClasses(new Set([...this.getClasses(), className])),
      remove: (className) => {
        const nextClasses = this.getClasses();
        nextClasses.delete(className);
        this.setClasses(nextClasses);
      },
      toggle: (className, enabled) => {
        const nextClasses = this.getClasses();
        if (enabled) {
          nextClasses.add(className);
        } else {
          nextClasses.delete(className);
        }
        this.setClasses(nextClasses);
      },
      contains: (className) => this.getClasses().has(className)
    };
  }

  getClasses() {
    return new Set(String(this.className || this.attributes.class || "").split(/\s+/).filter(Boolean));
  }

  setClasses(classes) {
    this.className = [...classes].join(" ");
    this.attributes.class = this.className;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  append(...children) {
    children.forEach((child) => {
      if (this.tagName === "svg") child.ownerSVGElement = this;
      if (this.ownerSVGElement) child.ownerSVGElement = this.ownerSVGElement;
      this.children.push(child);
    });
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  click(event = {}) {
    this.listeners.click?.({
      currentTarget: this,
      preventDefault() {},
      ...event
    });
  }

  querySelectorAll(selector) {
    const results = [];
    const [classSelector, dataSelector] = selector.split("[");
    const className = classSelector?.startsWith(".") ? classSelector.slice(1) : null;
    const dataMatch = dataSelector?.match(/data-([\w-]+)="([^"]+)"/);

    const visit = (node) => {
      const hasClass = !className || node.classList?.contains(className);
      let hasData = true;
      if (dataMatch) {
        const key = dataMatch[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        hasData = node.dataset?.[key] === dataMatch[2];
      }
      if (hasClass && hasData) results.push(node);
      node.children?.forEach(visit);
    };

    visit(this);
    return results;
  }
}

function withFakeDom(callback) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName)
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
    callback();
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
}

test("toilet playground stores dirt by fixture", () => {
  const initialState = createInitialDirtState();

  assert.deepEqual(initialState, {
    wall: [],
    toilet: [],
    urinal: [],
    sink: [],
    floor: []
  });

  const withToiletStain = addDirtToFixture(initialState, "toilet", "stain", { x: 128, y: 234 });
  const withUrinalWet = addDirtToFixture(withToiletStain, "urinal", "wet", { x: 406, y: 244 });
  const withSinkWet = addDirtToFixture(withUrinalWet, "sink", "wet", { x: 642, y: 226 });
  const withFloorTissue = addDirtToFixture(withSinkWet, "floor", "tissue", { x: 460, y: 430 });
  const withWallFeces = addDirtToFixture(withFloorTissue, "wall", "feces", { x: 260, y: 160 });

  assert.deepEqual(withWallFeces.wall.map((placement) => placement.dirtId), ["feces"]);
  assert.deepEqual(withWallFeces.toilet.map((placement) => placement.dirtId), ["stain"]);
  assert.deepEqual(withWallFeces.urinal.map((placement) => placement.dirtId), ["wet"]);
  assert.deepEqual(withWallFeces.sink.map((placement) => placement.dirtId), ["wet"]);
  assert.deepEqual(withWallFeces.floor.map((placement) => placement.dirtId), ["tissue"]);
  assert.deepEqual(withWallFeces.floor[0], {
    id: "floor-tissue-4",
    dirtId: "tissue",
    x: 460,
    y: 430
  });
});

test("toilet playground allows repeated dirt at different positions", () => {
  const initialState = createInitialDirtState();
  const firstDrop = addDirtToFixture(initialState, "toilet", "stain", { x: 130, y: 220 });
  const secondDrop = addDirtToFixture(firstDrop, "toilet", "stain", { x: 210, y: 280 });

  assert.notEqual(secondDrop, firstDrop);
  assert.deepEqual(
    secondDrop.toilet.map((placement) => [placement.dirtId, placement.x, placement.y]),
    [
      ["stain", 130, 220],
      ["stain", 210, 280]
    ]
  );
});

test("toilet playground status rows and scene snapshot use display labels", () => {
  let state = createInitialDirtState();
  state = addDirtToFixture(state, "floor", "wet", { x: 420, y: 370 });
  state = addDirtToFixture(state, "floor", "wet", { x: 760, y: 440 });
  state = addDirtToFixture(state, "floor", "urine", { x: 550, y: 390 });
  state = addDirtToFixture(state, "floor", "dust", { x: 250, y: 360 });
  state = addDirtToFixture(state, "floor", "tissue", { x: 300, y: 400 });
  state = addDirtToFixture(state, "wall", "feces", { x: 260, y: 160 });

  const rows = getFixtureStatusRows(state);
  assert.deepEqual(rows.find((row) => row.fixtureId === "wall")?.dirtLabels, ["feces"]);
  assert.deepEqual(rows.find((row) => row.fixtureId === "floor")?.dirtLabels, [
    "wet x2",
    "urine",
    "dust",
    "tissue"
  ]);

  assert.deepEqual(
    createSceneSnapshot(state, {
      id: "toilet-1",
      name: "Library toilet"
    }),
    {
      version: 2,
      toiletId: "toilet-1",
      toiletName: "Library toilet",
      fixtures: {
        wall: [{ id: "wall-feces-6", dirtId: "feces", x: 260, y: 160 }],
        toilet: [],
        urinal: [],
        sink: [],
        floor: [
          { id: "floor-wet-1", dirtId: "wet", x: 420, y: 370 },
          { id: "floor-wet-2", dirtId: "wet", x: 760, y: 440 },
          { id: "floor-urine-3", dirtId: "urine", x: 550, y: 390 },
          { id: "floor-dust-4", dirtId: "dust", x: 250, y: 360 },
          { id: "floor-tissue-5", dirtId: "tissue", x: 300, y: 400 }
        ]
      }
    }
  );
});

test("toilet playground keeps scene state independent per selected toilet", () => {
  withFakeDom(() => {
    const root = new FakeElement("div");
    const playground = createToiletPlayground(root);

    playground.setContext({ id: "toilet-a", name: "Toilet A" });
    root.querySelectorAll(".dirt-tool[data-dirt-id=\"stain\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"toilet\"]")[0].click({ offsetX: 140, offsetY: 230 });

    assert.equal(playground.getState().toiletId, "toilet-a");
    assert.equal(playground.getState().fixtures.toilet.length, 1);

    playground.setContext({ id: "toilet-b", name: "Toilet B" });
    assert.equal(playground.getState().toiletId, "toilet-b");
    assert.deepEqual(playground.getState().fixtures.toilet, []);

    root.querySelectorAll(".dirt-tool[data-dirt-id=\"wet\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"floor\"]")[0].click({ offsetX: 700, offsetY: 420 });
    assert.equal(playground.getState().fixtures.floor.length, 1);

    root.querySelectorAll(".dirt-tool[data-dirt-id=\"feces\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"wall\"]")[0].click({ offsetX: 260, offsetY: 160 });
    assert.equal(playground.getState().fixtures.wall.length, 1);

    playground.setContext({ id: "toilet-a", name: "Toilet A" });
    assert.equal(playground.getState().fixtures.toilet.length, 1);
    assert.deepEqual(playground.getState().fixtures.floor, []);
    assert.deepEqual(playground.getState().fixtures.wall, []);
  });
});
