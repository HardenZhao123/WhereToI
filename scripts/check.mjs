import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const requiredFiles = [
  "index.html",
  "src/main.js",
  "src/app/app.js",
  "src/app/controllers/map-controller.js",
  "src/app/controllers/account-controller.js",
  "src/app/controllers/tab-controller.js",
  "src/app/services/http-client.js",
  "src/app/services/toilets-service.js",
  "src/app/services/account-service.js",
  "src/app/views/account-view.js",
  "src/app/config/app-config.js",
  "src/app/config/dom-refs.js",
  "src/app/config/fallback-toilets.js",
  "src/app/toilets/toilet-record-mapper.js",
  "src/app/utils/csv.js",
  "src/app/utils/geo.js",
  "src/app/utils/text.js",
  "src/app/utils/account-formatters.js",
  "src/styles.css",
  "scripts/build.mjs",
  "server/app-server.mjs",
  "server/database.mjs",
  "render.yaml"
];

await Promise.all(requiredFiles.map((file) => access(resolve(file))));

const html = await readFile("index.html", "utf8");
const css = await readFile("src/styles.css", "utf8");
const jsFiles = requiredFiles.filter((file) => file.startsWith("src/") && file.endsWith(".js"));
const js = (await Promise.all(jsFiles.map((file) => readFile(file, "utf8")))).join("\n");

const requiredCopy = ["Map", "Access QR", "Account", "Wallet balance", "Toilet Access Pass", "Directions"];
const missingCopy = requiredCopy.filter((text) => !html.includes(text));

if (missingCopy.length > 0) {
  throw new Error(`Missing expected UI copy: ${missingCopy.join(", ")}`);
}

if (
  !html.includes("leaflet@1.9.4/dist/leaflet.css") ||
  !html.includes("leaflet@1.9.4/dist/leaflet.js") ||
  !js.includes("window.L.map") ||
  !js.includes("navigator.geolocation") ||
  !js.includes("google.com/maps/dir")
) {
  throw new Error("Expected interactive map, geolocation, and directions integration.");
}

if (!html.includes("close-details") || !js.includes("closeDetailsButton")) {
  throw new Error("Expected closable toilet details panel.");
}

if (!html.includes("activate-pass") || !js.includes("access-history") || !js.includes("activatePass")) {
  throw new Error("Expected QR pass activation to persist via API/database.");
}

if (!css.includes("@media") || !js.includes("setTab")) {
  throw new Error("Expected responsive CSS and tab interaction code.");
}

if (!css.includes(".map-canvas") || !css.includes(".map-marker") || !css.includes(".map-marker-icon")) {
  throw new Error("Expected interactive map canvas and marker styling.");
}

console.log("Static app checks passed.");
