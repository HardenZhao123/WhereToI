import assert from "node:assert/strict";
import test from "node:test";
import {
  addDirtToFixture,
  createInitialDirtState,
  createToiletPlayground,
  createToiletScenePreview,
  createSceneSnapshot,
  fixtures,
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

function textContentDeep(node) {
  return `${node?.textContent ?? ""}${(node?.children ?? []).map(textContentDeep).join("")}`;
}

test("toilet playground stores dirt by fixture", () => {
  const initialState = createInitialDirtState();

  assert.deepEqual(Object.keys(initialState), fixtures.map((fixture) => fixture.id));
  fixtures.forEach((fixture) => {
    assert.deepEqual(initialState[fixture.id], []);
  });

  const withToiletStain = addDirtToFixture(initialState, "toilet", "stain", { x: 128, y: 234 });
  const withUrinalWet = addDirtToFixture(withToiletStain, "urinal", "wet", { x: 406, y: 244 });
  const withSinkWet = addDirtToFixture(withUrinalWet, "sink", "wet", { x: 642, y: 226 });
  const withFloorTissue = addDirtToFixture(withSinkWet, "floor", "tissue", { x: 460, y: 430 });
  const withAccessibleDispenserSoap = addDirtToFixture(withFloorTissue, "accessibleDispenser", "soap", { x: 262, y: 180 });
  const withWomenBinDust = addDirtToFixture(withAccessibleDispenserSoap, "womenSanitaryBin", "dust", { x: 316, y: 300 });
  const withWallFeces = addDirtToFixture(withWomenBinDust, "wall", "feces", { x: 260, y: 160 });

  assert.deepEqual(withWallFeces.wall.map((placement) => placement.dirtId), ["feces"]);
  assert.deepEqual(withWallFeces.toilet.map((placement) => placement.dirtId), ["stain"]);
  assert.deepEqual(withWallFeces.urinal.map((placement) => placement.dirtId), ["wet"]);
  assert.deepEqual(withWallFeces.sink.map((placement) => placement.dirtId), ["wet"]);
  assert.deepEqual(withWallFeces.floor.map((placement) => placement.dirtId), ["tissue"]);
  assert.deepEqual(withWallFeces.accessibleDispenser.map((placement) => placement.dirtId), ["soap"]);
  assert.deepEqual(withWallFeces.womenSanitaryBin.map((placement) => placement.dirtId), ["dust"]);
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

  const snapshot = createSceneSnapshot(state, {
    id: "toilet-1",
    name: "Library toilet"
  });
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.sceneType, "standard");
  assert.deepEqual(snapshot.activeFixtures, ["wall", "toilet", "urinal", "sink", "floor"]);
  assert.equal(snapshot.toiletId, "toilet-1");
  assert.equal(snapshot.toiletName, "Library toilet");
  assert.deepEqual(snapshot.fixtures.wall, [{ id: "wall-feces-6", dirtId: "feces", x: 260, y: 160 }]);
  assert.deepEqual(snapshot.fixtures.floor, [
    { id: "floor-wet-1", dirtId: "wet", x: 420, y: 370 },
    { id: "floor-wet-2", dirtId: "wet", x: 760, y: 440 },
    { id: "floor-urine-3", dirtId: "urine", x: 550, y: 390 },
    { id: "floor-dust-4", dirtId: "dust", x: 250, y: 360 },
    { id: "floor-tissue-5", dirtId: "tissue", x: 300, y: 400 }
  ]);
  assert.deepEqual(snapshot.fixtures.accessibleDispenser, []);
  assert.deepEqual(snapshot.fixtures.womenSanitaryBin, []);
});

