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
  "src/app/utils/cleanliness.js",
  "src/app/utils/text.js",
  "src/app/utils/account-formatters.js",
  "src/styles.css",
  "scripts/build.mjs",
  "scripts/e2e-smoke.mjs",
  "server/app-server.mjs",
  "server/database.mjs",
  "render.yaml"
];

await Promise.all(requiredFiles.map((file) => access(resolve(file))));

const html = await readFile("index.html", "utf8");
const css = await readFile("src/styles.css", "utf8");
const jsFiles = requiredFiles.filter((file) => file.startsWith("src/") && file.endsWith(".js"));
const js = (await Promise.all(jsFiles.map((file) => readFile(file, "utf8")))).join("\n");

const requiredCopy = [
  "Map",
  "Account",
  "Wallet balance",
  "Directions",
  "Parent &amp; Baby",
  "Bidet / Washing",
  "Needs",
  "Nearest",
  "Cleanest",
  "Most facilities",
  "Confirm password",
  "Create an account to unlock more features",
  "Attach image or video"
];
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

if (!js.includes("zoomControl: false") || js.includes("L.control.zoom") || css.includes("leaflet-control-zoom")) {
  throw new Error("Expected map zoom to use native map gestures without visible +/- controls.");
}

if (!html.includes("close-details") || !js.includes("closeDetailsButton")) {
  throw new Error("Expected closable toilet details panel.");
}

if (!html.includes("feature-baby-changing") || !html.includes("feature-bidet") || !js.includes("babyChanging")) {
  throw new Error("Expected expanded toilet feature details.");
}

if (
  html.includes("0 clean (0%) | 0 not clean (0%)") ||
  html.includes("cleanliness-clean-bar") ||
  html.includes("cleanliness-not-clean-bar") ||
  js.includes("formatCleanlinessVotes") ||
  !html.includes("data-survey-rating=\"5\"") ||
  !html.includes("cleanliness-star-icons") ||
  !css.includes(".star-survey-actions") ||
  !js.includes("formatCleanlinessRating")
) {
  throw new Error("Expected cleanliness to display and submit 1-5 star ratings.");
}

if (!html.includes("feature-filters") || !html.includes("toilet-results") || !js.includes("setFeatureFilter")) {
  throw new Error("Expected multi-select toilet filtering and result list interaction.");
}

if (
  !html.includes("data-detail-section=\"features\"") ||
  !html.includes("data-detail-panel=\"survey\"") ||
  !js.includes("setDetailSection") ||
  !css.includes(".details-section-link")
) {
  throw new Error("Expected toilet details to switch between linked detail sections.");
}

if (
  !html.includes("accept=\"image/*,video/*\"") ||
  !js.includes("readCommentMediaAttachment") ||
  !js.includes("createCommentMediaElement") ||
  !js.includes("isPlaceholderToiletComment") ||
  !css.includes(".comment-media") ||
  !css.includes("object-fit: contain")
) {
  throw new Error("Expected comments to support image or video attachments without cropped media or placeholder notes.");
}

if (html.includes("qr-panel") || html.includes("Access QR") || html.includes("activate-pass") || js.includes("activatePass")) {
  throw new Error("QR access UI and activation flow should not be present.");
}

if (!html.includes("auth-confirm-password") || !js.includes("Passwords do not match")) {
  throw new Error("Expected sign-up flow to confirm matching passwords before registration.");
}

if (!html.includes("account-unlock-card") || !js.includes("renderGuestAccount") || js.includes("showAuthModal();")) {
  throw new Error("Expected unauthenticated users to keep map access and see an account unlock prompt.");
}

if (!css.includes("@media") || !js.includes("setTab")) {
  throw new Error("Expected responsive CSS and tab interaction code.");
}

if (!css.includes(".map-canvas") || !css.includes(".map-marker") || !css.includes(".map-marker-icon")) {
  throw new Error("Expected interactive map canvas and marker styling.");
}

console.log("Static app checks passed.");
