import { access, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const requiredFiles = [
  "index.html",
  "app.webmanifest",
  "offline.html",
  "service-worker.js",
  "android/settings.gradle",
  "android/build.gradle",
  "android/gradle.properties",
  "android/gradlew",
  "android/gradle/wrapper/gradle-wrapper.jar",
  "android/gradle/wrapper/gradle-wrapper.properties",
  "android/app/build.gradle",
  "android/app/src/main/AndroidManifest.xml",
  "android/app/src/main/java/com/wheretoi/app/MainActivity.java",
  "android/app/src/main/res/drawable-nodpi/app_icon.png",
  "android/app/src/main/res/values/strings.xml",
  "android/app/src/main/res/values/styles.xml",
  "scripts/build-android-apk.mjs",
  "src/assets/icons/apple-touch-icon.png",
  "src/assets/icons/icon-192.png",
  "src/assets/icons/icon-512.png",
  "src/assets/icons/icon-maskable-512.png",
  "src/main.js",
  "src/app/app.js",
  "src/app/html-includes.js",
  "src/app/controllers/map-controller.js",
  "src/app/controllers/feedback-thread-controller.js",
  "src/app/controllers/account-controller.js",
  "src/app/controllers/tab-controller.js",
  "src/app/services/http-client.js",
  "src/app/services/toilets-service.js",
  "src/app/services/account-service.js",
  "src/app/views/account-view.js",
  "src/app/config/app-config.js",
  "src/app/config/dom-refs.js",
  "src/app/toilets/toilet-record-mapper.js",
  "src/app/utils/csv.js",
  "src/app/utils/geo.js",
  "src/app/utils/cleanliness.js",
  "src/app/utils/comments.js",
  "src/app/utils/text.js",
  "src/app/utils/account-formatters.js",
  "src/styles.css",
  "scripts/build.mjs",
  "scripts/e2e-smoke.mjs",
  "scripts/paddle_ocr_runner.py",
  "server/app-server.mjs",
  "server/database.mjs",
  "server/ocr/ocr-analysis.mjs",
  "server/ocr/paddle-ocr-service.mjs",
  "requirements-ocr.txt",
  "render.yaml"
];

const optimizedToiletLevelImages = [
  "toilet_levels/level_05_small.jpg",
  "toilet_levels/level_1_small.jpg",
  "toilet_levels/level_15_small.jpg",
  "toilet_levels/level_2_small.jpg",
  "toilet_levels/level_25_small.jpg",
  "toilet_levels/level_3_small.jpg",
  "toilet_levels/level_35_small.jpg",
  "toilet_levels/level_4_small.jpg",
  "toilet_levels/level_45_small.jpg",
  "toilet_levels/level_5_small.jpg"
];

async function readCssWithImports(filePath, seen = new Set()) {
  const fullPath = resolve(filePath);
  if (seen.has(fullPath)) return "";
  seen.add(fullPath);

  const content = await readFile(fullPath, "utf8");
  const importPattern = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?[^;]*;/g;
  let output = "";
  let lastIndex = 0;

  for (const match of content.matchAll(importPattern)) {
    output += content.slice(lastIndex, match.index);
    const specifier = match[1].split("?")[0];
    if (!/^(?:https?:)?\/\//.test(specifier)) {
      output += await readCssWithImports(resolve(dirname(fullPath), specifier), seen);
    }
    lastIndex = match.index + match[0].length;
  }

  return output + content.slice(lastIndex);
}

async function readHtmlWithIncludes(filePath, seen = new Set()) {
  const fullPath = resolve(filePath);
  if (seen.has(fullPath)) return "";
  seen.add(fullPath);

  const content = await readFile(fullPath, "utf8");
  const includePattern = /<template\b[^>]*\bdata-html-include=["']([^"']+)["'][^>]*>\s*<\/template>/g;
  let output = "";
  let lastIndex = 0;

  for (const match of content.matchAll(includePattern)) {
    output += content.slice(lastIndex, match.index);
    const specifier = match[1].split("?")[0];
    output += await readHtmlWithIncludes(resolve(dirname(fullPath), specifier), seen);
    lastIndex = match.index + match[0].length;
  }

  return output + content.slice(lastIndex);
}

await Promise.all(requiredFiles.map((file) => access(resolve(file))));
await Promise.all(optimizedToiletLevelImages.map((file) => access(resolve(file))));

const html = await readHtmlWithIncludes("index.html");
const css = await readCssWithImports("src/styles.css");
const server = await readFile("server/app-server.mjs", "utf8");
const postgresRepository = await readFile("server/database/repository/postgres-repository.mjs", "utf8");
const app = await readFile("src/app/app.js", "utf8");
const toiletsService = await readFile("src/app/services/toilets-service.js", "utf8");
const buildScript = await readFile("scripts/build.mjs", "utf8");
const renderConfig = await readFile("render.yaml", "utf8");
const ocrRequirements = await readFile("requirements-ocr.txt", "utf8");
const paddleOcrRunner = await readFile("scripts/paddle_ocr_runner.py", "utf8");
const manifest = JSON.parse(await readFile("app.webmanifest", "utf8"));
const serviceWorker = await readFile("service-worker.js", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const androidManifest = await readFile("android/app/src/main/AndroidManifest.xml", "utf8");
const androidActivity = await readFile("android/app/src/main/java/com/wheretoi/app/MainActivity.java", "utf8");
const jsFiles = requiredFiles.filter((file) => file.startsWith("src/") && file.endsWith(".js"));
const js = (await Promise.all(jsFiles.map((file) => readFile(file, "utf8")))).join("\n");

if (
  manifest.display !== "standalone" ||
  manifest.start_url !== "/?source=pwa" ||
  !Array.isArray(manifest.icons) ||
  !manifest.icons.some((icon) => icon.sizes === "192x192") ||
  !manifest.icons.some((icon) => icon.sizes === "512x512") ||
  !manifest.icons.some((icon) => String(icon.purpose).includes("maskable"))
) {
  throw new Error("Expected an Android-installable web app manifest with standard and maskable icons.");
}

if (
  !html.includes('rel="manifest"') ||
  !html.includes('name="theme-color"') ||
  !js.includes('navigator.serviceWorker.register("/service-worker.js")') ||
  !serviceWorker.includes('url.pathname.startsWith("/api/")') ||
  !serviceWorker.includes('caches.match("/offline.html")')
) {
  throw new Error("Expected PWA metadata, service worker registration, private API exclusion, and offline fallback.");
}

if (
  packageJson.scripts?.["android:apk"] !== "node scripts/build-android-apk.mjs" ||
  !androidManifest.includes("android.permission.INTERNET") ||
  !androidManifest.includes("android.permission.ACCESS_FINE_LOCATION") ||
  !androidManifest.includes('android:usesCleartextTraffic="false"') ||
  !androidActivity.includes('APP_ORIGIN = "https://wheretoi-webapp.onrender.com"') ||
  !androidActivity.includes("setAcceptThirdPartyCookies(webView, false)") ||
  !androidActivity.includes("onGeolocationPermissionsShowPrompt") ||
  !androidActivity.includes("Intent.ACTION_VIEW")
) {
  throw new Error("Expected a secure Android WebView shell with network, location, cookies, and external navigation support.");
}

const requiredCopy = [
  "Map",
  "Account",
  "Directions",
  "Parent &amp; Baby",
  "Bidet / Washing",
  "Needs",
  "Nearest",
  "Cleanest",
  "Most facilities",
  "Most liked",
  "Cleanliness picture",
  "Match the picture to what you saw.",
  "Confirm password",
  "Create an account to unlock more features"
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

if (
  html.includes(">LOC<") ||
  !html.includes("class=\"locate-button\"") ||
  !html.includes("class=\"locate-icon\"") ||
  !css.includes(".locate-button.is-located") ||
  !js.includes("setLocateButtonState") ||
  !js.includes("updateLocateButtonStateFromMap") ||
  !js.includes("locateActiveCenterToleranceMetres") ||
  !js.includes("headerLocateButton.hidden = nextTab !== \"map\"")
) {
  throw new Error("Expected the top location control to use an icon, hide outside Map, and turn blue only while the map is centered on the user's location.");
}

if (!html.includes("close-details") || !js.includes("closeDetailsButton")) {
  throw new Error("Expected closable toilet details panel.");
}

const filterHeaderStart = html.indexOf("<div class=\"filter-header\">");
const filterHeaderEnd = html.indexOf("<div class=\"filter-options\"", filterHeaderStart);
const filterHeaderHtml =
  filterHeaderStart >= 0 && filterHeaderEnd > filterHeaderStart
    ? html.slice(filterHeaderStart, filterHeaderEnd)
    : "";
const cleanlinessSectionStart = html.indexOf("<div class=\"cleanliness-section\"");
const cleanlinessSectionEnd = html.indexOf("<p id=\"toilet-area\"", cleanlinessSectionStart);
const cleanlinessSectionHtml =
  cleanlinessSectionStart >= 0 && cleanlinessSectionEnd > cleanlinessSectionStart
    ? html.slice(cleanlinessSectionStart, cleanlinessSectionEnd)
    : "";

if (
  filterHeaderHtml.includes("cleanliness-range") ||
  !cleanlinessSectionHtml.includes("rating-period-control") ||
  !cleanlinessSectionHtml.includes("id=\"cleanliness-range\"")
) {
  throw new Error("Expected rating period control beside the toilet detail cleanliness rating, not in the filter header.");
}

if (!html.includes("feature-baby-changing") || !html.includes("feature-bidet") || !js.includes("babyChanging")) {
  throw new Error("Expected expanded toilet feature details.");
}

if (
  html.includes("0 clean (0%) | 0 not clean (0%)") ||
  html.includes("cleanliness-clean-bar") ||
  html.includes("cleanliness-not-clean-bar") ||
  js.includes("formatCleanlinessVotes") ||
  html.includes("visual-star-hit-left") ||
  html.includes("visual-star-hit-right") ||
  !html.includes("data-visual-rating-choice=\"half\"") ||
  !html.includes("data-visual-rating-choice=\"full\"") ||
  !html.includes("cleanliness-star-icons") ||
  !html.includes("cleanliness-rating-count") ||
  !css.includes(".visual-star-rating") ||
  !css.includes(".visual-rating-choice-popover") ||
  !js.includes("openCleanlinessRatingChoices") ||
  !js.includes("formatCleanlinessRating") ||
  !js.includes("formatCleanlinessRatingCount")
) {
  throw new Error("Expected cleanliness to use explicit half-star/full-star choices across the 0.5-5 range.");
}

if (!html.includes("feature-filters") || !html.includes("toilet-results") || !js.includes("setFeatureFilter")) {
  throw new Error("Expected multi-select toilet filtering and result list interaction.");
}

if (
  !html.includes("data-detail-section=\"overview\"") ||
  !html.includes("data-detail-panel=\"overview\"") ||
  !html.includes("overview-features-disclosure") ||
  !js.includes("setDetailSection") ||
  !css.includes(".details-section-link")
) {
  throw new Error("Expected toilet details to switch between linked detail sections.");
}

if (
  html.includes("id=\"comment-media\"") ||
  html.includes("id=\"comment-photo\"") ||
  html.includes("comment-media-status") ||
  js.includes("readCommentMediaAttachments") ||
  js.includes("createCommentMediaElement") ||
  js.includes("commentMediaMaxAttachments") ||
  js.includes("commentMediaMaxVideos") ||
  js.includes("removeCommentMediaSelection") ||
  css.includes(".comment-media") ||
  !js.includes("isPlaceholderToiletComment")
) {
  throw new Error("Expected comment photo attachments to be removed from the UI and client submission flow.");
}

const feedbackDetailPanelIndex = html.indexOf("id=\"details-comment-panel\"");
const commentComposerIndex = html.indexOf("id=\"comment-composer\"");
const visualCleanlinessStarsIndex = html.indexOf("id=\"visual-cleanliness-stars\"");

if (
  !html.includes("id=\"feedback-action-bar\"") ||
  html.includes("id=\"visual-feedback-toggle\"") ||
  html.includes("id=\"visual-feedback-panel\"") ||
  html.includes("data-detail-section=\"visual\"") ||
  html.includes("id=\"details-visual-panel\"") ||
  html.includes("data-detail-panel=\"survey\"") ||
  html.includes("data-survey-rating=") ||
  html.includes("data-open-visual-feedback") ||
  html.includes("Rate visually") ||
  !html.includes("id=\"visual-cleanliness-stars\"") ||
  !html.includes("data-visual-star=\"5\"") ||
  !html.includes("data-visual-rating-choice=\"half\"") ||
  !html.includes("data-visual-rating-choice=\"full\"") ||
  html.includes("id=\"visual-feedback-comment\"") ||
  html.includes("Rate urinal visually") ||
  html.includes("id=\"overview-urinal-panel\"") ||
  visualCleanlinessStarsIndex <= commentComposerIndex ||
  !js.includes("setVisualCleanlinessLevel") ||
  !js.includes("visualCleanlinessStars?.addEventListener(\"click\"") ||
  !js.includes("target?.closest?.(\"[data-visual-star]\")") ||
  !js.includes("openCleanlinessRatingChoices(starButton.dataset.visualStar") ||
  !js.includes("selectCleanlinessRating(button.dataset.visualRating)") ||
  !js.includes("image: definition.image") ||
  js.includes("level_3_urinal") ||
  !css.includes(".feedback-action-bar") ||
  !css.includes(".feedback-visual-rating") ||
  !css.includes(".visual-preview-card") ||
  !css.includes(".visual-star-button")
) {
  throw new Error("Expected Write feedback cleanliness rating to use the half-star visual toilet image rating, without a separate Visual check panel.");
}

if (
  !html.includes("id=\"comment-anonymous\"") ||
  !html.includes("Anonymous") ||
  html.includes("id=\"comment-anonymous\" type=\"checkbox\" checked") ||
  !js.includes("getCommentVisibility") ||
  !js.includes("author_name") ||
  !css.includes(".comment-author") ||
  !css.includes(".comment-anonymous-option")
) {
  throw new Error("Expected comments to support a non-default Anonymous checkbox and public author display.");
}

if (
  !server.includes("\"DELETE /api/comments\"") ||
  !server.includes("deleteComment") ||
  !js.includes("createCommentActions") ||
  !js.includes("comment.can_delete") ||
  !js.includes("deleteOwnComment") ||
  !css.includes(".comment-menu-button") ||
  !css.includes(".comment-delete-button")
) {
  throw new Error("Expected users to delete their own comments through a three-dot comment menu.");
}

if (
  !server.includes("\"POST /api/comment-likes\"") ||
  !server.includes("\"POST /api/comment-dislikes\"") ||
  !server.includes("toggleCommentLike") ||
  !server.includes("toggleCommentDislike") ||
  !js.includes("toggleCommentLikeRequest") ||
  !js.includes("toggleCommentDislikeRequest") ||
  !js.includes("comment.viewer_has_liked") ||
  !js.includes("comment.like_count") ||
  !js.includes("comment.viewer_has_disliked") ||
  !js.includes("comment.dislike_count") ||
  !css.includes(".comment-like-button") ||
  !css.includes(".comment-like-icon") ||
  !css.includes(".comment-like-button.is-liked") ||
  !css.includes(".comment-dislike-button") ||
  !css.includes(".comment-dislike-icon") ||
  !css.includes(".comment-dislike-button.is-disliked")
) {
  throw new Error("Expected logged-in users to toggle mutually exclusive likes and dislikes on comments.");
}

if (
  !html.includes("id=\"comment-sort\"") ||
  !html.includes("value=\"newest\"") ||
  !html.includes("value=\"liked\"") ||
  !html.includes("id=\"comment-filters\"") ||
  !html.includes("value=\"long\"") ||
  !js.includes("filterAndSortComments") ||
  !js.includes("setCommentSortMode") ||
  !js.includes("setCommentFilter") ||
  !css.includes(".comment-sort-control") ||
  !css.includes(".comment-filter-tag")
) {
  throw new Error("Expected comments to support newest/default sorting, most-liked sorting, and long-comment tag filtering.");
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

const settingsPanelStart = html.indexOf("id=\"account-settings-panel\"");
const profileCardStart = html.indexOf("id=\"profile-card\"", settingsPanelStart);
const settingsPanelHtml =
  settingsPanelStart >= 0 && profileCardStart > settingsPanelStart
    ? html.slice(settingsPanelStart, profileCardStart)
    : "";

if (
  !html.includes("id=\"account-settings-button\"") ||
  !html.includes("aria-label=\"Open account settings\"") ||
  !settingsPanelHtml.includes("Privacy note") ||
  !settingsPanelHtml.includes("credits-button") ||
  !settingsPanelHtml.includes("logout-button") ||
  !js.includes("toggleSettingsPanel") ||
  !js.includes("hideSettingsPanel") ||
  !css.includes(".settings-button") ||
  !css.includes(".account-settings-panel")
) {
  throw new Error("Expected Account privacy note, data credits, and logout controls to live inside the top-right settings menu.");
}

const feedbackTabIndex = html.indexOf("data-account-activity-tab=\"feedback\"");
const historyTabIndex = html.indexOf("data-account-activity-tab=\"history\"");

if (
  !html.includes("class=\"account-card account-activity-card\"") ||
  !html.includes("role=\"tablist\" aria-label=\"Account activity\"") ||
  feedbackTabIndex < 0 ||
  historyTabIndex < 0 ||
  feedbackTabIndex > historyTabIndex ||
  !html.includes("data-account-activity-panel=\"feedback\"") ||
  !html.includes("data-account-activity-panel=\"history\"") ||
  html.includes("my-comments-card") ||
  html.includes("history-card") ||
  !js.includes("setAccountActivityTab") ||
  !js.includes("handleAccountActivityTabClick") ||
  !css.includes(".account-activity-tabs") ||
  !css.includes(".account-activity-tab.is-active") ||
  !css.includes(".history-list")
) {
  throw new Error("Expected Account feedback and visit history to use a compact tabbed activity layout, with feedback shown first.");
}

if (!css.includes("@media") || !js.includes("setTab")) {
  throw new Error("Expected responsive CSS and tab interaction code.");
}

if (
  app.includes("loadToiletsFromCsv") ||
  toiletsService.includes("loadToiletsFromCsv") ||
  toiletsService.includes("csvDataPath") ||
  !buildScript.includes("\"toilets.csv\"")
) {
  throw new Error("Expected startup and published static assets to avoid the large CSV fallback.");
}

if (
  !postgresRepository.includes("async getToiletById") ||
  !postgresRepository.includes("mapRowToToilet(result.rows[0])")
) {
  throw new Error("Expected Postgres repository to support /api/toilets/detail with getToiletById.");
}

if (
  !postgresRepository.includes("jsonb_array_elements(toilet_comments.media_attachments)") ||
  !postgresRepository.includes("NULL::text AS media_url")
) {
  throw new Error("Expected Postgres comment queries to return media metadata without base64 data URLs.");
}

const renderBuildCommand = renderConfig.match(/^\s*buildCommand:\s*(.+)$/m)?.[1] ?? "";
if (
  !/\bnpm ci\b/.test(renderBuildCommand) ||
  !/\bnpm run build\b/.test(renderBuildCommand) ||
  !server.includes("const BODY_SIZE_LIMIT_BYTES = 8 * 1024 * 1024")
) {
  throw new Error("Expected Render to build dist and comment uploads to stay under the emergency body-size guardrail.");
}

if (
  !ocrRequirements.includes("paddlepaddle==2.6.2") ||
  !ocrRequirements.includes("paddleocr==2.7.3") ||
  !renderConfig.includes("PYTHON_VERSION") ||
  !renderConfig.includes("3.12.8") ||
  !renderConfig.includes("WHERETOI_PADDLEOCR_TIMEOUT_MS") ||
  !renderConfig.includes("180000") ||
  !paddleOcrRunner.includes('os.environ.setdefault("FLAGS_use_mkldnn", "0")') ||
  !paddleOcrRunner.includes("enable_mkldnn=False")
) {
  throw new Error("Expected PaddleOCR deployment to use pinned 2.x dependencies, Python 3.12, a longer timeout, and oneDNN-disabled CPU execution.");
}

if (
  !optimizedToiletLevelImages.every((file) => js.includes(file)) ||
  /toilet_levels\/level_(?:05|1|15|2|25|3|35|4|45|5)\.(?:png|jpe?g)/.test(js) ||
  !buildScript.includes("_small.jpg") ||
  !buildScript.includes("toilet_levels")
) {
  throw new Error("Expected visual cleanliness feedback to use optimized toilet-level images.");
}

const oversizedToiletLevelImages = (
  await Promise.all(
    optimizedToiletLevelImages.map(async (file) => ({
      file,
      size: (await stat(resolve(file))).size
    }))
  )
).filter((image) => image.size > 50 * 1024);

if (oversizedToiletLevelImages.length > 0) {
  throw new Error(
    `Expected optimized toilet-level images under 50KB: ${oversizedToiletLevelImages
      .map((image) => `${image.file} (${image.size} bytes)`)
      .join(", ")}`
  );
}

const logoSize = (await stat(resolve("src/logo.png"))).size;
if (logoSize > 50 * 1024) {
  throw new Error(`Expected src/logo.png under 50KB (${logoSize} bytes).`);
}

if (!css.includes(".map-canvas") || !css.includes(".map-marker") || !css.includes(".map-marker-icon")) {
  throw new Error("Expected interactive map canvas and marker styling.");
}

console.log("Static app checks passed.");