test("toilet playground lets multi-feature toilets switch scene type", () => {
  withFakeDom(() => {
    const root = new FakeElement("div");
    const playground = createToiletPlayground(root);

    playground.setContext({
      id: "accessible-toilet",
      name: "Accessible toilet",
      features: {
        accessible: "Y",
        men: "Y",
        women: "Y"
      }
    });
    assert.equal(root.querySelectorAll(".scene-type-option[data-scene-type=\"standard\"]").length, 1);
    assert.equal(root.querySelectorAll(".scene-type-option[data-scene-type=\"women\"]").length, 1);
    assert.equal(root.querySelectorAll(".scene-type-option[data-scene-type=\"accessible\"]").length, 1);
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"urinal\"]").length, 0);
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"accessibleSupport\"]").length, 1);
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"accessibleAlarm\"]").length, 1);
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"accessibleDispenser\"]").length, 1);
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"accessibleMirror\"]").length, 1);
    assert.equal(root.querySelectorAll(".fixture-art-accessible-support").length, 1);
    assert.equal(root.querySelectorAll(".playground-accessible-paper-dispenser").length, 1);
    assert.equal(root.querySelectorAll(".playground-accessible-alarm-reset").length, 1);
    assert.equal(root.querySelectorAll(".playground-accessible-lower-mirror").length, 1);
    assert.equal(textContentDeep(root).includes("Urinal:"), false);

    const accessibleSnapshot = playground.getState();
    assert.equal(accessibleSnapshot.sceneType, "accessible");
    assert.deepEqual(accessibleSnapshot.activeFixtures, [
      "wall",
      "toilet",
      "accessibleSupport",
      "accessibleAlarm",
      "accessibleDispenser",
      "accessibleMirror",
      "sink",
      "floor"
    ]);

    playground.setSceneType("standard");
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"urinal\"]").length, 1);
    assert.equal(root.querySelectorAll(".fixture-art-accessible-support").length, 0);
    assert.equal(textContentDeep(root).includes("Urinal:"), true);
    assert.equal(playground.getState().sceneType, "standard");

    playground.setSceneType("women");
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"urinal\"]").length, 0);
    assert.equal(root.querySelectorAll(".fixture-art-accessible-support").length, 0);
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"womenSanitaryBin\"]").length, 1);
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"womenProductDispenser\"]").length, 1);
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"womenShelf\"]").length, 1);
    assert.equal(root.querySelectorAll(".fixture-art-women-sanitary-bin").length, 1);
    assert.equal(root.querySelectorAll(".playground-women-sanitary-bin").length, 1);
    assert.equal(root.querySelectorAll(".playground-women-product-dispenser").length, 1);
    assert.equal(playground.getState().sceneType, "women");

    playground.setContext({
      id: "women-toilet",
      name: "Women toilet",
      features: {
        accessible: "N",
        women: "Y",
        men: "N"
      }
    });
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"urinal\"]").length, 0);
    assert.equal(root.querySelectorAll(".fixture-art-accessible-support").length, 0);
    assert.equal(root.querySelectorAll(".fixture-art-women-sanitary-bin").length, 1);
    assert.equal(playground.getState().sceneType, "women");

    playground.setContext({
      id: "men-toilet",
      name: "Men toilet",
      features: {
        accessible: "N",
        women: "N",
        men: "Y"
      }
    });
    assert.equal(root.querySelectorAll(".playground-fixture[data-fixture-id=\"urinal\"]").length, 1);
    assert.equal(playground.getState().sceneType, "standard");
  });
});

test("toilet playground keeps scene state independent per selected scene type", () => {
  withFakeDom(() => {
    const root = new FakeElement("div");
    const playground = createToiletPlayground(root);

    playground.setContext({
      id: "multi-toilet",
      name: "Multi toilet",
      features: {
        accessible: "Y",
        men: "Y",
        women: "Y"
      }
    });

    root.querySelectorAll(".dirt-tool[data-dirt-id=\"wet\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"floor\"]")[0].click({ offsetX: 620, offsetY: 430 });
    assert.equal(playground.getState().sceneType, "accessible");
    assert.equal(playground.getState().fixtures.floor.length, 1);

    playground.setSceneType("standard");
    assert.equal(playground.getState().sceneType, "standard");
    assert.deepEqual(playground.getState().fixtures.floor, []);

    root.querySelectorAll(".dirt-tool[data-dirt-id=\"stain\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"urinal\"]")[0].click({ offsetX: 410, offsetY: 250 });
    assert.equal(playground.getState().fixtures.urinal.length, 1);

    playground.setSceneType("accessible");
    assert.equal(playground.getState().sceneType, "accessible");
    assert.equal(playground.getState().fixtures.floor.length, 1);
    assert.deepEqual(playground.getState().fixtures.urinal, []);

    playground.setSceneType("standard");
    assert.equal(playground.getState().fixtures.urinal.length, 1);
    assert.deepEqual(playground.getState().fixtures.floor, []);
  });
});

