const svgNamespace = "http://www.w3.org/2000/svg";
const uploadStorageKey = "wheretoi-toilet-playground-scenes";

export const dirtTypes = [
  { id: "stain", label: "stain", scale: 0.86 },
  { id: "wet", label: "wet", scale: 0.82 },
  { id: "tissue", label: "tissue", scale: 0.78 },
  { id: "dust", label: "dust", scale: 0.84 },
  { id: "urine", label: "urine", scale: 0.78 },
  { id: "mud", label: "mud", scale: 0.82 },
  { id: "soap", label: "soap", scale: 0.8 },
  { id: "hair", label: "hair", scale: 0.82 }
];

export const fixtures = [
  { id: "toilet", label: "Toilet" },
  { id: "urinal", label: "Urinal" },
  { id: "sink", label: "Sink" },
  { id: "floor", label: "Floor" }
];

const fixtureHitBoxes = {
  toilet: { x: 64, y: 118, width: 244, height: 238 },
  urinal: { x: 316, y: 78, width: 184, height: 268 },
  sink: { x: 526, y: 56, width: 240, height: 292 },
  floor: { x: 42, y: 340, width: 736, height: 126 }
};

const renderFixtureOrder = ["floor", "toilet", "urinal", "sink"];
const validFixtureIds = new Set(fixtures.map((fixture) => fixture.id));
const validDirtIds = new Set(dirtTypes.map((dirt) => dirt.id));

function getDirtDefinition(dirtId) {
  return dirtTypes.find((dirt) => dirt.id === dirtId) ?? dirtTypes[0];
}

function getDirtLabel(dirtId) {
  return getDirtDefinition(dirtId).label ?? dirtId;
}

function getFixtureLabel(fixtureId) {
  return fixtures.find((fixture) => fixture.id === fixtureId)?.label ?? fixtureId;
}

