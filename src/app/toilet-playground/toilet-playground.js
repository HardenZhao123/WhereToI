const svgNamespace = "http://www.w3.org/2000/svg";
const uploadStorageKey = "wheretoi-toilet-playground-scenes";

export const dirtTypes = [
  { id: "stain", label: "stain", scale: 0.86 },
  { id: "wet", label: "wet", scale: 0.82 },
  { id: "tissue", label: "tissue", scale: 0.78 },
  { id: "dust", label: "dust", scale: 0.84 },
  { id: "urine", label: "urine", scale: 0.78 },
  { id: "feces", label: "feces", scale: 0.8 },
  { id: "mud", label: "mud", scale: 0.82 },
  { id: "soap", label: "soap", scale: 0.8 },
  { id: "hair", label: "hair", scale: 0.82 }
];

export const fixtures = [
  { id: "wall", label: "Wall" },
  { id: "toilet", label: "Toilet" },
  { id: "urinal", label: "Urinal" },
  { id: "accessibleSupport", label: "Support rails" },
  { id: "accessibleAlarm", label: "Emergency alarm" },
  { id: "accessibleDispenser", label: "Reachable dispenser" },
  { id: "accessibleMirror", label: "Low mirror" },
  { id: "womenSanitaryBin", label: "Sanitary bin" },
  { id: "womenProductDispenser", label: "Product dispenser" },
  { id: "womenShelf", label: "Shelf & hook" },
  { id: "sink", label: "Sink" },
  { id: "floor", label: "Floor" }
];

const sceneTypes = {
  standard: {
    id: "standard",
    label: "Men's toilet scene",
    optionLabel: "Men",
    fixtureIds: ["wall", "toilet", "urinal", "sink", "floor"],
    ariaLabel: "Realistic men's toilet scene with toilet, urinal, sink, and floor drop targets"
  },
  women: {
    id: "women",
    label: "Women's toilet scene",
    optionLabel: "Women",
    fixtureIds: ["wall", "toilet", "womenProductDispenser", "womenShelf", "womenSanitaryBin", "sink", "floor"],
    ariaLabel: "Realistic women's toilet scene with toilet, sink, and floor drop targets"
  },
  accessible: {
    id: "accessible",
    label: "Accessible toilet scene",
    optionLabel: "Accessible",
    fixtureIds: ["wall", "toilet", "accessibleSupport", "accessibleAlarm", "accessibleDispenser", "accessibleMirror", "sink", "floor"],
    ariaLabel: "Accessible toilet scene with toilet, support rails, emergency cord, sink, and floor drop targets"
  }
};

const fixtureHitBoxes = {
  wall: { x: 34, y: 34, width: 752, height: 306 },
  toilet: { x: 64, y: 118, width: 244, height: 238 },
  urinal: { x: 316, y: 78, width: 184, height: 268 },
  accessibleSupport: [
    { x: 68, y: 216, width: 166, height: 34 },
    { x: 72, y: 282, width: 112, height: 30 },
    { x: 112, y: 176, width: 148, height: 34 },
    { x: 266, y: 204, width: 30, height: 114 },
    { x: 408, y: 104, width: 86, height: 78 }
  ],
  accessibleAlarm: [
    { x: 326, y: 64, width: 18, height: 306 },
    { x: 350, y: 204, width: 50, height: 42 },
    { x: 316, y: 342, width: 36, height: 34 }
  ],
  accessibleDispenser: { x: 226, y: 150, width: 78, height: 96 },
  accessibleMirror: { x: 502, y: 86, width: 62, height: 112 },
  womenSanitaryBin: { x: 286, y: 252, width: 64, height: 112 },
  womenProductDispenser: { x: 346, y: 98, width: 134, height: 108 },
  womenShelf: { x: 360, y: 214, width: 144, height: 54 },
  sink: [
    { x: 522, y: 222, width: 244, height: 124 },
    { x: 632, y: 126, width: 78, height: 96 },
    { x: 554, y: 54, width: 172, height: 124 },
    { x: 738, y: 136, width: 72, height: 70 },
    { x: 596, y: 337, width: 96, height: 108 }
  ],
  floor: { x: 42, y: 340, width: 736, height: 126 }
};

