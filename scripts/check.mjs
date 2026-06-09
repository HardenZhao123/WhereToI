import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const requiredFiles = [
  "index.html",
  "src/main.js",
  "src/app/app.js",
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
  "src/app/config/fallback-toilets.js",
  "src/app/toilets/toilet-record-mapper.js",
  "src/app/utils/csv.js",
  "src/app/utils/geo.js",
  "src/app/utils/cleanliness.js",
  "src/app/utils/comment-media.js",
  "src/app/utils/comments.js",
  "src/app/utils/text.js",
  "src/app/utils/account-formatters.js",
  "src/shared/comment-media-policy.js",
  "src/styles.css",
  "scripts/build.mjs",
  "scripts/e2e-smoke.mjs",
  "server/app-server.mjs",
  "server/database.mjs",
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

await Promise.all(requiredFiles.map((file) => access(resolve(file))));
await Promise.all(optimizedToiletLevelImages.map((file) => access(resolve(file))));

const html = await readFile("index.html", "utf8");
const css = await readFile("src/styles.css", "utf8");
const server = await readFile("server/app-server.mjs", "utf8");
const app = await readFile("src/app/app.js", "utf8");
const toiletsService = await readFile("src/app/services/toilets-service.js", "utf8");
const buildScript = await readFile("scripts/build.mjs", "utf8");
const jsFiles = requiredFiles.filter((file) => file.startsWith("src/") && file.endsWith(".js"));
const js = (await Promise.all(jsFiles.map((file) => readFile(file, "utf8")))).join("\n");

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
  "Photo/video",
  "Visual check",
  "Visual cleanliness check",
  "Visual checks",
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
  !html.includes("data-survey-rating=\"5\"") ||
  !html.includes("cleanliness-star-icons") ||
  !html.includes("cleanliness-rating-count") ||
  !css.includes(".star-survey-actions") ||
  !js.includes("formatCleanlinessRating") ||
  !js.includes("formatCleanlinessRatingCount")
) {
  throw new Error("Expected cleanliness to display and submit 1-5 star ratings.");
}

if (!html.includes("feature-filters") || !html.includes("toilet-results") || !js.includes("setFeatureFilter")) {
  throw new Error("Expected multi-select toilet filtering and result list interaction.");
}

if (
  !html.includes("data-detail-section=\"overview\"") ||
  !html.includes("data-detail-panel=\"overview\"") ||
  !html.includes("overview-features-disclosure") ||
  !html.includes("data-detail-panel=\"survey\"") ||
  !js.includes("setDetailSection") ||
  !css.includes(".details-section-link")
) {
  throw new Error("Expected toilet details to switch between linked detail sections.");
}

if (
  !html.includes("accept=\"image/*,video/*\"") ||
  !html.includes("multiple") ||
  !html.includes("comment-media-status") ||
  !js.includes("readCommentMediaAttachments") ||
  !js.includes("createCommentMediaElement") ||
  !js.includes("commentMediaMaxAttachments") ||
  !js.includes("commentMediaMaxVideos") ||
  !js.includes("removeCommentMediaSelection") ||
  !js.includes("isPlaceholderToiletComment") ||
  !css.includes(".comment-media") ||
  !css.includes(".comment-media-item") ||
  !css.includes(".comment-media-preview-item") ||
  !css.includes(".comment-media-remove") ||
  !css.includes("object-fit: contain")
) {
  throw new Error("Expected comments to support up to 9 image/video attachments with thumbnail removal and uncropped media.");
}

const feedbackDetailPanelIndex = html.indexOf("id=\"details-comment-panel\"");
const visualDetailTabIndex = html.indexOf("data-detail-section=\"visual\"");
const visualDetailPanelIndex = html.indexOf("id=\"details-visual-panel\"");
const visualFeedbackListIndex = html.indexOf("id=\"visual-feedback-list\"");
const visualComposerPanelIndex = html.indexOf("id=\"visual-feedback-panel\"");

if (
  !html.includes("id=\"feedback-action-bar\"") ||
  !html.includes("id=\"visual-feedback-toggle\"") ||
  !html.includes("id=\"visual-feedback-panel\"") ||
  !html.includes("id=\"visual-cleanliness-slider\"") ||
  visualDetailTabIndex < 0 ||
  visualDetailPanelIndex < 0 ||
  !html.includes("id=\"visual-feedback-list\"") ||
  visualDetailPanelIndex <= feedbackDetailPanelIndex ||
  visualFeedbackListIndex <= visualDetailPanelIndex ||
  visualFeedbackListIndex >= visualComposerPanelIndex ||
  !js.includes("visualFeedbackStorageKey") ||
  !js.includes("setVisualCleanlinessLevel") ||
  !js.includes("submitVisualFeedback") ||
  !js.includes("setDetailSection(\"visual\")") ||
  !js.includes("renderVisualFeedbackDiscussion") ||
  !js.includes("createVisualFeedbackImage") ||
  !js.includes("image: level.image") ||
  !css.includes(".feedback-action-bar") ||
  !css.includes(".visual-feedback-panel") ||
  !css.includes(".visual-preview-card") ||
  !css.includes(".visual-feedback-item") ||
  !css.includes(".visual-feedback-image")
) {
  throw new Error("Expected visual cleanliness feedback to use an adjustable toilet image and a separate Visual check detail tab with real image thumbnails.");
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
  !server.includes("toggleCommentLike") ||
  !js.includes("toggleCommentLikeRequest") ||
  !js.includes("comment.viewer_has_liked") ||
  !js.includes("comment.like_count") ||
  !css.includes(".comment-like-button") ||
  !css.includes(".comment-like-icon") ||
  !css.includes(".comment-like-button.is-liked")
) {
  throw new Error("Expected logged-in users to toggle one like per comment with a right-side thumbs-up button.");
}

if (
  !html.includes("id=\"comment-sort\"") ||
  !html.includes("value=\"newest\"") ||
  !html.includes("value=\"liked\"") ||
  !html.includes("id=\"comment-filters\"") ||
  !html.includes("value=\"media\"") ||
  !html.includes("value=\"long\"") ||
  !js.includes("filterAndSortComments") ||
  !js.includes("setCommentSortMode") ||
  !js.includes("setCommentFilter") ||
  !css.includes(".comment-sort-control") ||
  !css.includes(".comment-filter-tag")
) {
  throw new Error("Expected comments to support newest/default sorting, most-liked sorting, and tag filters for media or long comments.");
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

if (!css.includes(".map-canvas") || !css.includes(".map-marker") || !css.includes(".map-marker-icon")) {
  throw new Error("Expected interactive map canvas and marker styling.");
}

console.log("Static app checks passed.");