function getFixtureCenter(fixtureId) {
  const hitBox = fixtureHitBoxes[fixtureId] ?? fixtureHitBoxes.floor;
  return {
    x: hitBox.x + hitBox.width / 2,
    y: hitBox.y + hitBox.height / 2
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampPointToFixture(fixtureId, point = getFixtureCenter(fixtureId)) {
  const hitBox = fixtureHitBoxes[fixtureId] ?? fixtureHitBoxes.floor;
  return {
    x: Math.round(clamp(Number(point.x), hitBox.x, hitBox.x + hitBox.width)),
    y: Math.round(clamp(Number(point.y), hitBox.y, hitBox.y + hitBox.height))
  };
}

function normalisePlacement(placement, fixtureId, index = 0) {
  if (typeof placement === "string") {
    const point = getFixtureCenter(fixtureId);
    return {
      id: `${fixtureId}-${placement}-${index + 1}`,
      dirtId: placement,
      x: Math.round(point.x),
      y: Math.round(point.y)
    };
  }

  const dirtId = String(placement?.dirtId ?? "");
  const point = clampPointToFixture(fixtureId, placement);
  return {
    id: String(placement?.id ?? `${fixtureId}-${dirtId || "dirt"}-${index + 1}`),
    dirtId,
    x: point.x,
    y: point.y
  };
}

function getFixturePlacements(state, fixtureId) {
  const placements = Array.isArray(state?.[fixtureId]) ? state[fixtureId] : [];
  return placements
    .map((placement, index) => normalisePlacement(placement, fixtureId, index))
    .filter((placement) => validDirtIds.has(placement.dirtId));
}

function getScenePlacementCount(state) {
  return fixtures.reduce((total, fixture) => {
    return total + getFixturePlacements(state, fixture.id).length;
  }, 0);
}

function getNextPlacementId(state, fixtureId, dirtId) {
  const count = fixtures.reduce((total, fixture) => {
    return total + getFixturePlacements(state, fixture.id).length;
  }, 0);
  return `${fixtureId}-${dirtId}-${count + 1}`;
}

function summariseDirtLabels(placements) {
  const counts = placements.reduce((summary, placement) => {
    summary.set(placement.dirtId, (summary.get(placement.dirtId) ?? 0) + 1);
    return summary;
  }, new Map());

  return [...counts.entries()].map(([dirtId, count]) => {
    const label = getDirtLabel(dirtId);
    return count > 1 ? `${label} x${count}` : label;
  });
}

export function createInitialDirtState() {
  return fixtures.reduce((state, fixture) => {
    state[fixture.id] = [];
    return state;
  }, {});
}

export function hasDirt(state, fixtureId, dirtId) {
  return getFixturePlacements(state, fixtureId).some((placement) => placement.dirtId === dirtId);
}

export function addDirtToFixture(state, fixtureId, dirtId, point = getFixtureCenter(fixtureId)) {
  if (!validFixtureIds.has(fixtureId) || !validDirtIds.has(dirtId)) {
    return state;
  }

  const currentPlacements = getFixturePlacements(state, fixtureId);
  const clampedPoint = clampPointToFixture(fixtureId, point);
  const placement = {
    id: getNextPlacementId(state, fixtureId, dirtId),
    dirtId,
    x: clampedPoint.x,
    y: clampedPoint.y
  };

  return {
    ...createInitialDirtState(),
    ...state,
    [fixtureId]: [...currentPlacements, placement]
  };
}

export function getFixtureStatusRows(state) {
  return fixtures.map((fixture) => {
    const placements = getFixturePlacements(state, fixture.id);
    return {
      fixtureId: fixture.id,
      fixtureLabel: fixture.label,
      placements,
      dirtIds: placements.map((placement) => placement.dirtId),
      dirtLabels: summariseDirtLabels(placements)
    };
  });
}

export function createSceneSnapshot(state, toilet = null) {
  return {
    version: 2,
    toiletId: toilet?.id ?? null,
    toiletName: toilet?.name ?? "",
    fixtures: getFixtureStatusRows(state).reduce((snapshot, row) => {
      snapshot[row.fixtureId] = row.placements.map((placement) => ({
        id: placement.id,
        dirtId: placement.dirtId,
        x: placement.x,
        y: placement.y
      }));
      return snapshot;
    }, createInitialDirtState())
  };
}

export function sceneSnapshotHasPlacements(sceneSnapshot) {
  return fixtures.some((fixture) => {
    const placements = Array.isArray(sceneSnapshot?.fixtures?.[fixture.id])
      ? sceneSnapshot.fixtures[fixture.id]
      : [];
    return placements.length > 0;
  });
}

function createElement(tagName, { className = "", text = "", attrs = {}, dataset = {} } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;

  Object.entries(attrs).forEach(([name, value]) => {
    if (value !== null && typeof value !== "undefined") {
      element.setAttribute(name, String(value));
    }
  });

  Object.entries(dataset).forEach(([name, value]) => {
    element.dataset[name] = String(value);
  });

  return element;
}

function createSvgElement(tagName, attrs = {}) {
  const element = document.createElementNS(svgNamespace, tagName);
  Object.entries(attrs).forEach(([name, value]) => {
    if (value !== null && typeof value !== "undefined") {
      element.setAttribute(name, String(value));
    }
  });
  return element;
}

function appendSvgTitle(element, title) {
  const titleElement = createSvgElement("title");
  titleElement.textContent = title;
  element.append(titleElement);
}

function getEventSvgPoint(event, fixtureId) {
  const svg = event?.currentTarget?.ownerSVGElement;
  const clientX = Number(event?.clientX);
  const clientY = Number(event?.clientY);

  if (
    svg &&
    typeof svg.createSVGPoint === "function" &&
    typeof svg.getScreenCTM === "function" &&
    Number.isFinite(clientX) &&
    Number.isFinite(clientY)
  ) {
    const matrix = svg.getScreenCTM();
    if (matrix && typeof matrix.inverse === "function") {
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const svgPoint = point.matrixTransform(matrix.inverse());
      return clampPointToFixture(fixtureId, svgPoint);
    }
  }

  if (Number.isFinite(Number(event?.offsetX)) && Number.isFinite(Number(event?.offsetY))) {
    return clampPointToFixture(fixtureId, {
      x: Number(event.offsetX),
      y: Number(event.offsetY)
    });
  }

  return getFixtureCenter(fixtureId);
}

function DirtToolbar({ selectedDirt, onSelectDirt, onDragStart, onDragEnd }) {
  const toolbar = createElement("aside", {
    className: "dirt-toolbar",
    attrs: { "aria-label": "Dirt toolbar" }
  });

  const title = createElement("h2", { text: "Dirt" });
  const list = createElement("div", { className: "dirt-tool-list" });

  dirtTypes.forEach((dirt) => {
    const button = createElement("button", {
      className: `dirt-tool dirt-tool-${dirt.id}`,
      attrs: {
        type: "button",
        draggable: "true",
        "aria-pressed": String(selectedDirt === dirt.id)
      },
      dataset: { dirtId: dirt.id }
    });
    button.classList.toggle("is-selected", selectedDirt === dirt.id);

    const icon = createElement("span", {
      className: `dirt-tool-icon dirt-tool-icon-${dirt.id}`,
      attrs: { "aria-hidden": "true" }
    });
    const label = createElement("span", { text: dirt.label });
    button.append(icon, label);

    button.addEventListener("click", () => onSelectDirt(dirt.id));
    button.addEventListener("dragstart", (event) => onDragStart(event, dirt.id));
    button.addEventListener("dragend", onDragEnd);
    list.append(button);
  });

  toolbar.append(title, list);
  return toolbar;
}

function createFixtureLabel(text, x, y, extraClass = "") {
  const label = createSvgElement("text", {
    class: `fixture-label ${extraClass}`.trim(),
    x,
    y
  });
  label.textContent = text;
  return label;
}

function createHighlightRect(fixtureId) {
  const hitBox = fixtureHitBoxes[fixtureId];
  return createSvgElement("rect", {
    class: "fixture-highlight",
    x: hitBox.x,
    y: hitBox.y,
    width: hitBox.width,
    height: hitBox.height,
    rx: fixtureId === "floor" ? 8 : 18
  });
}

function createToiletArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-toilet" });
  group.append(
    createSvgElement("ellipse", { class: "fixture-shadow", cx: 184, cy: 343, rx: 116, ry: 18 }),
    createSvgElement("path", {
      class: "playground-toilet-base",
      d: "M151 293h63l20 54H128l23-54Z"
    }),
    createSvgElement("rect", { class: "playground-toilet-tank", x: 96, y: 150, width: 176, height: 84, rx: 8 }),
    createSvgElement("path", {
      class: "playground-toilet-tank-face",
      d: "M107 159h154v64H107Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-tank-shadow",
      d: "M225 156h37v70h-37Z"
    }),
    createSvgElement("rect", { class: "playground-toilet-tank-top", x: 88, y: 140, width: 192, height: 15, rx: 6 }),
    createSvgElement("circle", { class: "playground-toilet-handle", cx: 247, cy: 183, r: 5 }),
    createSvgElement("path", {
      class: "playground-toilet-pipe",
      d: "M184 231v27"
    }),
    createSvgElement("ellipse", {
      class: "playground-toilet-lid",
      cx: 169,
      cy: 199,
      rx: 57,
      ry: 83,
      transform: "rotate(-9 169 199)"
    }),
    createSvgElement("path", {
      class: "playground-toilet-lid-highlight",
      d: "M133 141c31 4 62 36 68 83"
    }),
    createSvgElement("path", {
      class: "playground-toilet-lid-shadow",
      d: "M189 122c23 27 36 65 32 102"
    }),
    createSvgElement("path", {
      class: "playground-toilet-outer",
      d: "M89 241h190c0 45-37 80-95 80-57 0-95-35-95-80Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-seat",
      d: "M97 238c7-28 41-47 86-47 46 0 80 19 88 47-10 24-43 40-88 40-44 0-77-16-86-40Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-water",
      d: "M128 236c14-16 96-16 110 0-12 16-98 16-110 0Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-bowl-shadow",
      d: "M225 247c-9 23-31 35-66 36 49 3 83-12 101-39"
    }),
    createSvgElement("path", {
      class: "playground-toilet-front",
      d: "M100 260c12 36 43 55 84 55s73-19 85-55c-10 49-43 75-85 75s-75-26-84-75Z"
    }),
    createSvgElement("circle", { class: "playground-toilet-floor-bolt", cx: 132, cy: 339, r: 4 }),
    createSvgElement("circle", { class: "playground-toilet-floor-bolt", cx: 232, cy: 339, r: 4 }),
    createFixtureLabel("toilet", 96, 116)
  );
  return group;
}

function createUrinalArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-urinal" });
  group.append(
    createSvgElement("ellipse", { class: "fixture-shadow", cx: 410, cy: 331, rx: 76, ry: 14 }),
    createSvgElement("path", {
      class: "playground-urinal-flush-handle",
      d: "M412 48h46"
    }),
    createSvgElement("rect", { class: "playground-urinal-flush-knob", x: 386, y: 32, width: 28, height: 34, rx: 10 }),
    createSvgElement("path", {
      class: "playground-urinal-pipe",
      d: "M410 65v50"
    }),
    createSvgElement("circle", { class: "playground-urinal-pipe-joint", cx: 410, cy: 78, r: 9 }),
    createSvgElement("path", {
      class: "playground-urinal-back",
      d: "M340 118h140c11 0 20 9 20 20v99c0 21-14 38-32 45-8 28-28 47-58 47s-51-19-58-47c-19-7-33-24-33-45v-99c0-11 9-20 21-20Z"
    }),
    createSvgElement("path", {
      class: "playground-urinal-side-shadow",
      d: "M461 123h18c9 0 16 7 16 16v97c0 18-12 33-29 40-4 17-13 31-27 41 24-45 28-112 22-194Z"
    }),
    createSvgElement("path", {
      class: "playground-urinal-inner",
      d: "M361 142h98v90c0 34-19 60-49 60s-49-26-49-60v-90Z"
    }),
    createSvgElement("path", {
      class: "playground-urinal-inner-shadow",
      d: "M377 156h66v74c0 23-12 42-33 42s-33-19-33-42v-74Z"
    }),
    createSvgElement("path", {
      class: "playground-urinal-lip",
      d: "M359 132c25 12 78 12 102 0"
    }),
    createSvgElement("path", {
      class: "playground-urinal-highlight",
      d: "M432 135h34v112c0 20-9 36-23 45"
    }),
    createSvgElement("circle", { class: "playground-urinal-drain", cx: 410, cy: 257, r: 8 }),
    createSvgElement("path", {
      class: "playground-urinal-trap",
      d: "M390 312h40c-3 18-10 27-20 27s-17-9-20-27Z"
    }),
    createFixtureLabel("urinal", 336, 96)
  );
  return group;
}

function createSinkArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-sink" });
  group.append(
    createSvgElement("ellipse", { class: "fixture-shadow", cx: 644, cy: 347, rx: 106, ry: 17 }),
    createSvgElement("rect", { class: "playground-mirror-shadow", x: 568, y: 64, width: 172, height: 124, rx: 4 }),
    createSvgElement("rect", { class: "playground-mirror", x: 554, y: 54, width: 172, height: 124, rx: 2 }),
    createSvgElement("path", { class: "playground-mirror-glint", d: "M586 65l-43 90M673 62l-98 116M720 104l-66 74" }),
    createSvgElement("rect", { class: "playground-towel-rail", x: 738, y: 136, width: 72, height: 7, rx: 3 }),
    createSvgElement("path", { class: "playground-hand-towel", d: "M752 140h58v66h-58Z" }),
    createSvgElement("path", { class: "playground-hand-towel-shadow", d: "M752 184h58v22h-58Z" }),
    createSvgElement("path", {
      class: "playground-sink-tap",
      d: "M642 217v-58c0-16 12-29 28-29 17 0 29 13 29 29v12"
    }),
    createSvgElement("path", {
      class: "playground-sink-tap-highlight",
      d: "M656 216v-52c0-10 7-18 17-18"
    }),
    createSvgElement("rect", { class: "playground-sink-counter", x: 548, y: 222, width: 190, height: 28, rx: 4 }),
    createSvgElement("circle", { class: "playground-sink-handle-hot", cx: 592, cy: 223, r: 8 }),
    createSvgElement("circle", { class: "playground-sink-handle-cold", cx: 696, cy: 223, r: 8 }),
    createSvgElement("path", {
      class: "playground-sink-basin",
      d: "M540 238h208c10 0 18 8 18 18 0 50-42 90-94 90h-56c-52 0-94-40-94-90 0-10 8-18 18-18Z"
    }),
    createSvgElement("path", {
      class: "playground-sink-basin-side-shadow",
      d: "M716 242h29c8 0 15 6 15 14 0 38-24 71-60 83 20-26 30-58 16-97Z"
    }),
    createSvgElement("path", {
      class: "playground-sink-inner",
      d: "M579 270c31-16 101-16 132 0-8 22-32 35-66 35s-58-13-66-35Z"
    }),
    createSvgElement("path", {
      class: "playground-sink-rim-highlight",
      d: "M548 249c28 21 163 21 192 0"
    }),
    createSvgElement("circle", { class: "playground-sink-drain", cx: 644, cy: 279, r: 6 }),
    createSvgElement("path", {
      class: "playground-sink-pedestal",
      d: "M615 337h58l15 102H600l15-102Z"
    }),
    createSvgElement("path", {
      class: "playground-sink-pipe",
      d: "M644 337v46c0 14-8 23-24 23"
    }),
    createFixtureLabel("sink", 538, 50)
  );
  return group;
}

function createFloorArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-floor" });
  group.append(
    createSvgElement("path", {
      class: "playground-floor",
      d: "M42 340h736l-34 126H76L42 340Z"
    }),
    createSvgElement("path", {
      class: "playground-floor-depth",
      d: "M76 466l72-126M178 466l48-126M280 466l24-126M382 466l1-126M484 466l-23-126M586 466l-47-126M688 466l-71-126M52 374h716M62 414h696M72 448h676"
    }),
    createSvgElement("path", {
      class: "playground-floor-front-shadow",
      d: "M76 466h668"
    }),
    createFixtureLabel("floor", 62, 442, "fixture-label-floor")
  );
  return group;
}

function createFixtureBase(fixtureId) {
  if (fixtureId === "toilet") return createToiletArt();
  if (fixtureId === "urinal") return createUrinalArt();
  if (fixtureId === "sink") return createSinkArt();
  return createFloorArt();
}

function createStainOverlay(placement, scale) {
  const group = createSvgElement("g", {
    class: "dirt-overlay dirt-overlay-stain",
    transform: `translate(${placement.x} ${placement.y}) scale(${scale})`
  });
  group.append(
    createSvgElement("ellipse", { cx: 0, cy: 0, rx: 28, ry: 13 }),
    createSvgElement("circle", { cx: -20, cy: -3, r: 10 }),
    createSvgElement("circle", { cx: 18, cy: 4, r: 8 }),
    createSvgElement("circle", { cx: 2, cy: -13, r: 7 }),
    createSvgElement("circle", { cx: 30, cy: -6, r: 4 })
  );
  appendSvgTitle(group, "stain");
  return group;
}