const renderFixtureOrder = [
  "wall",
  "floor",
  "toilet",
  "accessibleSupport",
  "womenSanitaryBin",
  "womenProductDispenser",
  "womenShelf",
  "accessibleDispenser",
  "accessibleAlarm",
  "accessibleMirror",
  "urinal",
  "sink"
];
const validFixtureIds = new Set(fixtures.map((fixture) => fixture.id));
const validDirtIds = new Set(dirtTypes.map((dirt) => dirt.id));

function hasEnabledFeature(value) {
  if (value === true || value === 1) return true;

  const normalised = String(value ?? "").trim().toUpperCase();
  return normalised === "Y" || normalised === "TRUE" || normalised === "1";
}

function getSceneTypeForToilet(toilet = null) {
  const features = toilet?.features ?? {};
  if (hasEnabledFeature(features.accessible)) return sceneTypes.accessible;

  const hasWomen = hasEnabledFeature(features.women);
  const hasMen = hasEnabledFeature(features.men);
  if (hasWomen && !hasMen) return sceneTypes.women;

  return sceneTypes.standard;
}

function getAvailableSceneTypesForToilet(toilet = null) {
  const features = toilet?.features ?? {};
  const availableSceneTypes = [];

  if (hasEnabledFeature(features.men)) {
    availableSceneTypes.push(sceneTypes.standard);
  }

  if (hasEnabledFeature(features.women)) {
    availableSceneTypes.push(sceneTypes.women);
  }

  if (hasEnabledFeature(features.accessible)) {
    availableSceneTypes.push(sceneTypes.accessible);
  }

  if (availableSceneTypes.length === 0) {
    availableSceneTypes.push(getSceneTypeForToilet(toilet));
  }

  return availableSceneTypes;
}

function getSceneTypeFromSnapshot(sceneSnapshot = null) {
  const sceneType = sceneTypes[String(sceneSnapshot?.sceneType ?? "")];
  if (sceneType) return sceneType;

  const activeFixtureIds = Array.isArray(sceneSnapshot?.activeFixtures)
    ? sceneSnapshot.activeFixtures.filter((fixtureId) => validFixtureIds.has(fixtureId))
    : [];

  if (activeFixtureIds.length > 0 && !activeFixtureIds.includes("urinal")) {
    return sceneTypes.women;
  }

  return sceneTypes.standard;
}

function getFixtureList(fixtureIds = sceneTypes.standard.fixtureIds) {
  return fixtureIds
    .map((fixtureId) => fixtures.find((fixture) => fixture.id === fixtureId))
    .filter(Boolean);
}

function getRenderFixtureOrder(sceneType = sceneTypes.standard) {
  return renderFixtureOrder.filter((fixtureId) => sceneType.fixtureIds.includes(fixtureId));
}

function getDirtDefinition(dirtId) {
  return dirtTypes.find((dirt) => dirt.id === dirtId) ?? dirtTypes[0];
}

function getDirtLabel(dirtId) {
  return getDirtDefinition(dirtId).label ?? dirtId;
}

function getFixtureLabel(fixtureId) {
  return fixtures.find((fixture) => fixture.id === fixtureId)?.label ?? fixtureId;
}

function getFixtureHitBoxes(fixtureId) {
  const hitBox = fixtureHitBoxes[fixtureId] ?? fixtureHitBoxes.floor;
  return Array.isArray(hitBox) ? hitBox : [hitBox];
}

function getPrimaryFixtureHitBox(fixtureId) {
  return getFixtureHitBoxes(fixtureId)[0] ?? fixtureHitBoxes.floor;
}

