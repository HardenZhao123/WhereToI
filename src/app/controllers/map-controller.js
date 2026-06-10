import { appConfig } from "../config/app-config.js";
import {
  fetchAiSummary,
  fetchToiletDetail,
  submitCleanlinessSurvey,
  submitComment
} from "../services/toilets-service.js";
import { createFeedbackThreadController } from "./feedback-thread-controller.js";
import {
  formatCleanlinessRating,
  formatCleanlinessRatingCount,
  getCleanlinessVisualLevel,
  getCleanlinessScore,
  getCleanlinessStars
} from "../utils/cleanliness.js";
import {
  addCommentMediaFiles,
  clearCommentMediaSelections,
  formatCommentMediaSize,
  getCommentMediaStatus,
  readCommentMediaAttachments,
  removeCommentMediaSelectionById
} from "../utils/comment-media.js";
import { distanceInMetres, formatDistance } from "../utils/geo.js";

const featureFilterOptions = [
  { key: "women", label: "Women" },
  { key: "men", label: "Men" },
  { key: "accessible", label: "Accessible" },
  { key: "neutral", label: "Gender Neutral" },
  { key: "children", label: "Children" },
  { key: "babyChanging", label: "Parent & Baby" },
  { key: "bidet", label: "Bidet / Washing" },
  { key: "automatic", label: "Automatic" },
  { key: "urinalOnly", label: "Urinal Only" },
  { key: "radarKey", label: "RADAR Key" },
  { key: "free", label: "Free" }
];

const sortModes = new Set(["distance", "cleanliness", "free", "facilities"]);
const resultRenderLimit = 8;
const locateActiveCenterToleranceMetres = 20;
const defaultCleanlinessRange = "3days";