function createWetOverlay(placement, scale) {
  const group = createSvgElement("g", {
    class: "dirt-overlay dirt-overlay-wet",
    transform: `translate(${placement.x} ${placement.y}) scale(${scale})`
  });
  group.append(
    createSvgElement("path", {
      d: "M-42 11c21-26 62-25 84 0-8 19-76 20-84 0Z"
    }),
    createSvgElement("path", {
      d: "M-18-11c6-13 13-24 18-33 6 9 14 21 18 33 5 18-5 30-18 30s-23-12-18-30Z"
    }),
    createSvgElement("circle", { cx: 34, cy: -15, r: 5 })
  );
  appendSvgTitle(group, "wet");
  return group;
}

function createTissueOverlay(placement, scale) {
  const group = createSvgElement("g", {
    class: "dirt-overlay dirt-overlay-tissue",
    transform: `translate(${placement.x} ${placement.y}) rotate(-8) scale(${scale})`
  });
  group.append(
    createSvgElement("path", {
      d: "M-36-11c18-10 36-6 54 2 9 4 17 4 27-2l5 27c-19 10-37 5-55-3-9-4-17-4-27 2l-4-26Z"
    }),
    createSvgElement("path", {
      class: "dirt-overlay-tissue-fold",
      d: "M-5-6l5 25M23-6l4 20"
    })
  );
  appendSvgTitle(group, "tissue");
  return group;
}

function createDustOverlay(placement, scale) {
  const group = createSvgElement("g", {
    class: "dirt-overlay dirt-overlay-dust",
    transform: `translate(${placement.x} ${placement.y}) scale(${scale})`
  });
  group.append(
    createSvgElement("circle", { cx: -32, cy: 7, r: 5 }),
    createSvgElement("circle", { cx: -18, cy: -8, r: 4 }),
    createSvgElement("circle", { cx: -5, cy: 9, r: 3 }),
    createSvgElement("circle", { cx: 10, cy: -4, r: 5 }),
    createSvgElement("circle", { cx: 25, cy: 8, r: 4 }),
    createSvgElement("circle", { cx: 36, cy: -9, r: 3 }),
    createSvgElement("path", {
      class: "dirt-overlay-dust-smear",
      d: "M-39 18c22 8 52 8 78 0"
    })
  );
  appendSvgTitle(group, "dust");
  return group;
}

function createUrineOverlay(placement, scale) {
  const group = createSvgElement("g", {
    class: "dirt-overlay dirt-overlay-urine",
    transform: `translate(${placement.x} ${placement.y}) scale(${scale})`
  });
  group.append(
    createSvgElement("path", {
      d: "M-43 8c15-25 59-25 86 0 4 25-80 27-86 0Z"
    }),
    createSvgElement("circle", { cx: -23, cy: -20, r: 5 }),
    createSvgElement("circle", { cx: 28, cy: -15, r: 4 }),
    createSvgElement("path", {
      class: "dirt-overlay-urine-shine",
      d: "M-24 1c16-8 35-8 52-1"
    })
  );
  appendSvgTitle(group, "urine");
  return group;
}

function createMudOverlay(placement, scale) {
  const group = createSvgElement("g", {
    class: "dirt-overlay dirt-overlay-mud",
    transform: `translate(${placement.x} ${placement.y}) rotate(-7) scale(${scale})`
  });
  group.append(
    createSvgElement("ellipse", { cx: -18, cy: 6, rx: 18, ry: 9 }),
    createSvgElement("circle", { cx: -35, cy: -7, r: 5 }),
    createSvgElement("circle", { cx: -25, cy: -13, r: 4 }),
    createSvgElement("circle", { cx: -12, cy: -13, r: 4 }),
    createSvgElement("ellipse", { cx: 22, cy: -3, rx: 18, ry: 9 }),
    createSvgElement("circle", { cx: 5, cy: -16, r: 5 }),
    createSvgElement("circle", { cx: 17, cy: -22, r: 4 }),
    createSvgElement("circle", { cx: 31, cy: -20, r: 4 })
  );
  appendSvgTitle(group, "mud");
  return group;
}

