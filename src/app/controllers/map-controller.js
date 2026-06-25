import { appConfig } from "../config/app-config.js";
import {
  clearToiletDetailCache,
  fetchAiSummary,
  fetchToiletDetail,
  submitCleanlinessSurvey,
  submitComment,
  submitToiletContribution
} from "../services/toilets-service.js";
import { createFeedbackThreadController } from "./feedback-thread-controller.js";
import {
  formatCleanlinessRating,
  formatCleanlinessRatingCount,
  getCleanlinessVisualLevel,
  getCleanlinessScore,
  getCleanlinessStars
} from "../utils/cleanliness.js";
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
const duplicateToiletRadiusMetres = 35;
const defaultCleanlinessRange = "3days";
const addToiletHourDayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const touchCommentComposerQuery = "(hover: none), (pointer: coarse), (max-width: 760px)";
const locationRequestOptions = Object.freeze({
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 60000
});

function shouldAutofocusCommentInput() {
  const matchMedia = globalThis.window?.matchMedia;
  if (typeof matchMedia !== "function") return true;

  return !matchMedia(touchCommentComposerQuery).matches;
}

function getNativeGeolocationPlugin() {
  const capacitor = globalThis.Capacitor;
  const isNativeApp = typeof capacitor?.isNativePlatform === "function" && capacitor.isNativePlatform();

  if (!isNativeApp) return null;
  return capacitor?.Plugins?.Geolocation ?? null;
}

function getNativeLocationPermissionState(permissionResult) {
  return permissionResult?.location ?? permissionResult?.coarseLocation ?? null;
}

async function ensureNativeLocationPermission(geolocationPlugin) {
  if (typeof geolocationPlugin.requestPermissions !== "function") return;

  let currentPermission = null;
  if (typeof geolocationPlugin.checkPermissions === "function") {
    currentPermission = await geolocationPlugin.checkPermissions();
  }

  if (getNativeLocationPermissionState(currentPermission) === "granted") return;

  const nextPermission = await geolocationPlugin.requestPermissions();
  if (getNativeLocationPermissionState(nextPermission) === "denied") {
    throw new Error("Location permission was denied.");
  }
}

async function requestNativeLocationPosition(geolocationPlugin) {
  await ensureNativeLocationPermission(geolocationPlugin);
  return geolocationPlugin.getCurrentPosition(locationRequestOptions);
}