test("toilet playground can undo the previous scene edit", () => {
  withFakeDom(() => {
    const root = new FakeElement("div");
    const playground = createToiletPlayground(root);

    playground.setContext({ id: "toilet-a", name: "Toilet A" });
    assert.equal(root.querySelectorAll(".playground-undo-button")[0].attributes.disabled, "disabled");

    root.querySelectorAll(".dirt-tool[data-dirt-id=\"wet\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"floor\"]")[0].click({ offsetX: 620, offsetY: 430 });
    root.querySelectorAll(".dirt-tool[data-dirt-id=\"stain\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"toilet\"]")[0].click({ offsetX: 140, offsetY: 230 });

    assert.equal(playground.getState().fixtures.floor.length, 1);
    assert.equal(playground.getState().fixtures.toilet.length, 1);
    assert.equal(root.querySelectorAll(".playground-undo-button")[0].attributes.disabled, undefined);

    root.querySelectorAll(".playground-undo-button")[0].click();
    assert.equal(playground.getState().fixtures.floor.length, 1);
    assert.deepEqual(playground.getState().fixtures.toilet, []);

    root.querySelectorAll(".playground-undo-button")[0].click();
    assert.deepEqual(playground.getState().fixtures.floor, []);
    assert.equal(root.querySelectorAll(".playground-undo-button")[0].attributes.disabled, "disabled");
  });
});

test("toilet playground undo history is scoped to the current scene type", () => {
  withFakeDom(() => {
    const root = new FakeElement("div");
    const playground = createToiletPlayground(root);

    playground.setContext({
      id: "multi-toilet",
      name: "Multi toilet",
      features: {
        accessible: "Y",
        men: "Y",
        women: "Y"
      }
    });

    root.querySelectorAll(".dirt-tool[data-dirt-id=\"wet\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"floor\"]")[0].click({ offsetX: 620, offsetY: 430 });
    assert.equal(playground.getState().sceneType, "accessible");
    assert.equal(playground.getState().fixtures.floor.length, 1);

    playground.setSceneType("standard");
    root.querySelectorAll(".dirt-tool[data-dirt-id=\"stain\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"urinal\"]")[0].click({ offsetX: 410, offsetY: 250 });
    assert.equal(playground.getState().fixtures.urinal.length, 1);

    root.querySelectorAll(".playground-undo-button")[0].click();
    assert.deepEqual(playground.getState().fixtures.urinal, []);

    playground.setSceneType("accessible");
    assert.equal(playground.getState().fixtures.floor.length, 1);

    root.querySelectorAll(".playground-undo-button")[0].click();
    assert.deepEqual(playground.getState().fixtures.floor, []);
  });
});