function createSoapOverlay(placement, scale) {
  const group = createSvgElement("g", {
    class: "dirt-overlay dirt-overlay-soap",
    transform: `translate(${placement.x} ${placement.y}) scale(${scale})`
  });
  group.append(
    createSvgElement("ellipse", { class: "dirt-overlay-soap-puddle", cx: 0, cy: 10, rx: 37, ry: 13 }),
    createSvgElement("circle", { cx: -22, cy: -7, r: 10 }),
    createSvgElement("circle", { cx: -5, cy: -17, r: 7 }),
    createSvgElement("circle", { cx: 15, cy: -8, r: 11 }),
    createSvgElement("circle", { cx: 31, cy: -20, r: 5 }),
    createSvgElement("circle", { cx: 36, cy: 2, r: 6 })
  );
  appendSvgTitle(group, "soap");
  return group;
}

function createHairOverlay(placement, scale) {
  const group = createSvgElement("g", {
    class: "dirt-overlay dirt-overlay-hair",
    transform: `translate(${placement.x} ${placement.y}) rotate(8) scale(${scale})`
  });
  group.append(
    createSvgElement("path", { d: "M-38 9c16-26 33 24 50-1 8-12 16-12 27-1" }),
    createSvgElement("path", { d: "M-31-7c18 18 35-16 56 3 5 5 10 9 18 9" }),
    createSvgElement("path", { d: "M-18 19c12-13 24-15 37-6 8 5 15 7 26 2" })
  );
  appendSvgTitle(group, "hair");
  return group;
}

function createDirtOverlay(placement) {
  const dirt = getDirtDefinition(placement.dirtId);
  const scale = dirt.scale ?? 0.8;

  if (placement.dirtId === "stain") return createStainOverlay(placement, scale);
  if (placement.dirtId === "wet") return createWetOverlay(placement, scale);
  if (placement.dirtId === "tissue") return createTissueOverlay(placement, scale);
  if (placement.dirtId === "dust") return createDustOverlay(placement, scale);
  if (placement.dirtId === "urine") return createUrineOverlay(placement, scale);
  if (placement.dirtId === "mud") return createMudOverlay(placement, scale);
  if (placement.dirtId === "soap") return createSoapOverlay(placement, scale);
  if (placement.dirtId === "hair") return createHairOverlay(placement, scale);
  return null;
}

function createRoomBackground() {
  const background = createSvgElement("g", { class: "playground-room" });
  background.append(
    createSvgElement("rect", { class: "playground-wall", x: 34, y: 34, width: 752, height: 310, rx: 18 }),
    createSvgElement("path", { class: "playground-side-wall", d: "M34 34h78l32 306H34Z" }),
    createSvgElement("path", {
      class: "playground-wall-tiles",
      d: "M34 96h752M34 158h752M34 220h752M34 282h752M112 34v306M174 34v306M236 34v306M298 34v306M360 34v306M422 34v306M484 34v306M546 34v306M608 34v306M670 34v306M732 34v306"
    }),
    createSvgElement("path", { class: "playground-window-light", d: "M44 48h84l28 296H44Z" }),
    createSvgElement("path", {
      class: "playground-window-blinds",
      d: "M42 62h84M45 88h87M48 114h90M51 140h92M54 166h95M57 192h98M60 218h101M63 244h104M66 270h107M69 296h110"
    }),
    createSvgElement("rect", { class: "playground-wall-band", x: 34, y: 282, width: 752, height: 58 }),
    createSvgElement("path", { class: "playground-wall-band-side", d: "M34 282h82l28 58H34Z" }),
    createSvgElement("path", { class: "playground-baseboard", d: "M42 338h736" }),
    createSvgElement("rect", { class: "playground-soap-dispenser", x: 728, y: 138, width: 26, height: 54, rx: 7 }),
    createSvgElement("circle", { class: "playground-soap-button", cx: 741, cy: 153, r: 4 })
  );
  return background;
}

export function createToiletScenePreview(sceneSnapshot) {
  if (!sceneSnapshotHasPlacements(sceneSnapshot)) return null;

  const wrapper = createElement("div", {
    className: "comment-scene-preview",
    attrs: { "aria-label": "Interactive scene submitted with this feedback" }
  });
  const svg = createSvgElement("svg", {
    class: "comment-scene-svg toilet-playground-svg",
    viewBox: "0 0 820 500",
    role: "img",
    "aria-label": "Submitted interactive toilet scene",
    focusable: "false"
  });

  svg.append(createRoomBackground());
  renderFixtureOrder.forEach((fixtureId) => {
    const fixtureGroup = createSvgElement("g", { class: `playground-fixture-preview playground-fixture-preview-${fixtureId}` });
    fixtureGroup.append(createFixtureBase(fixtureId));
    getFixturePlacements(sceneSnapshot.fixtures, fixtureId).forEach((placement) => {
      const overlay = createDirtOverlay(placement);
      if (overlay) fixtureGroup.append(overlay);
    });
    svg.append(fixtureGroup);
  });

  wrapper.append(svg);
  return wrapper;
}