function getFixtureCenter(fixtureId) {
  const hitBox = getPrimaryFixtureHitBox(fixtureId);
  return {
    x: hitBox.x + hitBox.width / 2,
    y: hitBox.y + hitBox.height / 2
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampPointToFixture(fixtureId, point = getFixtureCenter(fixtureId)) {
  const hitBoxes = getFixtureHitBoxes(fixtureId);
  const normalisedPoint = {
    x: Number(point.x),
    y: Number(point.y)
  };

  if (!Number.isFinite(normalisedPoint.x) || !Number.isFinite(normalisedPoint.y)) {
    return getFixtureCenter(fixtureId);
  }

  const containingHitBox = hitBoxes.find((hitBox) => {
    return (
      normalisedPoint.x >= hitBox.x &&
      normalisedPoint.x <= hitBox.x + hitBox.width &&
      normalisedPoint.y >= hitBox.y &&
      normalisedPoint.y <= hitBox.y + hitBox.height
    );
  });

  if (containingHitBox) {
    return {
      x: Math.round(normalisedPoint.x),
      y: Math.round(normalisedPoint.y)
    };
  }

  const closestPoint = hitBoxes
    .map((hitBox) => {
      const x = clamp(normalisedPoint.x, hitBox.x, hitBox.x + hitBox.width);
      const y = clamp(normalisedPoint.y, hitBox.y, hitBox.y + hitBox.height);
      return {
        x,
        y,
        distance: (x - normalisedPoint.x) ** 2 + (y - normalisedPoint.y) ** 2
      };
    })
    .sort((first, second) => first.distance - second.distance)[0];

  return {
    x: Math.round(closestPoint.x),
    y: Math.round(closestPoint.y)
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

function getScenePlacementCount(state, sceneType = sceneTypes.standard) {
  return getFixtureList(sceneType.fixtureIds).reduce((total, fixture) => {
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

export function getFixtureStatusRows(state, fixtureIds = sceneTypes.standard.fixtureIds) {
  return getFixtureList(fixtureIds).map((fixture) => {
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

export function createSceneSnapshot(state, toilet = null, selectedSceneType = null) {
  const sceneType = sceneTypes[selectedSceneType?.id] ?? getSceneTypeForToilet(toilet);
  const fixtureSnapshot = {
    ...createInitialDirtState()
  };

  getFixtureStatusRows(state, sceneType.fixtureIds).forEach((row) => {
    fixtureSnapshot[row.fixtureId] = row.placements.map((placement) => ({
      id: placement.id,
      dirtId: placement.dirtId,
      x: placement.x,
      y: placement.y
    }));
  });

  return {
    version: 3,
    sceneType: sceneType.id,
    activeFixtures: [...sceneType.fixtureIds],
    toiletId: toilet?.id ?? null,
    toiletName: toilet?.name ?? "",
    fixtures: fixtureSnapshot
  };
}

export function sceneSnapshotHasPlacements(sceneSnapshot) {
  const sceneType = getSceneTypeFromSnapshot(sceneSnapshot);
  return getFixtureList(sceneType.fixtureIds).some((fixture) => {
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
  const hitBoxes = getFixtureHitBoxes(fixtureId);
  const createRect = (hitBox) => createSvgElement("rect", {
    class: "fixture-highlight",
    x: hitBox.x,
    y: hitBox.y,
    width: hitBox.width,
    height: hitBox.height,
    rx: fixtureId === "floor" || fixtureId === "wall" ? 8 : 18
  });

  if (hitBoxes.length === 1) {
    return createRect(hitBoxes[0]);
  }

  const group = createSvgElement("g", { class: "fixture-highlight-group" });
  hitBoxes.forEach((hitBox) => group.append(createRect(hitBox)));
  return group;
}

function createWallArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-wall" });
  group.append(createFixtureLabel("wall", 52, 72));
  return group;
}

function createToiletArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-toilet" });
  group.append(
    createSvgElement("ellipse", { class: "fixture-shadow", cx: 184, cy: 347, rx: 108, ry: 16 }),
    createSvgElement("path", {
      class: "playground-toilet-wall-pipe",
      d: "M184 215v34"
    }),
    createSvgElement("rect", { class: "playground-toilet-tank", x: 108, y: 132, width: 152, height: 82, rx: 9 }),
    createSvgElement("path", {
      class: "playground-toilet-tank-face",
      d: "M119 145h130v58H119Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-tank-shadow",
      d: "M224 140h26v66h-26Z"
    }),
    createSvgElement("rect", { class: "playground-toilet-tank-top", x: 98, y: 124, width: 172, height: 14, rx: 5 }),
    createSvgElement("ellipse", { class: "playground-toilet-flush-button", cx: 236, cy: 132, rx: 11, ry: 4 }),
    createSvgElement("path", {
      class: "playground-toilet-tank-bottom-shadow",
      d: "M117 212h134"
    }),
    createSvgElement("path", {
      class: "playground-toilet-rear-neck",
      d: "M146 214h76c9 0 16 7 16 16v22H130v-22c0-9 7-16 16-16Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-bowl-body",
      d: "M88 254c0-36 38-60 96-60s96 24 96 60c0 48-41 87-96 87s-96-39-96-87Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-side-shadow",
      d: "M230 207c32 12 50 29 50 51 0 38-27 71-68 82 26-27 40-70 18-133Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-seat",
      d: "M105 248c7-30 39-49 79-49s72 19 79 49c-8 24-38 40-79 40s-71-16-79-40Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-seat-opening",
      d: "M134 249c7-16 27-27 50-27s43 11 50 27c-8 14-27 22-50 22s-42-8-50-22Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-water",
      d: "M147 252c10-9 64-9 74 0-9 8-65 8-74 0Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-rim-highlight",
      d: "M112 242c18-22 47-34 72-34s54 12 72 34"
    }),
    createSvgElement("path", {
      class: "playground-toilet-pedestal",
      d: "M143 318h82l17 31H126l17-31Z"
    }),
    createSvgElement("path", {
      class: "playground-toilet-floor-foot",
      d: "M111 346h145c8 0 14 6 14 14H97c0-8 6-14 14-14Z"
    }),
    createSvgElement("circle", { class: "playground-toilet-floor-bolt", cx: 126, cy: 354, r: 4 }),
    createSvgElement("circle", { class: "playground-toilet-floor-bolt", cx: 242, cy: 354, r: 4 }),
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
      class: "playground-urinal-drain-slots",
      d: "M402 257h16M410 249v16"
    }),
    createSvgElement("path", {
      class: "playground-urinal-trap",
      d: "M390 312h40c-3 18-10 27-20 27s-17-9-20-27Z"
    }),
    createFixtureLabel("urinal", 336, 96)
  );
  return group;
}

function createAccessibleSupportArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-accessible-support" });
  group.append(
    createSvgElement("circle", { class: "playground-accessible-turning-space", cx: 404, cy: 412, r: 72 }),
    createSvgElement("path", {
      class: "playground-accessible-turning-arrow",
      d: "M371 375c31-22 78-9 93 27M464 402l-7-27 26 9"
    }),
    createSvgElement("rect", { class: "playground-accessible-backrest", x: 116, y: 182, width: 136, height: 18, rx: 8 }),
    createSvgElement("path", {
      class: "playground-accessible-wall-rail",
      d: "M72 232h102c18 0 36 10 47 26"
    }),
    createSvgElement("path", { class: "playground-accessible-wall-rail", d: "M76 294h88" }),
    createSvgElement("circle", { class: "playground-accessible-rail-mount", cx: 278, cy: 216, r: 8 }),
    createSvgElement("circle", { class: "playground-accessible-rail-mount", cx: 278, cy: 304, r: 8 }),
    createSvgElement("path", {
      class: "playground-accessible-drop-rail",
      d: "M278 214v92"
    }),
    createSvgElement("path", {
      class: "playground-accessible-drop-rail-shadow",
      d: "M291 219v84"
    }),
    createSvgElement("rect", { class: "playground-accessible-sign", x: 408, y: 104, width: 86, height: 78, rx: 10 }),
    createSvgElement("circle", { class: "playground-accessible-sign-symbol", cx: 440, cy: 130, r: 7 }),
    createSvgElement("path", {
      class: "playground-accessible-sign-symbol",
      d: "M440 142v19h24M440 151h17M462 161c7 0 13 6 13 13s-6 13-13 13-13-6-13-13"
    })
  );
  appendSvgTitle(group, "accessible toilet support rails, transfer space, backrest, and accessibility sign");
  return group;
}

function createAccessibleAlarmArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-accessible-alarm" });
  group.append(
    createSvgElement("rect", { class: "playground-accessible-alarm-reset", x: 354, y: 206, width: 42, height: 34, rx: 8 }),
    createSvgElement("circle", { class: "playground-accessible-alarm-reset-button", cx: 374, cy: 223, r: 7 }),
    createSvgElement("path", {
      class: "playground-accessible-emergency-cord",
      d: "M334 68v278"
    }),
    createSvgElement("circle", { class: "playground-accessible-cord-pull", cx: 334, cy: 356, r: 13 }),
    createSvgElement("path", { class: "playground-accessible-cord-pull-tab", d: "M334 342l-13 22h26Z" })
  );
  appendSvgTitle(group, "accessible toilet emergency alarm cord and reset button");
  return group;
}

function createAccessibleDispenserArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-accessible-dispenser" });
  group.append(
    createSvgElement("rect", { class: "playground-accessible-paper-dispenser", x: 236, y: 158, width: 52, height: 46, rx: 8 }),
    createSvgElement("path", { class: "playground-accessible-paper-slot", d: "M247 183h30" })
  );
  appendSvgTitle(group, "reachable paper dispenser");
  return group;
}

function createAccessibleMirrorArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-accessible-mirror" });
  group.append(
    createSvgElement("rect", { class: "playground-accessible-lower-mirror", x: 510, y: 96, width: 46, height: 94, rx: 4 }),
    createSvgElement("path", { class: "playground-accessible-lower-mirror-glint", d: "M520 112l28 54M548 120l-28 60" })
  );
  appendSvgTitle(group, "low accessible mirror");
  return group;
}

function createWomenSanitaryBinArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-women-sanitary-bin" });
  group.append(
    createSvgElement("rect", { class: "playground-women-sanitary-bin-shadow", x: 292, y: 326, width: 54, height: 14, rx: 7 }),
    createSvgElement("path", {
      class: "playground-women-sanitary-bin",
      d: "M292 276h52l-7 72h-38l-7-72Z"
    }),
    createSvgElement("path", { class: "playground-women-sanitary-bin-lid", d: "M286 272h64c-2-12-12-20-32-20s-30 8-32 20Z" }),
    createSvgElement("path", { class: "playground-women-sanitary-bin-pedal", d: "M306 350h26" })
  );
  appendSvgTitle(group, "women's toilet sanitary bin");
  return group;
}

function createWomenProductDispenserArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-women-product-dispenser" });
  group.append(
    createSvgElement("rect", { class: "playground-women-product-dispenser", x: 354, y: 108, width: 116, height: 94, rx: 10 }),
    createSvgElement("rect", { class: "playground-women-product-window", x: 372, y: 126, width: 32, height: 42, rx: 4 }),
    createSvgElement("rect", { class: "playground-women-product-window", x: 420, y: 126, width: 32, height: 42, rx: 4 }),
    createSvgElement("path", { class: "playground-women-product-slot", d: "M372 184h80" })
  );
  appendSvgTitle(group, "women's toilet sanitary product dispenser");
  return group;
}

function createWomenShelfArt() {
  const group = createSvgElement("g", { class: "fixture-art fixture-art-women-shelf" });
  group.append(
    createSvgElement("path", { class: "playground-women-wall-shelf", d: "M352 226h118" }),
    createSvgElement("path", { class: "playground-women-wall-shelf-bracket", d: "M374 226l-18 22M448 226l18 22" }),
    createSvgElement("circle", { class: "playground-women-bag-hook-base", cx: 486, cy: 220, r: 11 }),
    createSvgElement("path", { class: "playground-women-bag-hook", d: "M486 223c0 18-24 18-24 2" })
  );
  appendSvgTitle(group, "women's toilet shelf and bag hook");
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
    createSvgElement("circle", { class: "playground-sink-overflow", cx: 644, cy: 263, r: 4 }),
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
    createSvgElement("circle", { class: "playground-floor-drain-ring", cx: 502, cy: 430, r: 14 }),
    createSvgElement("path", {
      class: "playground-floor-drain-lines",
      d: "M490 430h24M502 418v24M493 421l18 18M511 421l-18 18"
    }),
    createSvgElement("path", {
      class: "playground-floor-scuffs",
      d: "M146 393c22 7 43 6 61-3M608 392c27 6 50 4 71-5M318 442c18 5 37 5 55 0"
    }),
    createFixtureLabel("floor", 62, 442, "fixture-label-floor")
  );
  return group;
}

function createFixtureBase(fixtureId) {
  if (fixtureId === "wall") return createWallArt();
  if (fixtureId === "toilet") return createToiletArt();
  if (fixtureId === "urinal") return createUrinalArt();
  if (fixtureId === "accessibleSupport") return createAccessibleSupportArt();
  if (fixtureId === "accessibleAlarm") return createAccessibleAlarmArt();
  if (fixtureId === "accessibleDispenser") return createAccessibleDispenserArt();
  if (fixtureId === "accessibleMirror") return createAccessibleMirrorArt();
  if (fixtureId === "womenSanitaryBin") return createWomenSanitaryBinArt();
  if (fixtureId === "womenProductDispenser") return createWomenProductDispenserArt();
  if (fixtureId === "womenShelf") return createWomenShelfArt();
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

function createFecesOverlay(placement, scale) {
  const group = createSvgElement("g", {
    class: "dirt-overlay dirt-overlay-feces",
    transform: `translate(${placement.x} ${placement.y}) scale(${scale})`
  });
  group.append(
    createSvgElement("ellipse", { class: "dirt-overlay-feces-shadow", cx: 0, cy: 18, rx: 30, ry: 8 }),
    createSvgElement("path", {
      d: "M-31 12c3-16 22-22 38-12 11 7 24 9 31 19-13 11-55 11-69-7Z"
    }),
    createSvgElement("path", {
      d: "M-15-2c2-13 16-18 28-10 8 6 13 14 12 25-13 3-28 0-40-15Z"
    }),
    createSvgElement("path", {
      d: "M-3-18c2-10 12-14 21-8 6 4 9 11 8 19-11 2-21-1-29-11Z"
    })
  );
  appendSvgTitle(group, "feces");
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
  if (placement.dirtId === "feces") return createFecesOverlay(placement, scale);
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
  const sceneType = getSceneTypeFromSnapshot(sceneSnapshot);

  const wrapper = createElement("div", {
    className: "comment-scene-preview",
    attrs: { "aria-label": "Interactive scene submitted with this feedback" }
  });
  const svg = createSvgElement("svg", {
    class: "comment-scene-svg toilet-playground-svg",
    viewBox: "0 0 820 500",
    role: "img",
    "aria-label": `Submitted ${sceneType.label.toLowerCase()}`,
    focusable: "false"
  });

  svg.append(createRoomBackground());
  getRenderFixtureOrder(sceneType).forEach((fixtureId) => {
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

function ToiletScene({ state, selectedDirt, sceneType, onFixtureDrop, onFixtureSelect }) {
  const scenePanel = createElement("section", {
    className: "toilet-scene-panel",
    attrs: { "aria-label": sceneType.label }
  });

  const svg = createSvgElement("svg", {
    class: "toilet-playground-svg",
    viewBox: "0 0 820 500",
    role: "img",
    "aria-label": sceneType.ariaLabel,
    focusable: "false"
  });

  svg.append(createRoomBackground());
  getRenderFixtureOrder(sceneType).forEach((fixtureId) => {
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

function StatusPanel({ state, lastAction, sceneType, onReset, onPrepareUpload }) {
  const panel = createElement("aside", {
    className: "playground-status-panel",
    attrs: { "aria-label": "Toilet playground state" }
  });

  const title = createElement("h2", { text: "State" });
  const list = createElement("ul", { className: "playground-status-list" });

  getFixtureStatusRows(state, sceneType.fixtureIds).forEach((row) => {
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

function SceneTypeSelector({ sceneType, availableSceneTypes, onSelectSceneType }) {
  const control = createElement("div", {
    className: "scene-type-selector",
    attrs: { "aria-label": "Interactive scene type" }
  });
  const label = createElement("span", { className: "scene-type-label", text: "Scene" });
  const options = createElement("div", { className: "scene-type-options", attrs: { role: "group" } });

  availableSceneTypes.forEach((availableSceneType) => {
    const button = createElement("button", {
      className: "scene-type-option",
      text: availableSceneType.optionLabel,
      attrs: {
        type: "button",
        "aria-pressed": String(availableSceneType.id === sceneType.id)
      },
      dataset: { sceneType: availableSceneType.id }
    });
    button.classList.toggle("is-selected", availableSceneType.id === sceneType.id);
    button.addEventListener("click", () => onSelectSceneType(availableSceneType.id));
    options.append(button);
  });

  control.append(label, options);
  return control;
}

function ToiletPlayground({ state, selectedDirt, toilet, sceneType, availableSceneTypes, lastAction, callbacks }) {
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
  if (availableSceneTypes.length > 1) {
    header.append(
      SceneTypeSelector({
        sceneType,
        availableSceneTypes,
        onSelectSceneType: callbacks.onSelectSceneType
      })
    );
  }

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
      sceneType,
      onFixtureDrop: callbacks.onFixtureDrop,
      onFixtureSelect: callbacks.onFixtureSelect
    }),
    StatusPanel({
      state,
      lastAction,
      sceneType,
      onReset: callbacks.onReset,
      onPrepareUpload: callbacks.onPrepareUpload
    })
  );

  wrapper.append(header, workspace);
  return wrapper;
}

export function createToiletPlayground(rootElement, options = {}) {
  const { onDone = () => {} } = options;
  const defaultToiletKey = "__unselected_toilet__";
  const defaultSceneKey = `${defaultToiletKey}::${sceneTypes.standard.id}`;
  const sceneStatesByKey = new Map([[defaultSceneKey, createInitialDirtState()]]);
  const sceneLastActionsByKey = new Map([[defaultSceneKey, "Ready"]]);
  const sceneTypeByToiletKey = new Map();

  let state = createInitialDirtState();
  let selectedDirt = null;
  let toilet = null;
  let lastAction = "Ready";
  let activeSceneKey = defaultSceneKey;
  let activeSceneType = sceneTypes.standard;

  function getToiletKey(nextToilet = toilet) {
    return nextToilet?.id ? String(nextToilet.id) : defaultToiletKey;
  }

  function getSceneKey(nextToilet = toilet, nextSceneType = activeSceneType) {
    return `${getToiletKey(nextToilet)}::${nextSceneType.id}`;
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
        sceneType: activeSceneType,
        availableSceneTypes: getAvailableSceneTypesForToilet(toilet),
        lastAction,
        callbacks: {
          onSelectDirt: selectDirt,
          onSelectSceneType: selectSceneType,
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

  function selectSceneType(sceneTypeId) {
    const nextSceneType = sceneTypes[sceneTypeId];
    const availableSceneTypes = getAvailableSceneTypesForToilet(toilet);
    if (!nextSceneType || !availableSceneTypes.some((sceneTypeOption) => sceneTypeOption.id === nextSceneType.id)) {
      return;
    }

    const toiletKey = getToiletKey(toilet);
    sceneTypeByToiletKey.set(toiletKey, nextSceneType.id);
    activeSceneType = nextSceneType;
    activeSceneKey = getSceneKey(toilet, activeSceneType);
    state = getStoredSceneState(activeSceneKey);
    lastAction = sceneLastActionsByKey.get(activeSceneKey) ?? "Ready";
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
    if (
      !validFixtureIds.has(fixtureId) ||
      !activeSceneType.fixtureIds.includes(fixtureId) ||
      !validDirtIds.has(dirtId)
    ) {
      return;
    }

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
      ...createSceneSnapshot(state, toilet, activeSceneType),
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
    onDone(getSubmissionSnapshot());
  }

  function setContext(nextToilet) {
    toilet = nextToilet ?? null;
    const toiletKey = getToiletKey(toilet);
    const availableSceneTypes = getAvailableSceneTypesForToilet(toilet);
    const storedSceneType = sceneTypes[sceneTypeByToiletKey.get(toiletKey)];
    activeSceneType = storedSceneType && availableSceneTypes.some((sceneTypeOption) => sceneTypeOption.id === storedSceneType.id)
      ? storedSceneType
      : getSceneTypeForToilet(toilet);
    activeSceneKey = getSceneKey(toilet, activeSceneType);
    state = getStoredSceneState(activeSceneKey);
    lastAction = sceneLastActionsByKey.get(activeSceneKey) ?? "Ready";
    render();
  }

  function getState() {
    return createSceneSnapshot(state, toilet, activeSceneType);
  }

  function getSubmissionSnapshot() {
    if (getScenePlacementCount(state, activeSceneType) === 0) return null;
    return createSceneSnapshot(state, toilet, activeSceneType);
  }

  render();

  return {
    getSubmissionSnapshot,
    getState,
    reset,
    setSceneType: selectSceneType,
    setContext
  };
}