test("toilet playground supports dirt placement on added scene facilities", () => {
  withFakeDom(() => {
    const root = new FakeElement("div");
    const playground = createToiletPlayground(root);

    playground.setContext({
      id: "multi-toilet",
      name: "Multi toilet",
      features: {
        accessible: "Y",
        men: "Y",
        women: "Y"
      }
    });

    root.querySelectorAll(".dirt-tool[data-dirt-id=\"soap\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"accessibleDispenser\"]")[0].click({ offsetX: 262, offsetY: 184 });
    root.querySelectorAll(".dirt-tool[data-dirt-id=\"dust\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"accessibleAlarm\"]")[0].click({ offsetX: 334, offsetY: 356 });
    root.querySelectorAll(".dirt-tool[data-dirt-id=\"mud\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"accessibleSupport\"]")[0].click({ offsetX: 86, offsetY: 232 });
    root.querySelectorAll(".dirt-tool[data-dirt-id=\"stain\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"accessibleMirror\"]")[0].click({ offsetX: 530, offsetY: 146 });
    assert.deepEqual(
      playground.getState().fixtures.accessibleDispenser.map((placement) => [placement.dirtId, placement.x, placement.y]),
      [["soap", 262, 184]]
    );
    assert.deepEqual(
      playground.getState().fixtures.accessibleAlarm.map((placement) => [placement.dirtId, placement.x, placement.y]),
      [["dust", 334, 356]]
    );
    assert.deepEqual(
      playground.getState().fixtures.accessibleSupport.map((placement) => [placement.dirtId, placement.x, placement.y]),
      [["mud", 86, 232]]
    );
    assert.deepEqual(
      playground.getState().fixtures.accessibleMirror.map((placement) => [placement.dirtId, placement.x, placement.y]),
      [["stain", 530, 146]]
    );

    playground.setSceneType("women");
    root.querySelectorAll(".dirt-tool[data-dirt-id=\"dust\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"womenProductDispenser\"]")[0].click({ offsetX: 407, offsetY: 146 });
    root.querySelectorAll(".dirt-tool[data-dirt-id=\"tissue\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"womenSanitaryBin\"]")[0].click({ offsetX: 316, offsetY: 300 });
    root.querySelectorAll(".dirt-tool[data-dirt-id=\"hair\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"womenShelf\"]")[0].click({ offsetX: 486, offsetY: 224 });
    assert.deepEqual(
      playground.getState().fixtures.womenProductDispenser.map((placement) => [placement.dirtId, placement.x, placement.y]),
      [["dust", 407, 146]]
    );
    assert.deepEqual(
      playground.getState().fixtures.womenSanitaryBin.map((placement) => [placement.dirtId, placement.x, placement.y]),
      [["tissue", 316, 300]]
    );
    assert.deepEqual(
      playground.getState().fixtures.womenShelf.map((placement) => [placement.dirtId, placement.x, placement.y]),
      [["hair", 486, 224]]
    );
  });
});

test("toilet scene preview respects accessible snapshot fixtures", () => {
  withFakeDom(() => {
    let state = createInitialDirtState();
    state = addDirtToFixture(state, "floor", "wet", { x: 620, y: 430 });

    const sceneSnapshot = createSceneSnapshot(state, {
      id: "accessible-toilet",
      name: "Accessible toilet",
      features: {
        accessible: "Y",
        men: "Y",
        women: "Y"
      }
    });
    const preview = createToiletScenePreview(sceneSnapshot);

    assert.ok(preview);
    assert.equal(preview.querySelectorAll(".playground-fixture-preview-urinal").length, 0);
    assert.equal(preview.querySelectorAll(".playground-fixture-preview-accessibleSupport").length, 1);
    assert.equal(preview.querySelectorAll(".fixture-art-accessible-support").length, 1);
  });
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

test("toilet playground done callback keeps the current scene snapshot", () => {
  withFakeDom(() => {
    const root = new FakeElement("div");
    let completedSnapshot = null;
    const playground = createToiletPlayground(root, {
      onDone: (snapshot) => {
        completedSnapshot = snapshot;
      }
    });

    playground.setContext({ id: "toilet-a", name: "Toilet A" });
    root.querySelectorAll(".dirt-tool[data-dirt-id=\"wet\"]")[0].click();
    root.querySelectorAll(".playground-fixture[data-fixture-id=\"floor\"]")[0].click({ offsetX: 620, offsetY: 430 });
    root.querySelectorAll(".playground-upload-button")[0].click();

    assert.equal(completedSnapshot.toiletId, "toilet-a");
    assert.deepEqual(completedSnapshot.fixtures.floor, [
      { id: "floor-wet-1", dirtId: "wet", x: 620, y: 430 }
    ]);
  });
});
