import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const requiredFiles = [
  "index.html",
  "src/main.js",
  "src/styles.css",
  "scripts/build.mjs"
];

await Promise.all(requiredFiles.map((file) => access(resolve(file))));

const html = await readFile("index.html", "utf8");
const css = await readFile("src/styles.css", "utf8");
const js = await readFile("src/main.js", "utf8");

const requiredCopy = ["Map", "Access QR", "Account", "Wallet balance", "Toilet Access Pass", "Directions"];
const missingCopy = requiredCopy.filter((text) => !html.includes(text));

if (missingCopy.length > 0) {
  throw new Error(`Missing expected UI copy: ${missingCopy.join(", ")}`);
}

if (!html.includes("openstreetmap.org/export/embed") || !js.includes("navigator.geolocation") || !js.includes("google.com/maps/dir")) {
  throw new Error("Expected real map, geolocation, and directions integration.");
}

if (!html.includes("close-details") || !js.includes("closeDetailsButton")) {
  throw new Error("Expected closable toilet details panel.");
}

if (!css.includes("@media") || !js.includes("setTab")) {
  throw new Error("Expected responsive CSS and tab interaction code.");
}

if (!css.includes(".map-frame") || !css.includes(".map-marker")) {
  throw new Error("Expected stable map frame and marker overlay CSS.");
}

console.log("Static app checks passed.");