function withStaticAssetVersion(path) {
  if (/[?&]v=/.test(path)) return path;

  const version = String(appConfig.assetVersion ?? "").trim();
  if (!version) return path;

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(version)}`;
}

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
    commentSceneToggle,
    commentSceneStatus,
    overviewVisualPreview,
    overviewVisualImage,
    overviewVisualState,
    visualCleanlinessPreview,
    visualCleanlinessImage,
    visualCleanlinessStars,
    visualRatingChoicePopover,
    visualRatingChoiceTitle,
    visualRatingChoiceButtons = [],
    visualCleanlinessState,
    summarizeCommentsButton,
    aiSummaryContainer,
    aiSummaryText,
    featureFilterInputs = [],
    sortSelect,
    cleanlinessRangeSelect,
    resultsSummary,
    resultsList,
    addToiletPanel,
    addToiletForm,
    addToiletSubmitButton,
    addToiletStatus,
    addToiletLatInput,
    addToiletLngInput,
    addToiletNameInput,
    addToiletAreaInput,
    addToiletNoteInput,
    addToiletFeatureInputs = [],
    addToiletHoursKnownSelect,
    addToiletHoursDays,
    addToiletHourGroups = [],
    locateButtons = []
  } = elements;
  const {
    isAuthenticated = () => true,
    showLoginPrompt = () => {},
    recordAccessHistory = async () => {},
    onPublicProfileSelected = () => {},
    onCleanlinessSaved = async () => {},
    getFeedbackSceneSnapshot = () => null,
    resetFeedbackScene = () => {},
    openFeedbackSceneView = () => {},
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
  let markerIconStateById = new Map();
  let hiddenByMarkerLimit = 0;
  let cleanlinessSurveyAnswers = loadSurveyAnswers();
  let cleanlinessUpdateById = new Map();
  let cleanlinessDisplayRequestId = 0;
  let cleanlinessRangeByToiletId = new Map();
  let currentCleanlinessRange = defaultCleanlinessRange;
  let selectedRating = null;
  let feedbackSubmitAttemptedWithoutRating = false;
  let visualCleanlinessLevel = 0;
  let currentDetailSection = "overview";
  let ratingChoiceTrigger = null;
  let addToiletPickMode = false;
  let addToiletLocation = null;
  let addToiletDraftMarker = null;

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
    const rawValue = Number(level);
    if (rawValue === 0) return 0;

    const value = Math.round(rawValue * 2) / 2;
    return visualCleanlinessLevels.has(value) ? value : 0;
  }

  function getVisualCleanlinessLevel(level = visualCleanlinessLevel) {
    const value = normaliseVisualCleanlinessLevel(level);
    if (value === 0) {
      return {
        value,
        label: "No rating selected",
        tone: "Choose a cleanliness rating",
        image: "",
        fixtureType: "toilet"
      };
    }

    const definition = visualCleanlinessLevels.get(value);
    return {
      value,
      label: definition.label,
      tone: definition.tone,
      image: definition.image ? withStaticAssetVersion(definition.image) : "",
      fixtureType: "toilet"
    };
  }

  function getCleanlinessMarkerTone(value) {
    if (value <= 1.5) return "very-dirty";
    if (value <= 2.5) return "dirty";
    if (value <= 3.5) return "ok";
    if (value <= 4.5) return "clean";
    return "excellent";
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

  function syncSearchPanelState() {
    const isCollapsed = Boolean(searchCard?.classList?.contains?.("is-collapsed"));
    const isExpanded = Boolean(searchCard && !isCollapsed);
    mapPanel?.classList.toggle("has-expanded-search", isExpanded);
    toggleSearchButton?.setAttribute("aria-label", isExpanded ? "Collapse search panel" : "Expand search panel");
  }

  function expandSearchPanel() {
    if (!searchCard) return;
    searchCard.classList.remove("is-collapsed");
    syncSearchPanelState();
  }

  function toggleSearchPanel() {
    if (!searchCard) return;
    searchCard.classList.toggle("is-collapsed");
    syncSearchPanelState();
  }

  function collapseSearchPanel() {
    if (!searchCard) return;
    searchCard.classList.add("is-collapsed");
    syncSearchPanelState();
  }

  syncSearchPanelState();

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

  function updateFeedbackSubmitButton({ submitting = false } = {}) {
    const feedbackSubmitButton = commentForm?.querySelector("button[type='submit']");
    if (!feedbackSubmitButton) return;

    const hasSelectedRating = selectedRating !== null && isValidCleanlinessRating(selectedRating);
    feedbackSubmitButton.disabled = Boolean(submitting);
    feedbackSubmitButton.dataset.ratingRequired = hasSelectedRating ? "false" : "true";
    feedbackSubmitButton.title = hasSelectedRating ? "" : "Choose a star rating before submitting feedback.";
    feedbackSubmitButton.textContent =
      feedbackSubmitAttemptedWithoutRating && !hasSelectedRating ? "Rate stars first" : "Submit feedback";
  }

  function renderCleanlinessSurvey(toilet) {
    const rating = Number(selectedRating);
    const hasRating = isValidCleanlinessRating(rating);

    updateFeedbackSubmitButton();

    if (mapSurveyStatus) {
      if (selectedRating !== null) {
        mapSurveyStatus.classList.remove("warning");
        mapSurveyStatus.textContent = `Selected ${selectedRating}/5 stars. Add details or submit rating only.`;
      } else if (feedbackSubmitAttemptedWithoutRating) {
        mapSurveyStatus.classList.add("warning");
        mapSurveyStatus.textContent = "Choose a star rating before submitting feedback.";
      } else {
        mapSurveyStatus.classList.remove("warning");
        mapSurveyStatus.textContent = isAuthenticated()
          ? "Tap a star, then choose half or full."
          : "Log in or sign up to leave feedback.";
      }
    }

    setVisualCleanlinessLevel(hasRating ? rating : 0);
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
    const isUnrated = selectedLevel === 0;
    visualCleanlinessStars?.setAttribute(
      "aria-label",
      isUnrated
        ? "No cleanliness rating selected. Tap a star to choose a half-star or full-star rating."
        : `Toilet visual cleanliness rating ${selectedLevel} out of 5`
    );
    visualCleanlinessStars?.classList?.toggle("is-unrated", isUnrated);

    visualCleanlinessStars?.querySelectorAll?.("[data-visual-star]")?.forEach((button) => {
      const star = Number(button.dataset.visualStar);
      const fill = isUnrated ? 50 : selectedLevel >= star ? 100 : selectedLevel >= star - 0.5 ? 50 : 0;
      button.style?.setProperty?.("--star-fill", `${fill}%`);
      button.classList.toggle("is-selected", !isUnrated && fill > 0);
      button.setAttribute("aria-pressed", !isUnrated && fill > 0 ? "true" : "false");
    });

  }

  function formatRatingChoiceLabel(rating) {
    const value = Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
    return `${value} ${rating === 1 ? "star" : "stars"}`;
  }

  function closeCleanlinessRatingChoices({ restoreFocus = false } = {}) {
    const trigger = ratingChoiceTrigger;
    ratingChoiceTrigger = null;

    if (visualRatingChoicePopover) {
      visualRatingChoicePopover.hidden = true;
      visualRatingChoicePopover.classList.add("is-hidden");
    }

    visualCleanlinessStars?.classList?.remove("is-choosing");
    visualCleanlinessStars?.querySelectorAll?.("[data-visual-star]")?.forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });

    if (restoreFocus) {
      trigger?.focus?.({ preventScroll: true });
    }
  }

  function openCleanlinessRatingChoices(star, triggerButton = null) {
    if (!selectedToilet) {
      setStatus("Select a toilet marker before leaving feedback.");
      return;
    }

    const safeStar = Number(star);
    if (!Number.isInteger(safeStar) || safeStar < 1 || safeStar > 5) return;

    const starButton =
      triggerButton ?? visualCleanlinessStars?.querySelector?.(`[data-visual-star="${safeStar}"]`) ?? null;
    const halfRating = safeStar - 0.5;
    const fullRating = safeStar;
    ratingChoiceTrigger = starButton;

    visualRatingChoiceButtons.forEach((button) => {
      const rating = button.dataset.visualRatingChoice === "half" ? halfRating : fullRating;
      const label = formatRatingChoiceLabel(rating);
      button.dataset.visualRating = String(rating);
      button.setAttribute("aria-label", `Select ${label}`);
      button.classList.toggle("is-selected", rating === selectedRating);
      const value = button.querySelector?.("[data-rating-choice-value]");
      if (value) value.textContent = label;
    });

    if (visualRatingChoiceTitle) {
      visualRatingChoiceTitle.textContent = `Choose ${formatRatingChoiceLabel(halfRating)} or ${formatRatingChoiceLabel(fullRating)}`;
    }
    if (visualRatingChoicePopover) {
      visualRatingChoicePopover.hidden = false;
      visualRatingChoicePopover.classList.remove("is-hidden");
    }

    visualCleanlinessStars?.classList?.add("is-choosing");
    visualCleanlinessStars?.querySelectorAll?.("[data-visual-star]")?.forEach((button) => {
      button.setAttribute("aria-expanded", button === starButton ? "true" : "false");
    });

    globalThis.requestAnimationFrame?.(() => {
      visualRatingChoiceButtons[0]?.focus?.({ preventScroll: true });
    });
  }

  function resetVisualCleanlinessRating() {
    setVisualCleanlinessLevel(0);
  }

  function getCommentVisibility() {
    return commentAnonymousInput?.checked ? "anonymous" : "real";
  }

  function refreshFeedbackSceneStatus() {
    const hasScene = Boolean(getFeedbackSceneSnapshot());
    if (commentSceneToggle) {
      commentSceneToggle.textContent = hasScene ? "Edit interactive scene" : "Add interactive scene";
    }

    if (commentSceneStatus) {
      commentSceneStatus.textContent = hasScene
        ? "Interactive scene will be attached to this feedback."
        : "Optional scene for this feedback.";
    }
  }

  function openFeedbackScene() {
    if (!selectedToilet) return;

    if (!commentComposer || commentComposer.hidden) {
      setCommentComposerOpen(true);
    }

    refreshFeedbackSceneStatus();
    openFeedbackSceneView();
  }

  function setCommentComposerOpen(open) {
    const shouldOpen = Boolean(open && selectedToilet && commentComposer);

    if (!shouldOpen) {
      closeCleanlinessRatingChoices();
    }

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
      selectedRating = null;
      feedbackSubmitAttemptedWithoutRating = false;
      renderCleanlinessSurvey(selectedToilet);
      refreshFeedbackSceneStatus();
      if (shouldAutofocusCommentInput()) {
        requestAnimationFrame(() => commentInput?.focus());
      }
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

  function toggleFeedbackScene() {
    openFeedbackScene();
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
    const level = getVisualCleanlinessLevel(getCleanlinessVisualLevel(toilet));
    const markerTone = getCleanlinessMarkerTone(level.value);
    classes.push(`map-marker-cleanliness-${markerTone}`);
    if (selected) classes.push("is-selected");

    return window.L.divIcon({
      className: "map-marker-icon",
      html: `<span class="${classes.join(" ")}" aria-hidden="true"><img class="map-marker-image" src="${level.image}" alt="" loading="lazy" /></span>`,
      iconSize: [44, 58],
      iconAnchor: [22, 58]
    });
  }

  function getToiletIconState(toilet, selected = false) {
    const level = getVisualCleanlinessLevel(getCleanlinessVisualLevel(toilet));
    const markerTone = getCleanlinessMarkerTone(level.value);
    return `${selected ? "selected" : "default"}|${level.image}|${markerTone}`;
  }

  function removeMapMarker(marker) {
    if (typeof marker?.remove === "function") {
      marker.remove();
      return;
    }

    markersLayer?.removeLayer?.(marker);
  }

  function syncToiletMarkerIcon(marker, toilet, selected = false) {
    const iconState = getToiletIconState(toilet, selected);
    if (markerIconStateById.get(toilet.id) === iconState) return;

    marker.setIcon(createToiletIcon(toilet, selected));
    markerIconStateById.set(toilet.id, iconState);
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
      syncToiletMarkerIcon(marker, toilet, selectedToilet?.id === id);
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
    feedbackSubmitAttemptedWithoutRating = false;
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
      const normalisedValue = String(value ?? "?").trim().toUpperCase();
      const displayValue = normalisedValue === "Y" ? "✓" : normalisedValue === "N" ? "✕" : "?";
      element.textContent = displayValue;
      element.setAttribute?.("aria-label", displayValue === "✓" ? "Yes" : displayValue === "✕" ? "No" : "Unknown");
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
          toilet = mergeToiletDetailWithoutCleanliness(toilet, fullDetails);
          allToilets = allToilets.map(t => t.id === toiletId ? toilet : t);
        }
      } catch (error) {
        console.warn("Failed to fetch toilet details from API:", error);
      }
    }

    selectedToilet = toilet;
    selectedCleanlinessDisplayToilet = toilet;
    selectedRating = null;
    feedbackSubmitAttemptedWithoutRating = false;
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
      markerById.forEach(removeMapMarker);
      markerById = new Map();
      markerIconStateById = new Map();
      renderUserMarker();
      return;
    }

    const inBoundsToilets = getMapVisibleToilets();
    hiddenByMarkerLimit = Math.max(0, inBoundsToilets.length - appConfig.markerRenderLimit);
    const nextVisibleToilets = inBoundsToilets.slice(0, appConfig.markerRenderLimit);
    const nextVisibleById = new Map(nextVisibleToilets.map((toilet) => [toilet.id, toilet]));
    const nextMarkerById = new Map();

    markerById.forEach((marker, id) => {
      if (!nextVisibleById.has(id)) {
        removeMapMarker(marker);
        markerIconStateById.delete(id);
      }
    });

    nextVisibleToilets.forEach((toilet) => {
      const selected = selectedToilet?.id === toilet.id;
      const title = `${toilet.name}, ${toilet.area}`;
      const existingMarker = markerById.get(toilet.id);

      if (existingMarker) {
        existingMarker.setLatLng?.([toilet.lat, toilet.lng]);
        if (existingMarker.options) {
          existingMarker.options.title = title;
        }
        syncToiletMarkerIcon(existingMarker, toilet, selected);
        nextMarkerById.set(toilet.id, existingMarker);
        return;
      }

      const marker = window.L.marker([toilet.lat, toilet.lng], {
        icon: createToiletIcon(toilet, selectedToilet?.id === toilet.id),
        keyboard: true,
        title
      });

      marker.on("click", async () => await setToilet(toilet.id));
      marker.addTo(markersLayer);
      markerById.set(toilet.id, marker);
      markerIconStateById.set(toilet.id, getToiletIconState(toilet, selected));
      nextMarkerById.set(toilet.id, marker);
    });

    visibleToilets = nextVisibleToilets;
    markerById = nextMarkerById;
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

  function handleLocationFound(position) {
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
  }

  function handleLocationUnavailable(error) {
    if (error) {
      console.warn("Location request failed:", error);
    }
    updateLocateButtonStateFromMap();
    setStatus("Location permission was denied or unavailable.");
  }

  function requestLocation() {
    const nativeGeolocation = getNativeGeolocationPlugin();

    setStatus("Requesting location permission...");

    if (nativeGeolocation && typeof nativeGeolocation.getCurrentPosition === "function") {
      requestNativeLocationPosition(nativeGeolocation)
        .then(handleLocationFound)
        .catch(handleLocationUnavailable);
      return;
    }

    if (!navigator.geolocation) {
      setLocateButtonState(false);
      setStatus("Your browser does not support location.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      handleLocationFound,
      handleLocationUnavailable,
      locationRequestOptions
    );
  }

  async function openExternalUrl(url) {
    const capacitor = globalThis.Capacitor;
    const browserPlugin = capacitor?.Plugins?.Browser;
    const isNativeApp = typeof capacitor?.isNativePlatform === "function" && capacitor.isNativePlatform();

    if (isNativeApp && typeof browserPlugin?.open === "function") {
      try {
        await browserPlugin.open({ url });
        return;
      } catch (error) {
        console.error("Failed to open native browser:", error);
      }
    }

    window.open(url, "_blank", "noopener,noreferrer");
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
    void openExternalUrl(url);
  }

  function setAddToiletStatus(message, { warning = false } = {}) {
    if (!addToiletStatus) return;
    addToiletStatus.textContent = message;
    addToiletStatus.classList?.toggle?.("warning", warning);
  }

  function syncAddToiletSubmitState({ submitting = false } = {}) {
    if (!addToiletSubmitButton) return;
    addToiletSubmitButton.disabled = Boolean(submitting || !addToiletLocation);
    addToiletSubmitButton.textContent = submitting ? "Adding..." : "Add toilet";
  }

  function syncAddToiletHoursVisibility() {
    const hasKnownHours = addToiletHoursKnownSelect?.value === "known";
    if (addToiletHoursDays) {
      addToiletHoursDays.hidden = !hasKnownHours;
    }

    Array.from(addToiletHourGroups).forEach((group) => {
      const stateSelect = group?.querySelector?.("[data-add-hours-state]");
      const timesContainer = group?.querySelector?.("[data-add-hours-times]");
      const openInput = group?.querySelector?.("[data-add-hours-open]");
      const closeInput = group?.querySelector?.("[data-add-hours-close]");
      const isOpen = hasKnownHours && stateSelect?.value === "open";

      if (timesContainer) {
        timesContainer.hidden = !isOpen;
      }

      group?.classList?.toggle?.("is-open", isOpen);

      [openInput, closeInput].forEach((input) => {
        if (!input) return;
        input.disabled = !isOpen;
        input.required = isOpen;
        if (!isOpen) {
          input.value = "";
        }
      });
    });
  }

  function setAddToiletPickMode(enabled) {
    addToiletPickMode = Boolean(enabled);
    mapPanel?.classList?.toggle?.("is-picking-add-toilet", addToiletPickMode);
    addToiletPanel?.classList?.toggle?.("is-picking-location", addToiletPickMode);

    if (addToiletPickMode) {
      setAddToiletStatus("Tap an empty place on the map. This form will reopen after you choose a spot.");
    }
  }

  function removeAddToiletDraftMarker() {
    if (!addToiletDraftMarker) return;
    removeMapMarker(addToiletDraftMarker);
    addToiletDraftMarker = null;
  }

  function renderAddToiletDraftMarker() {
    if (!map || !addToiletLocation) {
      removeAddToiletDraftMarker();
      return;
    }

    const latLng = [addToiletLocation.lat, addToiletLocation.lng];
    if (addToiletDraftMarker) {
      addToiletDraftMarker.setLatLng?.(latLng);
      return;
    }

    addToiletDraftMarker = window.L.marker(latLng, {
      icon: window.L.divIcon({
        className: "map-add-marker-icon",
        html: '<span class="map-add-marker" aria-hidden="true"></span>',
        iconSize: [32, 42],
        iconAnchor: [16, 42]
      }),
      keyboard: false
    }).addTo(map);
  }

  function resetAddToiletForm() {
    addToiletForm?.reset?.();
    addToiletLocation = null;
    if (addToiletLatInput) addToiletLatInput.value = "";
    if (addToiletLngInput) addToiletLngInput.value = "";
    syncAddToiletHoursVisibility();
    setAddToiletPickMode(false);
    removeAddToiletDraftMarker();
    setAddToiletStatus("Pick an empty map location.");
    syncAddToiletSubmitState();
  }

  function setAddToiletPanelOpen(open) {
    const shouldOpen = Boolean(open && addToiletPanel);

    if (addToiletPanel) {
      addToiletPanel.hidden = !shouldOpen;
      addToiletPanel.classList.toggle("is-hidden", !shouldOpen);
    }

    mapPanel?.classList.toggle("has-add-toilet-panel", shouldOpen);
    if (!shouldOpen) {
      resetAddToiletForm();
    } else {
      setAddToiletStatus("Pick an empty map location.");
      syncAddToiletHoursVisibility();
      syncAddToiletSubmitState();
      const scheduleFrame = globalThis.requestAnimationFrame ?? ((callback) => callback());
      scheduleFrame(() => {
        if (!addToiletPickMode) {
          addToiletNameInput?.focus?.({ preventScroll: true });
        }
      });
    }
  }

  function openAddToiletPanel() {
    if (!isAuthenticated()) {
      showLoginPrompt("Log in to add a missing toilet.");
      return;
    }

    setAddToiletPanelOpen(true);
    setAddToiletPickMode(true);
    collapseSearchPanel();
  }

  function closeAddToiletPanel() {
    setAddToiletPanelOpen(false);
  }

  function getClosestExistingToilet(lat, lng) {
    return allToilets.reduce((closest, toilet) => {
      const distanceMetres = distanceInMetres(lat, lng, toilet.lat, toilet.lng);
      if (distanceMetres > duplicateToiletRadiusMetres) return closest;
      if (closest && closest.distanceMetres <= distanceMetres) return closest;
      return { toilet, distanceMetres };
    }, null);
  }

  function selectAddToiletLocation(lat, lng) {
    const safeLat = Number(lat);
    const safeLng = Number(lng);
    if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) {
      setAddToiletStatus("Choose a valid map location.", { warning: true });
      return false;
    }

    const duplicate = getClosestExistingToilet(safeLat, safeLng);
    if (duplicate) {
      const distance = Math.round(duplicate.distanceMetres);
      setAddToiletStatus(`${duplicate.toilet.name} is already on the map (${distance}m away).`, {
        warning: true
      });
      setStatus("That toilet is already on the map.");
      void setToilet(duplicate.toilet.id);
      return false;
    }

    addToiletLocation = { lat: safeLat, lng: safeLng };
    if (addToiletLatInput) addToiletLatInput.value = safeLat.toFixed(6);
    if (addToiletLngInput) addToiletLngInput.value = safeLng.toFixed(6);
    setAddToiletStatus(`Location selected: ${safeLat.toFixed(5)}, ${safeLng.toFixed(5)}.`);
    setAddToiletPickMode(false);
    renderAddToiletDraftMarker();
    syncAddToiletSubmitState();
    return true;
  }

  function selectAddToiletMapLocation(event) {
    if (!addToiletPickMode) return;
    const latLng = event?.latlng;
    selectAddToiletLocation(latLng?.lat, latLng?.lng);
  }

  function readAddToiletHourSlot(group) {
    const state = group?.querySelector?.("[data-add-hours-state]")?.value ?? "unknown";
    const open = group?.querySelector?.("[data-add-hours-open]")?.value ?? "";
    const close = group?.querySelector?.("[data-add-hours-close]")?.value ?? "";

    if (state === "unknown") return null;
    if (state === "closed") return [];
    if (state !== "open") return null;

    if (!open || !close) {
      throw new Error("Enter both open and close times, or choose Unknown or Closed for that day.");
    }

    return [open, close];
  }

  function getAddToiletOpeningTimes() {
    if (addToiletHoursKnownSelect?.value !== "known") {
      return addToiletHourDayKeys.map(() => null);
    }

    const groups = new Map(
      Array.from(addToiletHourGroups).map((group) => [group.dataset.addHours, group])
    );

    return addToiletHourDayKeys.map((dayKey) => readAddToiletHourSlot(groups.get(dayKey)));
  }

  function getAddToiletFeatures() {
    return Array.from(addToiletFeatureInputs).reduce((features, input) => {
      const key = input.dataset.addToiletFeature;
      if (key) {
        features[key] = input.value || "?";
      }
      return features;
    }, {});
  }

  function getAddToiletPayload() {
    const lat = Number(addToiletLatInput?.value);
    const lng = Number(addToiletLngInput?.value);
    const name = addToiletNameInput?.value?.trim() ?? "";

    if (!addToiletLocation || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("Pick a map location first.");
    }

    if (!name) {
      throw new Error("Name is required.");
    }

    const duplicate = getClosestExistingToilet(lat, lng);
    if (duplicate) {
      throw new Error(`${duplicate.toilet.name} is already on the map.`);
    }

    return {
      name,
      area: addToiletAreaInput?.value?.trim() ?? "",
      comment: addToiletNoteInput?.value?.trim() ?? "",
      lat,
      lng,
      features: getAddToiletFeatures(),
      openingTimes: getAddToiletOpeningTimes()
    };
  }

  async function submitAddToilet(event) {
    event?.preventDefault?.();

    if (!isAuthenticated()) {
      showLoginPrompt("Log in to add a missing toilet.");
      return false;
    }

    let payload;
    try {
      payload = getAddToiletPayload();
    } catch (error) {
      setAddToiletStatus(error.message, { warning: true });
      return false;
    }

    syncAddToiletSubmitState({ submitting: true });
    setAddToiletStatus("Adding toilet...");

    try {
      const toilet = await submitToiletContribution(payload);
      if (!toilet?.id) {
        throw new Error("Could not add toilet.");
      }

      setToilets([toilet], {
        hideDetails: false,
        cleanlinessRange: "all",
        merge: true
      });
      closeAddToiletPanel();
      await setToilet(toilet.id);
      setStatus(`${toilet.name} was added to the map.`);
      return true;
    } catch (error) {
      console.error("Failed to add toilet:", error);
      if (error.status === 401) {
        showLoginPrompt("Log in to add a missing toilet.");
        return false;
      }

      setAddToiletStatus(error.message || "Could not add toilet.", {
        warning: true
      });
      return false;
    } finally {
      syncAddToiletSubmitState();
    }
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
    map.on("click", selectAddToiletMapLocation);

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
    closeCleanlinessRatingChoices();
    feedbackSubmitAttemptedWithoutRating = false;
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

    clearToiletDetailCache(result.toilet.id);

    updateToiletCleanliness(result.toilet, {
      store: true,
      cleanlinessRange: "all"
    });

    const toiletUpdate = createCurrentRangeCleanlinessUpdate(result.toilet, rating);
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
      feedbackSubmitAttemptedWithoutRating = true;
      updateFeedbackSubmitButton();
      if (mapSurveyStatus) {
        mapSurveyStatus.classList.add("warning");
        mapSurveyStatus.textContent = "Choose a rating before submitting feedback.";
      }
      return;
    }

    const commentText = commentInput.value.trim();
    const hasCommentText = commentText.length > 0;
    const sceneSnapshot = getFeedbackSceneSnapshot();
    const hasScene = Boolean(sceneSnapshot);

    if (!isAuthenticated()) {
      showLoginPrompt("Log in to leave feedback.");
      return;
    }

    const submitButton = commentForm?.querySelector("button[type='submit']");
    updateFeedbackSubmitButton({ submitting: true });

    try {
      if (!hasCommentText && !hasScene) {
        const saved = await answerCleanlinessSurvey(feedbackRating);
        if (saved) {
          selectedRating = null;
          feedbackSubmitAttemptedWithoutRating = false;
          closeCommentComposer();
          renderCleanlinessSurvey(selectedToilet);
        }
        return;
      }

      const commentVisibility = getCommentVisibility();
      const result = await submitComment(
        selectedToilet.id,
        commentText,
        commentVisibility,
        feedbackRating,
        sceneSnapshot
      );
      await applySavedCleanlinessResult(result, feedbackRating);
      feedbackThreadController.renderComments(result.comments);
      commentInput.value = "";
      selectedRating = null;
      feedbackSubmitAttemptedWithoutRating = false;
      resetFeedbackScene();
      refreshFeedbackSceneStatus();
      closeCommentComposer();
      renderCleanlinessSurvey(selectedToilet);
    } catch (error) {
      console.error("Failed to submit feedback:", error);
      if (error.status === 401) {
        showLoginPrompt("Log in to leave feedback.");
        return;
      }
      if (error.status === 429) {
        if (mapSurveyStatus) {
          mapSurveyStatus.classList.add("warning");
          mapSurveyStatus.textContent = error.message || "Please wait before rating this toilet again.";
        }
        return;
      }
      alert(error?.message || "Could not submit feedback. Please try again later.");
    } finally {
      if (submitButton) {
        updateFeedbackSubmitButton();
      }
    }
  }

  return {
    createInteractiveMap,
    setStatus,
    expandSearchPanel,
    toggleSearchPanel,
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
    openCleanlinessRatingChoices,
    closeCleanlinessRatingChoices,
    selectCleanlinessRating,
    answerCleanlinessSurvey,
    postComment,
    getAiSummary,
    setCommentSortMode: feedbackThreadController.setCommentSortMode,
    setCommentFilter: feedbackThreadController.setCommentFilter,
    toggleCommentComposer,
    toggleFeedbackScene,
    refreshFeedbackSceneStatus,
    closeCommentComposer,
    setVisualCleanlinessLevel,
    applyCommentPreset,
    applyProfilePreferences,
    openAddToiletPanel,
    closeAddToiletPanel,
    syncAddToiletHoursVisibility,
    submitAddToilet
  };
}