function Fixture({ fixture, state, selectedDirt, onFixtureDrop, onFixtureSelect }) {
  const group = createSvgElement("g", {
    class: "playground-fixture",
    tabindex: "0",
    role: "button",
    "aria-label": `${fixture.label} drop target`,
    "data-fixture-id": fixture.id
  });

  group.append(createHighlightRect(fixture.id), createFixtureBase(fixture.id));

  getFixturePlacements(state, fixture.id).forEach((placement) => {
    const overlay = createDirtOverlay(placement);
    if (overlay) group.append(overlay);
  });

  group.addEventListener("dragover", (event) => {
    event.preventDefault();
    group.classList.add("is-drag-over");
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  });
  group.addEventListener("dragleave", () => group.classList.remove("is-drag-over"));
  group.addEventListener("drop", (event) => {
    event.preventDefault();
    group.classList.remove("is-drag-over");
    const dirtId =
      event.dataTransfer?.getData("application/x-wheretoi-dirt") ||
      event.dataTransfer?.getData("text/plain");
    onFixtureDrop(fixture.id, dirtId, getEventSvgPoint(event, fixture.id));
  });
  group.addEventListener("click", (event) => {
    onFixtureSelect(fixture.id, selectedDirt, getEventSvgPoint(event, fixture.id));
  });
  group.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onFixtureSelect(fixture.id, selectedDirt, getFixtureCenter(fixture.id));
  });

  return group;
}

function ToiletScene({ state, selectedDirt, onFixtureDrop, onFixtureSelect }) {
  const scenePanel = createElement("section", {
    className: "toilet-scene-panel",
    attrs: { "aria-label": "Interactive toilet scene" }
  });

  const svg = createSvgElement("svg", {
    class: "toilet-playground-svg",
    viewBox: "0 0 820 500",
    role: "img",
    "aria-label": "Realistic toilet scene with toilet, urinal, sink, and floor drop targets",
    focusable: "false"
  });

  svg.append(createRoomBackground());
  renderFixtureOrder.forEach((fixtureId) => {
    const fixture = fixtures.find((item) => item.id === fixtureId);
    if (!fixture) return;

    svg.append(
      Fixture({
        fixture,
        state,
        selectedDirt,
        onFixtureDrop,
        onFixtureSelect
      })
    );
  });

  scenePanel.append(svg);
  return scenePanel;
}

function StatusPanel({ state, lastAction, onReset, onPrepareUpload }) {
  const panel = createElement("aside", {
    className: "playground-status-panel",
    attrs: { "aria-label": "Toilet playground state" }
  });

  const title = createElement("h2", { text: "State" });
  const list = createElement("ul", { className: "playground-status-list" });

  getFixtureStatusRows(state).forEach((row) => {
    const item = createElement("li");
    const label = createElement("strong", { text: `${row.fixtureLabel}:` });
    const value = createElement("span", {
      text: row.dirtLabels.length > 0 ? row.dirtLabels.join(", ") : "clean"
    });
    item.append(label, value);
    list.append(item);
  });

  const liveStatus = createElement("p", {
    className: "playground-live-status",
    text: lastAction,
    attrs: { "aria-live": "polite" }
  });

  const actions = createElement("div", { className: "playground-actions" });
  const resetButton = createElement("button", {
    className: "outline-button playground-reset-button",
    text: "Reset",
    attrs: { type: "button" }
  });
  resetButton.addEventListener("click", onReset);

  const uploadButton = createElement("button", {
    className: "solid-button playground-upload-button",
    text: "Done",
    attrs: { type: "button" }
  });
  uploadButton.addEventListener("click", onPrepareUpload);
  actions.append(resetButton, uploadButton);

  panel.append(title, list, liveStatus, actions);
  return panel;
}

function ToiletPlayground({ state, selectedDirt, toilet, lastAction, callbacks }) {
  const wrapper = createElement("div", { className: "toilet-playground" });
  const header = createElement("header", { className: "toilet-playground-header" });
  const titleBlock = createElement("div");
  titleBlock.append(
    createElement("p", { className: "section-kicker", text: "ToiletPlayground" }),
    createElement("h2", {
      text: toilet?.name ? toilet.name : "Interactive toilet scene"
    })
  );
  header.append(titleBlock);

  const workspace = createElement("div", { className: "toilet-playground-workspace" });
  workspace.append(
    DirtToolbar({
      selectedDirt,
      onSelectDirt: callbacks.onSelectDirt,
      onDragStart: callbacks.onDragStart,
      onDragEnd: callbacks.onDragEnd
    }),
    ToiletScene({
      state,
      selectedDirt,
      onFixtureDrop: callbacks.onFixtureDrop,
      onFixtureSelect: callbacks.onFixtureSelect
    }),
    StatusPanel({
      state,
      lastAction,
      onReset: callbacks.onReset,
      onPrepareUpload: callbacks.onPrepareUpload
    })
  );

  wrapper.append(header, workspace);
  return wrapper;
}