export function createMapController(elements, onToiletSelected = () => {}, auth = {}) {
  const {
    statusText,
    searchInput,
    searchCard,
    toggleSearchButton,
    directionsButton,
    detailsCard,
    mapPanel,
    mapElement,
    mapSurveyStatus,
    detailSectionLinks = [],
    detailPanels = [],
    commentsList,
    commentsSummary,
    commentSortSelect,
    commentFilterInputs = [],
    feedbackActionBar,
    commentComposer,
    commentComposerToggle,
    commentForm,
    commentInput,
    commentAnonymousInput,
    commentMediaInput,
    commentMediaPreview,
    commentMediaStatus,
    overviewVisualPreview,
    overviewVisualImage,
    overviewVisualState,
    visualCleanlinessPreview,
    visualCleanlinessImage,
    visualCleanlinessStars,
    visualCleanlinessRatingButtons = [],
    visualCleanlinessState,
    summarizeCommentsButton,
    aiSummaryContainer,
    aiSummaryText,
    featureFilterInputs = [],
    sortSelect,
    cleanlinessRangeSelect,
    resultsSummary,
    resultsList,
    locateButtons = []
  } = elements;
  const {
    isAuthenticated = () => true,
    showLoginPrompt = () => {},
    recordAccessHistory = async () => {},
    onPublicProfileSelected = () => {},
    onCleanlinessSaved = async () => {},
    onBoundsChanged = () => {}
  } = auth;

  const surveyStorageKey = "wheretoi-map-cleanliness-survey";
  const visualCleanlinessLevels = new Map([
    [0.5, { label: "Extremely dirty", tone: "Avoid at all costs", image: "toilet_levels/level_05_small.jpg" }],
    [1, { label: "Very dirty", tone: "Needs a serious clean", image: "toilet_levels/level_1_small.jpg" }],
    [1.5, { label: "Dirty & Messy", tone: "Quite unpleasant", image: "toilet_levels/level_15_small.jpg" }],
    [2, { label: "Dirty", tone: "Use only if needed", image: "toilet_levels/level_2_small.jpg" }],
    [2.5, { label: "Below average", tone: "Could be better", image: "toilet_levels/level_25_small.jpg" }],
    [3, { label: "OK", tone: "Usable but not spotless", image: "toilet_levels/level_3_small.jpg" }],
    [3.5, { label: "Above average", tone: "Decent condition", image: "toilet_levels/level_35_small.jpg" }],
    [4, { label: "Clean", tone: "Comfortable to use", image: "toilet_levels/level_4_small.jpg" }],
    [4.5, { label: "Very clean", tone: "Almost spotless", image: "toilet_levels/level_45_small.jpg" }],
    [5, { label: "Excellent", tone: "Fresh and well kept", image: "toilet_levels/level_5_small.jpg" }]
  ]);

  let allToilets = [];
  let filteredToilets = [];
  let visibleToilets = [];
  let selectedToilet = null;
  let selectedCleanlinessDisplayToilet = null;
  let userLocation = null;
  let queryText = "";
  let selectedFeatureFilters = new Set();
  let sortMode = "distance";
  let map = null;
  let markersLayer = null;
  let userLocationMarker = null;
  let markerById = new Map();
  let hiddenByMarkerLimit = 0;
  let cleanlinessSurveyAnswers = loadSurveyAnswers();
  let cleanlinessUpdateById = new Map();
  let cleanlinessDisplayCache = new Map();
  let cleanlinessDisplayRequestId = 0;
  let cleanlinessRangeByToiletId = new Map();
  let currentCleanlinessRange = defaultCleanlinessRange;
  let selectedRating = null;
  let selectedCommentMedia = [];
  let visualCleanlinessLevel = 3;
  let currentDetailSection = "overview";

  const feedbackThreadController = createFeedbackThreadController(
    {
      commentsList,
      commentsSummary,
      commentSortSelect,
      commentFilterInputs
    },
    {
      getSelectedToilet: () => selectedToilet,
      isAuthenticated,
      showLoginPrompt,
      onPublicProfileSelected
    }
  );

  document.addEventListener("click", feedbackThreadController.closeOpenCommentMenus);

  function hasEnabledFeature(value) {
    if (value === true || value === 1) return true;

    const normalised = String(value ?? "").trim().toUpperCase();
    return normalised === "Y" || normalised === "TRUE" || normalised === "1";
  }

  function loadSurveyAnswers() {
    try {
      const storedAnswers = window.localStorage?.getItem(surveyStorageKey);
      if (!storedAnswers) return {};

      const parsedAnswers = JSON.parse(storedAnswers);
      return parsedAnswers && typeof parsedAnswers === "object" ? parsedAnswers : {};
    } catch {
      return {};
    }
  }

  function saveSurveyAnswers() {
    try {
      window.localStorage?.setItem(surveyStorageKey, JSON.stringify(cleanlinessSurveyAnswers));
    } catch {
      // Keep the survey usable for the current session when storage is blocked.
    }
  }

  function normaliseVisualCleanlinessLevel(level) {
    const value = Math.round(Number(level) * 2) / 2;
    return visualCleanlinessLevels.has(value) ? value : 3;
  }

  function getVisualCleanlinessLevel(level = visualCleanlinessLevel) {
    const value = normaliseVisualCleanlinessLevel(level);
    const definition = visualCleanlinessLevels.get(value);
    return {
      value,
      label: definition.label,
      tone: definition.tone,
      image: definition.image || "",
      fixtureType: "toilet"
    };
  }

  function renderCleanlinessRating(toilet) {
    const cleanlinessStars = document.querySelector("#cleanliness-stars");
    const starIcons = document.querySelector("#cleanliness-star-icons");
    const cleanlinessLabel = document.querySelector("#cleanliness-score");
    const cleanlinessRatingCount = document.querySelector("#cleanliness-rating-count");
    const rating = getCleanlinessStars(toilet);
    const ratingCountText = formatCleanlinessRatingCount(toilet);

    if (cleanlinessStars) {
      cleanlinessStars.setAttribute(
        "aria-label",
        `Cleanliness rating ${rating.displayRating} out of ${rating.maxRating}, based on ${ratingCountText}`
      );
    }

    if (starIcons) {
      const icons = [];

      for (let index = 0; index < rating.full; index += 1) {
        const icon = document.createElement("span");
        icon.className = "star-icon is-full";
        icon.textContent = "\u2605";
        icons.push(icon);
      }

      if (rating.half) {
        const icon = document.createElement("span");
        icon.className = "star-icon is-half";
        icon.textContent = "\u2606";
        icons.push(icon);
      }

      for (let index = 0; index < rating.empty; index += 1) {
        const icon = document.createElement("span");
        icon.className = "star-icon is-empty";
        icon.textContent = "\u2606";
        icons.push(icon);
      }

      starIcons.replaceChildren(...icons);
    }

    if (cleanlinessLabel) {
      cleanlinessLabel.textContent = `${rating.displayRating}/${rating.maxRating}`;
    }

    if (cleanlinessRatingCount) {
      cleanlinessRatingCount.textContent = ratingCountText;
    }
  }

  function setStatus(message) {
    if (!statusText) return;
    statusText.textContent = message;
  }

  function collapseSearchPanel() {
    if (!searchCard || searchCard.classList.contains("is-collapsed")) return;
    searchCard.classList.add("is-collapsed");
    toggleSearchButton?.setAttribute("aria-label", "Expand search panel");
  }

  function setLocateButtonState(isLocated) {
    locateButtons.forEach((button) => {
      if (!button || button.id !== "locate-button") return;

      button.classList.toggle("is-located", isLocated);
      button.setAttribute("aria-pressed", String(isLocated));
      button.setAttribute("aria-label", isLocated ? "Update my location" : "Find my location");
    });
  }

  function isMapCenteredOnUserLocation() {
    if (!map || !userLocation) return false;

    const center = map.getCenter?.();
    if (!center) return false;

    return (
      distanceInMetres(userLocation.lat, userLocation.lng, center.lat, center.lng) <=
      locateActiveCenterToleranceMetres
    );
  }

  function updateLocateButtonStateFromMap() {
    setLocateButtonState(isMapCenteredOnUserLocation());
  }

  function isValidCleanlinessRating(rating) {
    const value = Number(rating);
    return Number.isFinite(value) && value >= 0.5 && value <= 5 && Number.isInteger(value * 2);
  }

  function renderCleanlinessSurvey(toilet) {
    const stored = toilet ? cleanlinessSurveyAnswers[toilet.id] : null;
    const storedRating = stored && typeof stored === "object" ? stored.rating : stored;
    const submittedAt = stored?.submittedAt ? new Date(stored.submittedAt).getTime() : null;
    const now = Date.now();
    const isWithinCooldown = submittedAt && now - submittedAt < 30 * 60 * 1000;

    const rating = Number(selectedRating ?? storedRating);
    const hasRating = isValidCleanlinessRating(rating);

    const feedbackSubmitButton = commentForm?.querySelector("button[type='submit']");
    if (feedbackSubmitButton) {
      feedbackSubmitButton.disabled = selectedRating === null;
    }

    if (mapSurveyStatus) {
      if (selectedRating !== null) {
        mapSurveyStatus.textContent = `Selected ${selectedRating}/5 stars. Add details or submit rating only.`;
      } else {
        mapSurveyStatus.textContent = isWithinCooldown
          ? `Thanks! You can rate this toilet again in 30 minutes.`
          : isAuthenticated()
            ? "Choose 0.5 to 5 stars to continue."
            : "Log in or sign up to leave feedback.";
      }
    }

    setVisualCleanlinessLevel(hasRating ? rating : 3);
  }

  function isPlaceholderToiletComment(comment = "") {
    const normalised = String(comment)
      .replace(/^comment:\s*/i, "")
      .trim()
      .replace(/[.。]+$/, "")
      .toLowerCase();

    return ["", "no notes yet", "no comment yet", "no comments yet", "none", "n/a"].includes(normalised);
  }

  function renderToiletSourceComment(toilet) {
    const toiletComment = document.querySelector("#toilet-comment");
    const commentPanel = toiletComment?.closest(".comment-panel");
    const hasUsefulComment = !isPlaceholderToiletComment(toilet?.comment);

    if (commentPanel) {
      commentPanel.hidden = !hasUsefulComment;
    }

    if (toiletComment && hasUsefulComment) {
      toiletComment.textContent = toilet.comment;
    }
  }

  function renderVisualPreview(preview, state, level, { image = null, showImage = false } = {}) {
    if (preview) {
      preview.dataset.cleanliness = String(level.value);
      preview.dataset.fixtureType = level.fixtureType;
      preview.setAttribute(
        "aria-label",
        `Cartoon toilet cleanliness preview: ${level.label}`
      );

      const toiletSvg = preview.querySelector(".cartoon-toilet-svg");
      const fallbackGraphic = toiletSvg;
      const shouldShowImage = Boolean(showImage && image && level.image);

      if (toiletSvg) {
        toiletSvg.classList.toggle("is-hidden", shouldShowImage);
      }

      if (image) {
        image.classList.remove("is-urinal");
        image.alt = `Toilet cleanliness preview: ${level.label}`;
        if (shouldShowImage) {
          image.onerror = () => {
            image.removeAttribute?.("src");
            image.src = "";
            image.classList.add("is-hidden");
            fallbackGraphic?.classList.remove("is-hidden");
          };
          image.src = level.image;
          image.classList.remove("is-hidden");
        } else {
          image.removeAttribute?.("src");
          image.src = "";
          image.classList.add("is-hidden");
          fallbackGraphic?.classList.remove("is-hidden");
        }
      }
    }

    if (state) {
      state.textContent = `${level.label} - ${level.tone}`;
    }
  }

  function updateOverviewVisualCleanlinessPreview(toilet = selectedToilet) {
    const level = getVisualCleanlinessLevel(getCleanlinessVisualLevel(toilet));
    renderVisualPreview(overviewVisualPreview, null, level, {
      image: overviewVisualImage,
      showImage: true
    });

    if (overviewVisualState) {
      overviewVisualState.textContent = `${level.label} - ${level.tone}`;
    }
  }

  function updateFeedbackVisualCleanlinessPreview() {
    const level = getVisualCleanlinessLevel();
    renderVisualPreview(visualCleanlinessPreview, visualCleanlinessState, level, {
      image: visualCleanlinessImage,
      showImage: true
    });

    renderVisualStarRating(level.value);
  }

  function setVisualCleanlinessLevel(level) {
    visualCleanlinessLevel = normaliseVisualCleanlinessLevel(level);
    updateFeedbackVisualCleanlinessPreview();
  }

  function renderVisualStarRating(level = visualCleanlinessLevel) {
    const selectedLevel = normaliseVisualCleanlinessLevel(level);
    visualCleanlinessStars?.setAttribute(
      "aria-label",
      `Toilet visual cleanliness rating ${selectedLevel} out of 5`
    );

    visualCleanlinessStars?.querySelectorAll?.("[data-visual-star]")?.forEach((button) => {
      const star = Number(button.dataset.visualStar);
      const fill = selectedLevel >= star ? 100 : selectedLevel >= star - 0.5 ? 50 : 0;
      button.style?.setProperty?.("--star-fill", `${fill}%`);
      button.classList.toggle("is-selected", fill > 0);
      button.setAttribute("aria-pressed", fill > 0 ? "true" : "false");
    });

    visualCleanlinessRatingButtons.forEach((hit) => {
      const rating = Number(hit.dataset.visualRating);
      hit.classList.toggle("is-selected", rating === selectedLevel);
    });
  }

  function resetVisualCleanlinessRating() {
    setVisualCleanlinessLevel(3);
  }

  function setCommentMediaStatus(message = getCommentMediaStatus(selectedCommentMedia)) {
    if (!commentMediaStatus) return;
    commentMediaStatus.textContent = message;
  }

  function createCommentMediaPreviewCard(media) {
    const item = document.createElement("div");
    item.className = "comment-media-preview-item";

    const frame = document.createElement("div");
    frame.className = "comment-media-preview-frame";

    if (media.type === "image") {
      const image = document.createElement("img");
      image.src = media.previewUrl;
      image.alt = media.file.name ? `Selected image: ${media.file.name}` : "Selected image";
      frame.append(image);
    } else {
      const video = document.createElement("video");
      video.src = media.previewUrl;
      video.muted = true;
      video.preload = "metadata";
      video.playsInline = true;
      frame.append(video);
    }

    const removeButton = document.createElement("button");
    removeButton.className = "comment-media-remove";
    removeButton.type = "button";
    removeButton.textContent = "x";
    removeButton.setAttribute("aria-label", `Remove ${media.file.name || "attachment"}`);
    removeButton.addEventListener("click", () => removeCommentMediaSelection(media.id));

    const caption = document.createElement("p");
    caption.className = "comment-media-caption";
    caption.textContent = `${media.file.name || "Attachment"} ${formatCommentMediaSize(media.file.size)}`.trim();

    item.append(frame, removeButton, caption);
    return item;
  }

  function renderCommentMediaPreview(statusMessage = getCommentMediaStatus(selectedCommentMedia)) {
    if (commentMediaPreview) {
      commentMediaPreview.replaceChildren();
      selectedCommentMedia.forEach((media) => {
        commentMediaPreview.append(createCommentMediaPreviewCard(media));
      });
    }

    setCommentMediaStatus(statusMessage);
  }

  function previewCommentMediaSelection() {
    const { selectedMedia, statusMessage } = addCommentMediaFiles({
      files: commentMediaInput?.files,
      selectedMedia: selectedCommentMedia
    });
    selectedCommentMedia = selectedMedia;

    if (commentMediaInput) {
      commentMediaInput.value = "";
    }

    renderCommentMediaPreview(statusMessage);
  }

  function resetCommentMediaAttachment() {
    if (commentMediaInput) {
      commentMediaInput.value = "";
    }

    selectedCommentMedia = clearCommentMediaSelections(selectedCommentMedia);
    renderCommentMediaPreview();
  }

  function removeCommentMediaSelection(mediaId) {
    selectedCommentMedia = removeCommentMediaSelectionById(selectedCommentMedia, mediaId);
    renderCommentMediaPreview();
  }

  function getCommentVisibility() {
    return commentAnonymousInput?.checked ? "anonymous" : "real";
  }

  function setCommentComposerOpen(open) {
    const shouldOpen = Boolean(open && selectedToilet && commentComposer);

    if (commentComposer) {
      commentComposer.hidden = !shouldOpen;
      commentComposer.classList.toggle("is-hidden", !shouldOpen);
    }

    if (commentComposerToggle) {
      commentComposerToggle.classList.toggle("is-active", shouldOpen);
      commentComposerToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
      commentComposerToggle.textContent = shouldOpen ? "Hide feedback" : "Write feedback";
    }

    mapPanel?.classList.toggle("has-comment-composer", shouldOpen);

    if (shouldOpen) {
      renderCleanlinessSurvey(selectedToilet);
      requestAnimationFrame(() => commentInput?.focus());
    }
  }

  function setCommentComposerAvailable(available) {
    const shouldShow = Boolean(
      available && selectedToilet && (feedbackActionBar || commentComposerToggle)
    );

    if (feedbackActionBar) {
      feedbackActionBar.hidden = !shouldShow;
      feedbackActionBar.classList.toggle("is-hidden", !shouldShow);
    }

    if (commentComposerToggle) {
      commentComposerToggle.hidden = !shouldShow;
      commentComposerToggle.classList.toggle("is-hidden", !shouldShow);
    }

    if (!shouldShow) {
      setCommentComposerOpen(false);
    }
  }

  function toggleCommentComposer() {
    setCommentComposerOpen(commentComposer?.hidden ?? true);
  }

  function closeCommentComposer() {
    setCommentComposerOpen(false);
  }

  function applyCommentPreset(presetText) {
    const preset = String(presetText ?? "").trim();
    if (!commentInput || !preset) return;

    const currentText = commentInput.value.trim();
    if (currentText.includes(preset)) {
      commentInput.focus();
      return;
    }

    commentInput.value = currentText ? `${currentText}\n${preset}` : preset;
    commentInput.dispatchEvent(new Event("input", { bubbles: true }));
    commentInput.focus();
    commentInput.setSelectionRange?.(commentInput.value.length, commentInput.value.length);
  }

  function setDetailSection(sectionName = "overview", { loadComments = true } = {}) {
    const hasPanel = [...detailPanels].some((panel) => panel.dataset.detailPanel === sectionName);
    const nextSection = hasPanel ? sectionName : "overview";

    detailSectionLinks.forEach((link) => {
      const isActive = link.dataset.detailSection === nextSection;
      link.classList.toggle("is-active", isActive);
      link.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    detailPanels.forEach((panel) => {
      const isActive = panel.dataset.detailPanel === nextSection;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });

    currentDetailSection = nextSection;
    if (loadComments && nextSection === "comment" && selectedToilet) {
      feedbackThreadController.loadComments(selectedToilet);
    }
  }

  function createToiletIcon(toilet, selected = false) {
    const classes = ["map-marker"];
    if (toilet.paid) classes.push("is-paid");
    if (selected) classes.push("is-selected");

    return window.L.divIcon({
      className: "map-marker-icon",
      html: `<span class="${classes.join(" ")}" aria-hidden="true"></span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30]
    });
  }

  function getMapVisibleToilets() {
    if (!map) return [...filteredToilets];

    const bounds = map.getBounds();
    return filteredToilets.filter((toilet) => bounds.contains([toilet.lat, toilet.lng]));
  }

  function getBounds() {
    if (!map) return null;
    const bounds = map.getBounds();
    if (!bounds) return null;

    if (
      [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng]
        .map(Number)
        .every(Number.isFinite)
    ) {
      return {
        minLat: Number(bounds.minLat),
        maxLat: Number(bounds.maxLat),
        minLng: Number(bounds.minLng),
        maxLng: Number(bounds.maxLng)
      };
    }

    if (
      typeof bounds.getSouth !== "function" ||
      typeof bounds.getNorth !== "function" ||
      typeof bounds.getWest !== "function" ||
      typeof bounds.getEast !== "function"
    ) {
      return null;
    }

    return {
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast()
    };
  }

  function getDistanceReference() {
    if (userLocation) {
      return { lat: userLocation.lat, lng: userLocation.lng, source: "user" };
    }

    if (map) {
      const center = map.getCenter();
      return { lat: center.lat, lng: center.lng, source: "map" };
    }

    return { lat: appConfig.initialView.lat, lng: appConfig.initialView.lng, source: "map" };
  }

  function getDistanceMetres(toilet) {
    const reference = getDistanceReference();
    return distanceInMetres(reference.lat, reference.lng, toilet.lat, toilet.lng);
  }

  function formatToiletDistance(toilet) {
    const reference = getDistanceReference();
    const distance = formatDistance(reference, toilet);
    return reference.source === "user" ? distance : distance.replace("away", "from map centre");
  }

  function getFeatureScore(toilet) {
    return featureFilterOptions.reduce((score, option) => {
      return score + (toilet.features?.[option.key] === "Y" ? 1 : 0);
    }, 0);
  }

  function compareByName(a, b) {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  }

  function compareToilets(a, b) {
    const distanceDelta = getDistanceMetres(a) - getDistanceMetres(b);
    const cleanlinessDelta = getCleanlinessScore(b) - getCleanlinessScore(a);
    const freeDelta = Number(b.features?.free === "Y") - Number(a.features?.free === "Y");
    const facilitiesDelta = getFeatureScore(b) - getFeatureScore(a);

    if (sortMode === "cleanliness") {
      return cleanlinessDelta || distanceDelta || compareByName(a, b);
    }

    if (sortMode === "free") {
      return freeDelta || distanceDelta || cleanlinessDelta || compareByName(a, b);
    }

    if (sortMode === "facilities") {
      return facilitiesDelta || distanceDelta || cleanlinessDelta || compareByName(a, b);
    }

    return distanceDelta || cleanlinessDelta || facilitiesDelta || compareByName(a, b);
  }

  function sortFilteredToilets() {
    filteredToilets.sort(compareToilets);
  }

  function updateSelectedMarkerAppearance() {
    markerById.forEach((marker, id) => {
      const toilet = visibleToilets.find((item) => item.id === id);
      if (!toilet) return;
      marker.setIcon(createToiletIcon(toilet, selectedToilet?.id === id));
    });
  }

  function renderResultsSummary() {
    if (!resultsSummary) return;

    const sortLabel = sortSelect?.selectedOptions?.[0]?.textContent ?? "Nearest";
    const suffix = selectedFeatureFilters.size > 0 ? "matches" : "nearby toilets";
    resultsSummary.textContent = `${filteredToilets.length} ${suffix} - ${sortLabel}`;
  }

  function renderResults() {
    renderResultsSummary();

    if (!resultsList) return;

    resultsList.replaceChildren();

    if (filteredToilets.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.className = "empty-results";
      emptyState.textContent = "No toilets match the selected needs.";
      resultsList.append(emptyState);
      return;
    }

    filteredToilets.slice(0, resultRenderLimit).forEach((toilet) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toilet-result";
      if (selectedToilet?.id === toilet.id) {
        button.classList.add("is-selected");
      }
      button.addEventListener("click", async () => {
        await setToilet(toilet.id);
        collapseSearchPanel();
      });

      const main = document.createElement("span");
      main.className = "result-main";

      const title = document.createElement("strong");
      title.className = "result-title";
      title.textContent = toilet.name;

      const area = document.createElement("span");
      area.className = "result-area";
      area.textContent = toilet.area;

      const meta = document.createElement("span");
      meta.className = "result-meta";

      const cleanliness = document.createElement("span");
      cleanliness.textContent = formatCleanlinessRating(toilet);

      const facilities = document.createElement("span");
      facilities.textContent = `${getFeatureScore(toilet)} facilities`;

      meta.append(cleanliness, facilities);
      main.append(title, area, meta);

      const distance = document.createElement("span");
      distance.className = "result-distance";
      distance.textContent = formatToiletDistance(toilet);

      button.append(main, distance);
      resultsList.append(button);
    });

    if (filteredToilets.length > resultRenderLimit) {
      const more = document.createElement("p");
      more.className = "more-results";
      more.textContent = `${filteredToilets.length - resultRenderLimit} more toilets on the map.`;
      resultsList.append(more);
    }
  }

  function refreshFilteredDisplay() {
    sortFilteredToilets();
    renderMarkers();
    renderResults();
    updateFilterStatus();
  }

  function hideToiletDetails() {
    selectedToilet = null;
    selectedCleanlinessDisplayToilet = null;
    cleanlinessDisplayRequestId += 1;
    selectedRating = null;
    setCommentComposerAvailable(false);
    resetVisualCleanlinessRating();
    detailsCard?.classList.add("is-hidden");
    mapPanel?.classList.remove("has-details");

    if (aiSummaryContainer) {
      aiSummaryContainer.classList.add("is-hidden");
      if (aiSummaryText) aiSummaryText.textContent = "";
    }

    if (directionsButton) {
      directionsButton.disabled = true;
    }

    renderResults();
    renderCleanlinessSurvey(null);
    updateSelectedMarkerAppearance();
  }

  function setFeatureValue(selector, value) {
    const element = document.querySelector(selector);
    if (element) {
      element.textContent = value ?? "?";
    }
  }

  function renderUserMarker() {
    if (!map) return;

    if (!userLocation) {
      userLocationMarker?.remove();
      userLocationMarker = null;
      return;
    }

    if (!userLocationMarker) {
      userLocationMarker = window.L.marker([userLocation.lat, userLocation.lng], {
        icon: window.L.divIcon({
          className: "map-user-marker-icon",
          html: '<span class="map-user-marker" aria-hidden="true"></span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        }),
        keyboard: false
      }).addTo(map);
    } else {
      userLocationMarker.setLatLng([userLocation.lat, userLocation.lng]);
    }
  }

  async function setToilet(toiletId, { fly = true, updateDistance = true, defaultSection = "overview", focusCommentId = null } = {}) {
    let toilet = allToilets.find((item) => item.id === toiletId);
    if (!toilet) return false;

    currentCleanlinessRange = getToiletCleanlinessRange(toiletId);
    syncCleanlinessRangeSelect(currentCleanlinessRange);

    // If the toilet record is missing detail fields (like the detailed comment or actual opening hours), fetch full details
    if (toilet && (typeof toilet.comment === "undefined" || toilet.comment === null || !toilet.hours || toilet.hours.today.includes("Closed"))) {
      try {
        const fullDetails = await fetchToiletDetail(toiletId, {
          cleanlinessRange: currentCleanlinessRange
        });
        if (fullDetails) {
          cacheCleanlinessDisplay(fullDetails, currentCleanlinessRange);
          toilet = mergeToiletDetailWithoutCleanliness(toilet, fullDetails);
          allToilets = allToilets.map(t => t.id === toiletId ? toilet : t);
        }
      } catch (error) {
        console.warn("Failed to fetch toilet details from API:", error);
      }
    }

    selectedToilet = toilet;
    selectedCleanlinessDisplayToilet = getCachedCleanlinessDisplayToilet(toilet, currentCleanlinessRange);
    selectedRating = null;
    closeCommentComposer();
    setCommentComposerAvailable(true);
    feedbackThreadController.resetCommentsForToilet(toilet);

    // Only switch the section if a specific one was requested (e.g. from search or history)
    // Otherwise, keep the current active section to prevent it jumping back to 'overview'
    if (arguments[1]?.defaultSection) {
      setDetailSection(defaultSection, { loadComments: false });
    }

    detailsCard?.classList.remove("is-hidden");
    mapPanel?.classList.add("has-details");

    if (directionsButton) {
      directionsButton.disabled = false;
    }

    document.querySelector("#toilet-name").textContent = toilet.name;
    document.querySelector("#toilet-area").textContent = toilet.area;
    renderToiletSourceComment(toilet);
    setFeatureValue("#feature-women", toilet.features.women);
    setFeatureValue("#feature-men", toilet.features.men);
    setFeatureValue("#feature-accessible", toilet.features.accessible);
    setFeatureValue("#feature-neutral", toilet.features.neutral);
    setFeatureValue("#feature-children", toilet.features.children);
    setFeatureValue("#feature-baby-changing", toilet.features.babyChanging);
    setFeatureValue("#feature-bidet", toilet.features.bidet);
    setFeatureValue("#feature-automatic", toilet.features.automatic);
    setFeatureValue("#feature-urinal-only", toilet.features.urinalOnly);
    setFeatureValue("#feature-radar-key", toilet.features.radarKey);
    setFeatureValue("#feature-free", toilet.features.free);
    document.querySelector("#hours-today").textContent = toilet.hours.today;
    document.querySelector("#hours-sat").textContent = toilet.hours.sat;
    document.querySelector("#hours-sun").textContent = toilet.hours.sun;
    
    if (updateDistance) {
      document.querySelector("#distance-line").textContent = formatToiletDistance(toilet);
    }

    if (mapSurveyStatus) {
      mapSurveyStatus.classList.remove("warning");
    }
    
    renderCleanlinessSurvey(toilet);
    renderCleanlinessRating(selectedCleanlinessDisplayToilet);
    updateOverviewVisualCleanlinessPreview(selectedCleanlinessDisplayToilet);
    await refreshSelectedCleanlinessDisplay();

    if (currentDetailSection === "comment" || focusCommentId !== null) {
      await feedbackThreadController.loadComments(toilet, {
        focusCommentId,
        force: focusCommentId !== null
      });
    }

    if (fly) {
      const marker = markerById.get(toilet.id);
      if (marker && map) {
        map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.45 });
      }
    }

    renderResults();
    updateSelectedMarkerAppearance();
    onToiletSelected(toilet);
    return true;
  }

  async function getAiSummary() {
    if (!selectedToilet || !summarizeCommentsButton || !aiSummaryContainer || !aiSummaryText) return;

    summarizeCommentsButton.disabled = true;
    aiSummaryContainer.classList.remove("is-hidden");
    aiSummaryContainer.classList.add("is-loading");
    aiSummaryText.textContent = "AI is analyzing comments...";

    try {
      const summary = await fetchAiSummary(selectedToilet.id);
      aiSummaryText.textContent = summary;
    } catch (error) {
      console.error("Failed to fetch AI summary:", error);
      aiSummaryText.textContent = `Error: ${error.message || "Could not generate AI summary."}`;
    } finally {
      aiSummaryContainer.classList.remove("is-loading");
      summarizeCommentsButton.disabled = false;
    }
  }

  async function openCommentThread(toiletId, commentId) {
    feedbackThreadController.resetCommentControls();

    const opened = await setToilet(toiletId, {
      defaultSection: "comment",
      focusCommentId: commentId
    });

    if (!opened) {
      setStatus("Could not find that toilet in the current map data.");
    }
  }

  function renderMarkers() {
    if (!map || !markersLayer) {
      visibleToilets = [...filteredToilets];
      hiddenByMarkerLimit = 0;
      return;
    }

    const zoom = map.getZoom();
    if (zoom < appConfig.markerHideZoomThreshold) {
      visibleToilets = [];
      hiddenByMarkerLimit = 0;
      markerById = new Map();
      markersLayer.clearLayers();
      renderUserMarker();
      return;
    }

    const inBoundsToilets = getMapVisibleToilets();
    hiddenByMarkerLimit = Math.max(0, inBoundsToilets.length - appConfig.markerRenderLimit);
    visibleToilets = inBoundsToilets.slice(0, appConfig.markerRenderLimit);
    markerById = new Map();
    markersLayer.clearLayers();

    visibleToilets.forEach((toilet) => {
      const marker = window.L.marker([toilet.lat, toilet.lng], {
        icon: createToiletIcon(toilet, selectedToilet?.id === toilet.id),
        keyboard: true,
        title: `${toilet.name}, ${toilet.area}`
      });

      marker.on("click", async () => await setToilet(toilet.id));
      marker.addTo(markersLayer);
      markerById.set(toilet.id, marker);
    });

    renderUserMarker();
  }

  function updateFilterStatus() {
    if (filteredToilets.length === 0) {
      setStatus("No matching toilets. Try removing some filters.");
      return;
    }

    const inViewCount = visibleToilets.length;
    let limitHint = "";
    if (map && map.getZoom() < appConfig.markerHideZoomThreshold) {
      limitHint = " Zoom in to show toilets on the map.";
    } else if (hiddenByMarkerLimit > 0) {
      limitHint = ` Zoom in to load ${hiddenByMarkerLimit} more.`;
    }

    const queryHint = queryText ? " for this search" : "";
    const filterHint = selectedFeatureFilters.size > 0 ? ` with ${selectedFeatureFilters.size} needs` : "";

    setStatus(`Showing ${filteredToilets.length} toilets${queryHint}${filterHint}. ${inViewCount} visible on map.${limitHint}`);
  }

  function applyFilters() {
    const query = queryText.trim().toLowerCase();
    const selectedFilters = [...selectedFeatureFilters];

    filteredToilets = allToilets.filter((toilet) => {
      const matchesFeatures = selectedFilters.every((featureKey) => toilet.features?.[featureKey] === "Y");
      if (!matchesFeatures) return false;

      if (!query) return true;
      return toilet.name.toLowerCase().includes(query) || toilet.area.toLowerCase().includes(query);
    });

    if (selectedToilet && !filteredToilets.some((toilet) => toilet.id === selectedToilet.id)) {
      hideToiletDetails();
    }

    refreshFilteredDisplay();
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocateButtonState(false);
      setStatus("Your browser does not support location.");
      return;
    }

    setStatus("Requesting location permission...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        refreshFilteredDisplay();

        if (selectedToilet) {
          document.querySelector("#distance-line").textContent = formatToiletDistance(selectedToilet);
        }

        if (map) {
          map.flyTo([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 15), { duration: 0.5 });
          setLocateButtonState(true);
        } else {
          updateLocateButtonStateFromMap();
        }

        setStatus("Location found. Distances are now updated.");
      },
      () => {
        updateLocateButtonStateFromMap();
        setStatus("Location permission was denied or unavailable.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  }

  function openDirections() {
    if (!selectedToilet) {
      setStatus("Select a toilet marker first.");
      return;
    }

    if (isAuthenticated()) {
      recordAccessHistory({
        toiletId: selectedToilet.id,
        toiletName: selectedToilet.name,
        eventType: "Directions",
        amountGbp: 0,
        useFreeTicket: false
      }).catch((error) => {
        console.error("Failed to record access history for directions:", error);
      });
    }

    const destination = `${selectedToilet.lat},${selectedToilet.lng}`;
    const origin = userLocation ? `&origin=${userLocation.lat},${userLocation.lng}` : "";
    const url = `https://www.google.com/maps/dir/?api=1${origin}&destination=${destination}&travelmode=walking`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function createInteractiveMap() {
    if (!mapElement || !window.L) {
      setStatus("Map engine failed to load.");
      return false;
    }

    map = window.L.map(mapElement, {
      preferCanvas: true,
      zoomControl: false,
      attributionControl: true
    }).setView([appConfig.initialView.lat, appConfig.initialView.lng], appConfig.initialView.zoom);

    window.L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      minZoom: 3,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);

    markersLayer = window.L.layerGroup().addTo(map);

    map.on("moveend zoomend", () => {
      refreshFilteredDisplay();
      updateLocateButtonStateFromMap();
      onBoundsChanged(getBounds());
    });

    return true;
  }

  function setToilets(nextToilets, { hideDetails = true, cleanlinessRange = "all", merge = false } = {}) {
    const dataCleanlinessRange = normaliseCleanlinessRange(cleanlinessRange);

    const processedToilets = nextToilets.map((toilet) =>
      applyStoredCleanlinessUpdate(toilet, dataCleanlinessRange)
    );

    if (merge) {
      const existingMap = new Map(allToilets.map((t) => [t.id, t]));
      processedToilets.forEach((t) => existingMap.set(t.id, t));
      allToilets = Array.from(existingMap.values());
    } else {
      allToilets = processedToilets;
    }

    applyFilters();

    if (hideDetails) {
      hideToiletDetails();
    }
  }

  function refreshAfterTabVisible() {
    if (!map) return;

    requestAnimationFrame(() => {
      map.invalidateSize();
      refreshFilteredDisplay();
      renderUserMarker();
    });
  }

  function setSearchQuery(value) {
    queryText = value;
    applyFilters();
  }

  function setFeatureFilter(featureKey, checked) {
    if (!featureFilterOptions.some((option) => option.key === featureKey)) return;

    selectedFeatureFilters = new Set(selectedFeatureFilters);
    if (checked) {
      selectedFeatureFilters.add(featureKey);
    } else {
      selectedFeatureFilters.delete(featureKey);
    }

    applyFilters();
  }

  function setSortMode(nextSortMode) {
    sortMode = sortModes.has(nextSortMode) ? nextSortMode : "distance";
    refreshFilteredDisplay();
  }

  function enableAccessibleOnly() {
    setFeatureFilter("accessible", true);

    featureFilterInputs.forEach((input) => {
      if (input.value === "accessible") {
        input.checked = true;
      }
    });
  }

  function resetFilters() {
    selectedFeatureFilters = new Set();
    sortMode = "distance";
    queryText = "";

    if (searchInput) {
      searchInput.value = "";
    }

    if (sortSelect) {
      sortSelect.value = "distance";
    }

    featureFilterInputs.forEach((input) => {
      input.checked = false;
    });

    applyFilters();
  }

  function applyProfilePreferences(user, enabled) {
    if (!enabled || !user) {
      resetFilters();
      return;
    }

    const preferences = [];
    try {
      const needs = JSON.parse(user.preferences || "[]");
      preferences.push(...needs);
    } catch (e) {
      console.error("Failed to parse user preferences:", e);
    }

    if (user.gender === "female") preferences.push("women");
    if (user.gender === "male") preferences.push("men");
    if (user.gender === "neutral") preferences.push("neutral");

    selectedFeatureFilters = new Set();
    preferences.forEach(pref => {
      if (featureFilterOptions.some(opt => opt.key === pref)) {
        selectedFeatureFilters.add(pref);
      }
    });

    // Sync UI checkboxes
    featureFilterInputs.forEach(input => {
      input.checked = selectedFeatureFilters.has(input.value);
    });

    applyFilters();
  }

  function getSelectedToilet() {
    return selectedToilet;
  }

  function normaliseCleanlinessRange(range) {
    const value = String(range ?? "").trim();
    return value || defaultCleanlinessRange;
  }

  function syncCleanlinessRangeSelect(range = currentCleanlinessRange) {
    if (cleanlinessRangeSelect && cleanlinessRangeSelect.value !== range) {
      cleanlinessRangeSelect.value = range;
    }
  }

  function getToiletCleanlinessRange(toiletId) {
    return cleanlinessRangeByToiletId.get(toiletId) ?? defaultCleanlinessRange;
  }

  function getCleanlinessDisplaySnapshot(toiletId, cleanlinessRange = currentCleanlinessRange) {
    return cleanlinessDisplayCache.get(getCleanlinessDisplayCacheKey(toiletId, cleanlinessRange));
  }

  function getCleanlinessDisplayCacheKey(toiletId, cleanlinessRange = currentCleanlinessRange) {
    return `${String(toiletId)}::${normaliseCleanlinessRange(cleanlinessRange)}`;
  }

  function getCleanlinessSnapshot(toilet) {
    return {
      cleanliness: toilet?.cleanliness ?? null,
      cleanlinessSurvey: toilet?.cleanlinessSurvey
        ? { ...toilet.cleanlinessSurvey }
        : { ratingTotal: 0, ratingCount: 0 }
    };
  }

  function mergeCleanlinessSnapshot(toilet, snapshot) {
    if (!toilet || !snapshot) return toilet;

    return {
      ...toilet,
      cleanliness: snapshot.cleanliness,
      cleanlinessSurvey: snapshot.cleanlinessSurvey
        ? { ...snapshot.cleanlinessSurvey }
        : { ratingTotal: 0, ratingCount: 0 }
    };
  }

  function mergeToiletDetailWithoutCleanliness(toilet, detailToilet) {
    if (!toilet || !detailToilet) return toilet;

    return mergeCleanlinessSnapshot(
      {
        ...toilet,
        ...detailToilet
      },
      getCleanlinessSnapshot(toilet)
    );
  }

  function getCachedCleanlinessDisplayToilet(toilet, cleanlinessRange = currentCleanlinessRange) {
    const cachedSnapshot = toilet?.id ? getCleanlinessDisplaySnapshot(toilet.id, cleanlinessRange) : null;
    return cachedSnapshot ? mergeCleanlinessSnapshot(toilet, cachedSnapshot) : toilet;
  }

  function cacheCleanlinessDisplay(toilet, cleanlinessRange = currentCleanlinessRange) {
    if (!toilet?.id) return;

    cleanlinessDisplayCache = new Map(cleanlinessDisplayCache);
    cleanlinessDisplayCache.set(
      getCleanlinessDisplayCacheKey(toilet.id, cleanlinessRange),
      getCleanlinessSnapshot(toilet)
    );
  }

  function setSelectedCleanlinessDisplay(toilet) {
    selectedCleanlinessDisplayToilet = toilet;
    renderCleanlinessRating(toilet);
    updateOverviewVisualCleanlinessPreview(toilet);
  }

  function shouldFetchCleanlinessDisplay() {
    return Boolean(globalThis.window?.location && typeof globalThis.fetch === "function");
  }

  async function refreshSelectedCleanlinessDisplay({ force = false } = {}) {
    if (!selectedToilet?.id) return null;

    const range = normaliseCleanlinessRange(currentCleanlinessRange);
    const requestId = cleanlinessDisplayRequestId + 1;
    cleanlinessDisplayRequestId = requestId;

    if (range === "all") {
      cacheCleanlinessDisplay(selectedToilet, range);
      setSelectedCleanlinessDisplay(selectedToilet);
      return selectedToilet;
    }

    const cacheKey = getCleanlinessDisplayCacheKey(selectedToilet.id, range);
    const cachedSnapshot = !force ? cleanlinessDisplayCache.get(cacheKey) : null;
    if (cachedSnapshot) {
      const cachedToilet = mergeCleanlinessSnapshot(selectedToilet, cachedSnapshot);
      setSelectedCleanlinessDisplay(cachedToilet);
      return cachedToilet;
    }

    if (!shouldFetchCleanlinessDisplay()) {
      setSelectedCleanlinessDisplay(selectedToilet);
      return selectedToilet;
    }

    try {
      const detailToilet = await fetchToiletDetail(selectedToilet.id, {
        cleanlinessRange: range,
        force
      });

      if (
        requestId !== cleanlinessDisplayRequestId ||
        !detailToilet ||
        selectedToilet?.id !== detailToilet.id ||
        range !== normaliseCleanlinessRange(currentCleanlinessRange)
      ) {
        return null;
      }

      const displayToilet = mergeCleanlinessSnapshot(selectedToilet, getCleanlinessSnapshot(detailToilet));
      cacheCleanlinessDisplay(displayToilet, range);
      setSelectedCleanlinessDisplay(displayToilet);
      return displayToilet;
    } catch (error) {
      console.warn("Failed to refresh cleanliness rating period:", error);
      if (requestId === cleanlinessDisplayRequestId) {
        setSelectedCleanlinessDisplay(selectedToilet);
      }
      return null;
    }
  }

  function setCleanlinessRange(range) {
    const nextRange = normaliseCleanlinessRange(range);
    currentCleanlinessRange = nextRange;

    if (selectedToilet?.id) {
      cleanlinessRangeByToiletId = new Map(cleanlinessRangeByToiletId);
      cleanlinessRangeByToiletId.set(selectedToilet.id, nextRange);
    }

    syncCleanlinessRangeSelect(nextRange);
    return refreshSelectedCleanlinessDisplay();
  }

  function getCleanlinessUpdateCount(cleanlinessUpdate) {
    const ratingCount = Number(cleanlinessUpdate?.cleanlinessSurvey?.ratingCount);
    return Number.isFinite(ratingCount) ? ratingCount : 0;
  }

  function applyStoredCleanlinessUpdate(toilet, cleanlinessRange = currentCleanlinessRange) {
    const storedUpdate = cleanlinessUpdateById.get(toilet.id);
    if (!storedUpdate) return toilet;

    if (storedUpdate.cleanlinessRange !== normaliseCleanlinessRange(cleanlinessRange)) {
      return toilet;
    }

    const incomingCount = getCleanlinessUpdateCount(toilet);
    const storedCount = getCleanlinessUpdateCount(storedUpdate);
    if (incomingCount >= storedCount) return toilet;

    return {
      ...toilet,
      cleanliness: storedUpdate.cleanliness,
      cleanlinessSurvey: storedUpdate.cleanlinessSurvey
    };
  }

  function updateToiletCleanliness(
    toiletUpdate,
    { store = true, cleanlinessRange = "all" } = {}
  ) {
    if (!toiletUpdate?.id) return;

    const storedRange = normaliseCleanlinessRange(cleanlinessRange);
    if (store) {
      cleanlinessUpdateById = new Map(cleanlinessUpdateById);
      cleanlinessUpdateById.set(toiletUpdate.id, {
        cleanliness: toiletUpdate.cleanliness,
        cleanlinessSurvey: toiletUpdate.cleanlinessSurvey,
        cleanlinessRange: storedRange
      });
    }

    const applyUpdate = (toilet) =>
      toilet.id === toiletUpdate.id
        ? {
            ...toilet,
            cleanliness: toiletUpdate.cleanliness,
            cleanlinessSurvey: toiletUpdate.cleanlinessSurvey
          }
        : toilet;

    allToilets = allToilets.map(applyUpdate);
    filteredToilets = filteredToilets.map(applyUpdate);
    visibleToilets = visibleToilets.map(applyUpdate);

    if (selectedToilet?.id === toiletUpdate.id) {
      selectedToilet = applyUpdate(selectedToilet);
      if (normaliseCleanlinessRange(cleanlinessRange) === normaliseCleanlinessRange(currentCleanlinessRange)) {
        selectedCleanlinessDisplayToilet = applyUpdate(selectedCleanlinessDisplayToilet ?? selectedToilet);
        renderCleanlinessRating(selectedCleanlinessDisplayToilet);
        updateOverviewVisualCleanlinessPreview(selectedCleanlinessDisplayToilet);
      }
    }

    renderResults();
  }

  function selectCleanlinessRating(rating) {
    if (!selectedToilet) {
      setStatus("Select a toilet marker before leaving feedback.");
      return;
    }

    const safeRating = Number(rating);
    if (!isValidCleanlinessRating(safeRating)) return;

    selectedRating = safeRating;
    if (mapSurveyStatus) {
      mapSurveyStatus.classList.remove("warning");
    }
    renderCleanlinessSurvey(selectedToilet);
  }

  function createCurrentRangeCleanlinessUpdate(toiletUpdate, rating) {
    if (currentCleanlinessRange === "all" || selectedToilet?.id !== toiletUpdate.id) {
      return toiletUpdate;
    }

    const periodToilet = selectedCleanlinessDisplayToilet ?? selectedToilet;
    const previousTotal = Number(periodToilet?.cleanlinessSurvey?.ratingTotal);
    const previousCount = Number(periodToilet?.cleanlinessSurvey?.ratingCount);
    const safeRating = Number(rating);

    if (
      !Number.isFinite(previousTotal) ||
      !Number.isFinite(previousCount) ||
      previousCount < 0 ||
      !Number.isFinite(safeRating)
    ) {
      return toiletUpdate;
    }

    const ratingTotal = Math.max(previousTotal, 0) + safeRating;
    const ratingCount = Math.max(Math.floor(previousCount), 0) + 1;

    return {
      ...toiletUpdate,
      cleanliness: ratingTotal / ratingCount,
      cleanlinessSurvey: {
        ratingTotal,
        ratingCount
      }
    };
  }

  async function applySavedCleanlinessResult(result, rating, { refreshToilets = false } = {}) {
    if (!result?.toilet?.id) {
      throw new Error("Cleanliness response did not include the updated toilet.");
    }

    updateToiletCleanliness(result.toilet, {
      store: true,
      cleanlinessRange: "all"
    });

    const toiletUpdate = createCurrentRangeCleanlinessUpdate(result.toilet, rating);
    cacheCleanlinessDisplay(toiletUpdate, currentCleanlinessRange);
    if (selectedToilet?.id === result.toilet.id) {
      setSelectedCleanlinessDisplay(mergeCleanlinessSnapshot(selectedToilet, getCleanlinessSnapshot(toiletUpdate)));
    }

    if (refreshToilets) {
      try {
        await onCleanlinessSaved();
      } catch (error) {
        console.error("Failed to refresh cleanliness period:", error);
      }
    }

    cleanlinessSurveyAnswers = {
      ...cleanlinessSurveyAnswers,
      [result.toilet.id]: {
        rating,
        toiletName: result.toilet.name ?? selectedToilet?.name,
        submittedAt: new Date().toISOString()
      }
    };

    saveSurveyAnswers();
    renderCleanlinessSurvey(selectedToilet);
  }

  async function answerCleanlinessSurvey(rating) {
    if (!selectedToilet) {
      setStatus("Select a toilet marker before leaving feedback.");
      return false;
    }

    const safeRating = Number(rating);
    if (!isValidCleanlinessRating(safeRating)) return false;

    if (!isAuthenticated()) {
      if (mapSurveyStatus) {
        mapSurveyStatus.textContent = "Log in or sign up to leave feedback.";
      }
      showLoginPrompt("Log in or sign up to leave feedback.");
      return false;
    }

    if (mapSurveyStatus) {
      mapSurveyStatus.classList.remove("warning");
      mapSurveyStatus.textContent = "Saving rating to database...";
    }

    try {
      const result = await submitCleanlinessSurvey({
        toiletId: selectedToilet.id,
        toiletName: selectedToilet.name,
        rating: safeRating
      });

      await applySavedCleanlinessResult(result, safeRating);
    } catch (error) {
      console.error("Cleanliness survey failed:", error);
      if (error.status === 401) {
        if (mapSurveyStatus) {
          mapSurveyStatus.classList.add("warning");
          mapSurveyStatus.textContent = "Log in or sign up to leave feedback.";
        }
        showLoginPrompt("Log in or sign up to leave feedback.");
        return false;
      }

      if (mapSurveyStatus) {
        mapSurveyStatus.classList.add("warning");
        mapSurveyStatus.textContent = error.message || "Could not save rating to database.";
      }
      return false;
    }

    return true;
  }

  async function postComment(event) {
    event.preventDefault();

    if (!selectedToilet || !commentInput) return;

    const feedbackRating = Number(selectedRating);
    if (!isValidCleanlinessRating(feedbackRating)) {
      if (mapSurveyStatus) {
        mapSurveyStatus.classList.add("warning");
        mapSurveyStatus.textContent = "Choose a rating before submitting feedback.";
      }
      return;
    }

    const commentText = commentInput.value.trim();
    const hasCommentText = commentText.length > 0;
    const hasMedia = selectedCommentMedia.length > 0;

    if (!isAuthenticated()) {
      showLoginPrompt("Log in to leave feedback.");
      return;
    }

    const submitButton = commentForm?.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      if (!hasCommentText && !hasMedia) {
        const saved = await answerCleanlinessSurvey(feedbackRating);
        if (saved) {
          selectedRating = null;
          closeCommentComposer();
          renderCleanlinessSurvey(selectedToilet);
        }
        return;
      }

      if (!hasCommentText) {
        if (mapSurveyStatus) {
          mapSurveyStatus.classList.add("warning");
          mapSurveyStatus.textContent = "Add a short comment before posting media.";
        }
        return;
      }

      const media = await readCommentMediaAttachments(selectedCommentMedia);
      const commentVisibility = getCommentVisibility();
      const result = await submitComment(
        selectedToilet.id,
        commentText,
        media,
        commentVisibility,
        feedbackRating
      );
      await applySavedCleanlinessResult(result, feedbackRating);
      feedbackThreadController.renderComments(result.comments);
      commentInput.value = "";
      selectedRating = null;
      resetCommentMediaAttachment();
      closeCommentComposer();
      renderCleanlinessSurvey(selectedToilet);
    } catch (error) {
      console.error("Failed to submit feedback:", error);
      if (error.status === 401) {
        showLoginPrompt("Log in to leave feedback.");
        return;
      }
      alert(error?.message || "Could not submit feedback. Please try again later.");
    } finally {
      if (submitButton) {
        submitButton.disabled = selectedRating === null;
      }
    }
  }

  return {
    createInteractiveMap,
    setStatus,
    setToilets,
    setSearchQuery,
    setFeatureFilter,
    setSortMode,
    enableAccessibleOnly,
    resetFilters,
    requestLocation,
    openDirections,
    refreshFilteredDisplay,
    setDetailSection,
    hideToiletDetails,
    refreshAfterTabVisible,
    getSelectedToilet,
    getBounds,
    setToilet,
    setCleanlinessRange,
    openCommentThread,
    updateToiletCleanliness,
    selectCleanlinessRating,
    answerCleanlinessSurvey,
    postComment,
    getAiSummary,
    setCommentSortMode: feedbackThreadController.setCommentSortMode,
    setCommentFilter: feedbackThreadController.setCommentFilter,
    toggleCommentComposer,
    closeCommentComposer,
    setVisualCleanlinessLevel,
    applyCommentPreset,
    previewCommentMediaSelection,
    removeCommentMediaSelection,
    applyProfilePreferences
  };
}