export function createToiletPlayground(rootElement) {
  const defaultSceneKey = "__unselected_toilet__";
  const sceneStatesByKey = new Map([[defaultSceneKey, createInitialDirtState()]]);
  const sceneLastActionsByKey = new Map([[defaultSceneKey, "Ready"]]);

  let state = createInitialDirtState();
  let selectedDirt = null;
  let toilet = null;
  let lastAction = "Ready";
  let activeSceneKey = defaultSceneKey;

  function getSceneKey(nextToilet = toilet) {
    return nextToilet?.id ? String(nextToilet.id) : defaultSceneKey;
  }

  function getStoredSceneState(sceneKey) {
    if (!sceneStatesByKey.has(sceneKey)) {
      sceneStatesByKey.set(sceneKey, createInitialDirtState());
    }

    return sceneStatesByKey.get(sceneKey);
  }

  function setSceneState(nextState) {
    state = nextState;
    sceneStatesByKey.set(activeSceneKey, state);
  }

  function setSceneLastAction(message) {
    lastAction = message;
    sceneLastActionsByKey.set(activeSceneKey, message);
  }

  function canRender() {
    return Boolean(
      rootElement &&
      globalThis.document &&
      typeof document.createElement === "function" &&
      typeof document.createElementNS === "function"
    );
  }

  function render() {
    if (!canRender()) return;

    rootElement.replaceChildren(
      ToiletPlayground({
        state,
        selectedDirt,
        toilet,
        lastAction,
        callbacks: {
          onSelectDirt: selectDirt,
          onDragStart: handleDragStart,
          onDragEnd: handleDragEnd,
          onFixtureDrop: placeDirtOnFixture,
          onFixtureSelect: handleFixtureSelect,
          onReset: reset,
          onPrepareUpload: prepareUpload
        }
      })
    );
  }

  function selectDirt(dirtId) {
    if (!validDirtIds.has(dirtId)) return;
    selectedDirt = dirtId;
    setSceneLastAction(`${getDirtLabel(dirtId)} selected`);
    render();
  }

  function handleDragStart(event, dirtId) {
    if (!validDirtIds.has(dirtId)) return;
    event.dataTransfer?.setData("application/x-wheretoi-dirt", dirtId);
    event.dataTransfer?.setData("text/plain", dirtId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "copy";
    }
  }

  function handleDragEnd() {
    rootElement?.querySelectorAll?.(".is-drag-over").forEach((target) => {
      target.classList.remove("is-drag-over");
    });
  }

  function placeDirtOnFixture(fixtureId, dirtId, point) {
    if (!validFixtureIds.has(fixtureId) || !validDirtIds.has(dirtId)) return;

    setSceneState(addDirtToFixture(state, fixtureId, dirtId, point));
    selectedDirt = dirtId;
    const placementCount = getFixturePlacements(state, fixtureId).length;
    setSceneLastAction(`${getDirtLabel(dirtId)} on ${getFixtureLabel(fixtureId)} (${placementCount})`);
    render();
  }

  function handleFixtureSelect(fixtureId, dirtId, point) {
    if (!dirtId) {
      setSceneLastAction("Select dirt first");
      render();
      return;
    }

    placeDirtOnFixture(fixtureId, dirtId, point);
  }

  function reset() {
    setSceneState(createInitialDirtState());
    selectedDirt = null;
    setSceneLastAction("Ready");
    render();
  }

  function prepareUpload() {
    const snapshot = {
      ...createSceneSnapshot(state, toilet),
      updatedAt: new Date().toISOString()
    };

    try {
      const storedScenes = JSON.parse(globalThis.window?.localStorage?.getItem(uploadStorageKey) ?? "{}");
      storedScenes[activeSceneKey] = snapshot;
      globalThis.window?.localStorage?.setItem(uploadStorageKey, JSON.stringify(storedScenes));
      setSceneLastAction("Scene ready for feedback");
    } catch {
      setSceneLastAction("Scene ready");
    }

    render();
  }

  function setContext(nextToilet) {
    toilet = nextToilet ?? null;
    activeSceneKey = getSceneKey(toilet);
    state = getStoredSceneState(activeSceneKey);
    lastAction = sceneLastActionsByKey.get(activeSceneKey) ?? "Ready";
    render();
  }

  function getState() {
    return createSceneSnapshot(state, toilet);
  }

  function getSubmissionSnapshot() {
    if (getScenePlacementCount(state) === 0) return null;
    return createSceneSnapshot(state, toilet);
  }

  render();

  return {
    getSubmissionSnapshot,
    getState,
    reset,
    setContext
  };
}
