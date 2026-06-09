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
    mapSurveyRatingButtons = [],
    mapSurveyStatus,
    submitCleanlinessSurveyButton,
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
    visualFeedbackToggle,
    visualFeedbackPanel,
    overviewUrinalPanel,
    overviewVisualPreview,
    overviewVisualImage,
    overviewUrinalPreview,
    overviewUrinalImage,
    overviewVisualState,
    overviewUrinalState,
    visualCleanlinessPreview,
    visualCleanlinessImage,
    visualCleanlinessSlider,
    visualCleanlinessState,
    visualFeedbackSubtitle,
    visualFeedbackForm,
    visualFeedbackComment,
    visualFeedbackList,
    visualFeedbackSummary,
    summarizeCommentsButton,
    aiSummaryContainer,
    aiSummaryText,
    featureFilterInputs = [],
    sortSelect,
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
  const visualFeedbackStorageKey = "wheretoi-visual-cleanliness-feedback";
  const visualCleanlinessLevels = new Map([
    [0.5, { label: "Extremely dirty", tone: "Avoid at all costs", images: { toilet: "toilet_levels/level_05_small.jpg", urinal: "toilet_levels/level_05_urinal.png" } }],
    [1, { label: "Very dirty", tone: "Needs a serious clean", images: { toilet: "toilet_levels/level_1_small.jpg", urinal: "toilet_levels/level_1_urinal.png" } }],
    [1.5, { label: "Dirty & Messy", tone: "Quite unpleasant", images: { toilet: "toilet_levels/level_15_small.jpg", urinal: "toilet_levels/level_15_urinal.png" } }],
    [2, { label: "Dirty", tone: "Use only if needed", images: { toilet: "toilet_levels/level_2_small.jpg", urinal: "toilet_levels/level_2_urinal.png" } }],
    [2.5, { label: "Below average", tone: "Could be better", images: { toilet: "toilet_levels/level_25_small.jpg", urinal: "toilet_levels/level_25_urinal.png" } }],
    [3, { label: "OK", tone: "Usable but not spotless", images: { toilet: "toilet_levels/level_3_small.jpg", urinal: "toilet_levels/level_3_urinal.png" } }],
    [3.5, { label: "Above average", tone: "Decent condition", images: { toilet: "toilet_levels/level_35_small.jpg", urinal: "toilet_levels/level_35_urinal.png" } }],
    [4, { label: "Clean", tone: "Comfortable to use", images: { toilet: "toilet_levels/level_4_small.jpg", urinal: "toilet_levels/level_4_urinal.png" } }],
    [4.5, { label: "Very clean", tone: "Almost spotless", images: { toilet: "toilet_levels/level_45_small.jpg", urinal: "toilet_levels/level_45_urinal.png" } }],
    [5, { label: "Excellent", tone: "Fresh and well kept", images: { toilet: "toilet_levels/level_5_small.jpg", urinal: "toilet_levels/level_5_urinal.png" } }]
  ]);

  let allToilets = [];
  let filteredToilets = [];
  let visibleToilets = [];
  let selectedToilet = null;
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
  let currentCleanlinessRange = defaultCleanlinessRange;
  let selectedRating = null;
  let selectedCommentMedia = [];
  let visualCleanlinessLevel = 3;
  let visualFeedbackFixtureType = null;
  let visualFeedbackEntriesByToiletId = loadVisualFeedbackEntries();
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

  function isUrinalOnlyToilet(toilet = selectedToilet) {
    return hasEnabledFeature(toilet?.features?.urinalOnly);
  }

  function getVisualFixtureType(toilet = selectedToilet) {
    return isUrinalOnlyToilet(toilet) ? "urinal" : "toilet";
  }

  function normaliseVisualFixtureType(fixtureType) {
    return fixtureType === "urinal" || fixtureType === "toilet" ? fixtureType : null;
  }

  function getActiveVisualFeedbackFixtureType() {
    return normaliseVisualFixtureType(visualFeedbackFixtureType) || getVisualFixtureType();
  }

  function getVisualFixtureLabel(fixture = selectedToilet) {
    if (fixture === "urinal" || fixture === "toilet") {
      return fixture === "urinal" ? "Urinal" : "Toilet";
    }

    return getVisualFixtureType(fixture) === "urinal" ? "Urinal" : "Toilet";
  }

  function supportsOverviewUrinalPreview(toilet = selectedToilet) {
    return hasEnabledFeature(toilet?.features?.urinalOnly) || hasEnabledFeature(toilet?.features?.men);
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

  function getVisualCleanlinessLevel(level = visualCleanlinessLevel, fixtureType = getActiveVisualFeedbackFixtureType()) {
    const value = normaliseVisualCleanlinessLevel(level);
    const definition = visualCleanlinessLevels.get(value);
    const safeFixtureType = fixtureType === "urinal" ? "urinal" : "toilet";
    return {
      value,
      label: definition.label,
      tone: definition.tone,
      image: definition.images?.[safeFixtureType] || definition.images?.toilet || "",
      fixtureType: safeFixtureType
    };
  }

  function loadVisualFeedbackEntries() {
    try {
      const storedFeedback = window.localStorage?.getItem(visualFeedbackStorageKey);
      if (!storedFeedback) return {};

      const parsedFeedback = JSON.parse(storedFeedback);
      if (!parsedFeedback || typeof parsedFeedback !== "object" || Array.isArray(parsedFeedback)) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(parsedFeedback)
          .filter(([, entries]) => Array.isArray(entries))
          .map(([toiletId, entries]) => [
            toiletId,
            entries
              .filter((entry) => entry && typeof entry === "object")
              .map((entry) => ({
                id: String(entry.id || `visual-${Date.now()}`),
                level: normaliseVisualCleanlinessLevel(entry.level),
                label: String(entry.label || getVisualCleanlinessLevel(entry.level).label),
                tone: String(entry.tone || getVisualCleanlinessLevel(entry.level).tone),
                image: String(entry.image || ""),
                comment: String(entry.comment || ""),
                createdAt: String(entry.createdAt || new Date().toISOString())
              }))
          ])
      );
    } catch {
      return {};
    }
  }

  function saveVisualFeedbackEntries() {
    try {
      window.localStorage?.setItem(visualFeedbackStorageKey, JSON.stringify(visualFeedbackEntriesByToiletId));
    } catch {
      // The visual prototype still works for the current session if storage is blocked.
    }
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

  function renderCleanlinessSurvey(toilet) {
    const stored = toilet ? cleanlinessSurveyAnswers[toilet.id] : null;
    const storedRating = stored && typeof stored === "object" ? stored.rating : stored;
    const submittedAt = stored?.submittedAt ? new Date(stored.submittedAt).getTime() : null;
    const now = Date.now();
    const isWithinCooldown = submittedAt && now - submittedAt < 30 * 60 * 1000;

    const rating = Number(selectedRating ?? storedRating);
    const hasRating = Number.isInteger(rating) && rating >= 1 && rating <= 5;

    mapSurveyRatingButtons.forEach((button) => {
      const buttonRating = Number(button.dataset.surveyRating);
      const isSelected = hasRating && buttonRating <= rating;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", hasRating && buttonRating === rating ? "true" : "false");
    });

    const feedbackSubmitButton = commentForm?.querySelector("button[type='submit']");
    if (submitCleanlinessSurveyButton) {
      submitCleanlinessSurveyButton.disabled = selectedRating === null;
    }
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
            ? "Choose 1 to 5 stars to continue."
            : "Log in or sign up to leave feedback.";
      }
    }
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
        `Cartoon ${level.fixtureType} cleanliness preview: ${level.label}`
      );

      const toiletSvg = preview.querySelector(".cartoon-toilet-svg");
      const urinalSvg = preview.querySelector(".cartoon-urinal-svg");
      const fallbackGraphic = level.fixtureType === "urinal" ? urinalSvg : toiletSvg;
      const shouldShowImage = Boolean(showImage && image && level.image);

      if (toiletSvg) {
        toiletSvg.classList.toggle("is-hidden", level.fixtureType !== "toilet" || shouldShowImage);
      }

      if (urinalSvg) {
        urinalSvg.classList.toggle("is-hidden", level.fixtureType !== "urinal" || shouldShowImage);
      }

      if (image) {
        image.classList.toggle("is-urinal", level.fixtureType === "urinal");
        image.alt = `${getVisualFixtureLabel(level.fixtureType)} cleanliness preview: ${level.label}`;
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

  function updateVisualCleanlinessPreview() {
    const level = getVisualCleanlinessLevel();
    const toiletLevel = getVisualCleanlinessLevel(visualCleanlinessLevel, "toilet");
    const shouldShowOverviewUrinal = supportsOverviewUrinalPreview();

    if (visualFeedbackSubtitle) {
      visualFeedbackSubtitle.textContent = `Match the ${level.fixtureType} picture to what you saw.`;
    }

    renderVisualPreview(overviewVisualPreview, null, toiletLevel, {
      image: overviewVisualImage,
      showImage: true
    });

    if (overviewUrinalPanel) {
      overviewUrinalPanel.hidden = !shouldShowOverviewUrinal;
      overviewUrinalPanel.classList.toggle("is-hidden", !shouldShowOverviewUrinal);
    }

    renderVisualPreview(overviewUrinalPreview, null, getVisualCleanlinessLevel(visualCleanlinessLevel, "urinal"), {
      image: overviewUrinalImage,
      showImage: shouldShowOverviewUrinal
    });

    if (overviewVisualState) {
      overviewVisualState.textContent = `${toiletLevel.label} - ${toiletLevel.tone}`;
    }

    if (overviewUrinalState) {
      const urinalLevel = getVisualCleanlinessLevel(visualCleanlinessLevel, "urinal");
      overviewUrinalState.textContent = `${urinalLevel.label} - ${urinalLevel.tone}`;
    }

    renderVisualPreview(visualCleanlinessPreview, visualCleanlinessState, level, {
      image: visualCleanlinessImage,
      showImage: true
    });

    if (visualCleanlinessSlider) {
      visualCleanlinessSlider.value = String(level.value);
    }
  }

  function setVisualCleanlinessLevel(level) {
    visualCleanlinessLevel = normaliseVisualCleanlinessLevel(level);
    updateVisualCleanlinessPreview();
  }

  function getVisualFeedbackEntries(toiletId = selectedToilet?.id) {
    if (!toiletId) return [];
    const entries = visualFeedbackEntriesByToiletId[toiletId];
    return Array.isArray(entries) ? entries : [];
  }

  function createVisualFeedbackFallbackThumbnail(level) {
    const thumbnail = document.createElement("span");
    thumbnail.className = "visual-feedback-thumbnail";
    thumbnail.dataset.cleanliness = String(normaliseVisualCleanlinessLevel(level));
    thumbnail.setAttribute("aria-hidden", "true");

    const tank = document.createElement("span");
    tank.className = "visual-thumbnail-tank";

    const bowl = document.createElement("span");
    bowl.className = "visual-thumbnail-bowl";

    const dirt = document.createElement("span");
    dirt.className = "visual-thumbnail-dirt";

    thumbnail.append(tank, bowl, dirt);
    return thumbnail;
  }

  function createVisualFeedbackImage(entry) {
    const imageSource = entry.image || getVisualCleanlinessLevel(entry.level).image;
    if (!imageSource) {
      return createVisualFeedbackFallbackThumbnail(entry.level);
    }

    const frame = document.createElement("div");
    frame.className = "visual-feedback-image-frame";
    frame.dataset.cleanliness = String(normaliseVisualCleanlinessLevel(entry.level));

    const image = document.createElement("img");
    image.className = "visual-feedback-image";
    image.src = imageSource;
    image.alt = `${entry.label} visual cleanliness check`;
    image.loading = "lazy";

    frame.append(image);
    return frame;
  }

  function renderVisualFeedbackDiscussion() {
    const entries = getVisualFeedbackEntries();

    if (visualFeedbackSummary) {
      const countText = entries.length === 1 ? "1 visual check" : `${entries.length} visual checks`;
      visualFeedbackSummary.textContent = countText;
    }

    if (!visualFeedbackList) return;
    visualFeedbackList.replaceChildren();

    if (!selectedToilet) {
      const empty = document.createElement("p");
      empty.textContent = "Select a toilet to see visual checks.";
      visualFeedbackList.append(empty);
      return;
    }

    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No visual checks yet.";
      visualFeedbackList.append(empty);
      return;
    }

    entries.forEach((entry) => {
      const item = document.createElement("article");
      item.className = "visual-feedback-item";

      const thumbnail = createVisualFeedbackImage(entry);

      const body = document.createElement("div");
      body.className = "visual-feedback-item-body";

      const title = document.createElement("strong");
      title.textContent = entry.label;

      const tone = document.createElement("p");
      tone.className = "visual-feedback-tone";
      tone.textContent = entry.tone;

      const comment = document.createElement("p");
      comment.className = "visual-feedback-comment";
      comment.textContent = entry.comment || "Picture-only check.";

      const date = document.createElement("p");
      date.className = "visual-feedback-date";
      date.textContent = new Date(entry.createdAt).toLocaleString();

      body.append(title, tone, comment, date);
      item.append(thumbnail, body);
      visualFeedbackList.append(item);
    });
  }

  function resetVisualFeedbackForm() {
    setVisualCleanlinessLevel(3);
    if (visualFeedbackComment) {
      visualFeedbackComment.value = "";
    }
  }

  function submitVisualFeedback(event) {
    event.preventDefault();

    if (!selectedToilet) {
      setStatus("Select a toilet marker before leaving visual feedback.");
      return;
    }

    const level = getVisualCleanlinessLevel();
    const entry = {
      id: `visual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      level: level.value,
      label: level.label,
      tone: level.tone,
      image: level.image || "",
      comment: visualFeedbackComment?.value.trim() ?? "",
      createdAt: new Date().toISOString()
    };

    const currentEntries = getVisualFeedbackEntries(selectedToilet.id);
    visualFeedbackEntriesByToiletId = {
      ...visualFeedbackEntriesByToiletId,
      [selectedToilet.id]: [entry, ...currentEntries].slice(0, 20)
    };

    saveVisualFeedbackEntries();
    resetVisualFeedbackForm();
    renderVisualFeedbackDiscussion();
    closeVisualFeedback();
    setDetailSection("visual");
    requestAnimationFrame(() => {
      visualFeedbackList?.closest(".visual-feedback-discussion")?.scrollIntoView({
        block: "start",
        behavior: "smooth"
      });
    });
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
      setVisualFeedbackOpen(false);
      renderCleanlinessSurvey(selectedToilet);
      requestAnimationFrame(() => commentInput?.focus());
    }
  }

  function setVisualFeedbackOpen(open, fixtureType = null) {
    const shouldOpen = Boolean(open && selectedToilet && visualFeedbackPanel);
    const nextFixtureType = normaliseVisualFixtureType(fixtureType);

    if (nextFixtureType) {
      visualFeedbackFixtureType = nextFixtureType;
    } else if (shouldOpen && !visualFeedbackFixtureType) {
      visualFeedbackFixtureType = getVisualFixtureType();
    }

    if (visualFeedbackPanel) {
      visualFeedbackPanel.hidden = !shouldOpen;
      visualFeedbackPanel.classList.toggle("is-hidden", !shouldOpen);
    }

    if (visualFeedbackToggle) {
      visualFeedbackToggle.classList.toggle("is-active", shouldOpen);
      visualFeedbackToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    }

    mapPanel?.classList.toggle("has-visual-feedback", shouldOpen);

    if (shouldOpen) {
      setCommentComposerOpen(false);
      updateVisualCleanlinessPreview();
      renderVisualFeedbackDiscussion();
      requestAnimationFrame(() => visualCleanlinessSlider?.focus());
    } else {
      visualFeedbackFixtureType = null;
    }
  }

  function setCommentComposerAvailable(available) {
    const shouldShow = Boolean(
      available && selectedToilet && (feedbackActionBar || commentComposerToggle || visualFeedbackToggle)
    );

    if (feedbackActionBar) {
      feedbackActionBar.hidden = !shouldShow;
      feedbackActionBar.classList.toggle("is-hidden", !shouldShow);
    }

    if (commentComposerToggle) {
      commentComposerToggle.hidden = !shouldShow;
      commentComposerToggle.classList.toggle("is-hidden", !shouldShow);
    }

    if (visualFeedbackToggle) {
      visualFeedbackToggle.hidden = !shouldShow;
      visualFeedbackToggle.classList.toggle("is-hidden", !shouldShow);
    }

    if (!shouldShow) {
      setCommentComposerOpen(false);
      setVisualFeedbackOpen(false);
    }
  }

  function toggleCommentComposer() {
    setCommentComposerOpen(commentComposer?.hidden ?? true);
  }

  function closeCommentComposer() {
    setCommentComposerOpen(false);
  }

  function toggleVisualFeedback() {
    setVisualFeedbackOpen(visualFeedbackPanel?.hidden ?? true);
  }

  function openVisualFeedback(fixtureType = null) {
    setVisualFeedbackOpen(true, fixtureType);
  }

  function closeVisualFeedback() {
    setVisualFeedbackOpen(false);
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
    selectedRating = null;
    setCommentComposerAvailable(false);
    resetVisualFeedbackForm();
    renderVisualFeedbackDiscussion();
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

    // If the toilet record is missing detail fields (like the detailed comment or actual opening hours), fetch full details
    if (toilet && (typeof toilet.comment === "undefined" || toilet.comment === null || !toilet.hours || toilet.hours.today.includes("Closed"))) {
      try {
        const fullDetails = await fetchToiletDetail(toiletId);
        if (fullDetails) {
          // Update the local record with full details
          toilet = { ...toilet, ...fullDetails };
          allToilets = allToilets.map(t => t.id === toiletId ? toilet : t);
        }
      } catch (error) {
        console.warn("Failed to fetch toilet details from API:", error);
      }
    }

    selectedToilet = toilet;
    selectedRating = null;
    closeCommentComposer();
    closeVisualFeedback();
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
    renderCleanlinessRating(toilet);
    resetVisualFeedbackForm();
    updateVisualCleanlinessPreview();
    renderVisualFeedbackDiscussion();

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

  function setToilets(nextToilets, { hideDetails = true, cleanlinessRange = currentCleanlinessRange, merge = false } = {}) {
    currentCleanlinessRange = normaliseCleanlinessRange(cleanlinessRange);

    const processedToilets = nextToilets.map((toilet) =>
      applyStoredCleanlinessUpdate(toilet, currentCleanlinessRange)
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
    { store = true, cleanlinessRange = currentCleanlinessRange } = {}
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
      renderCleanlinessRating(selectedToilet);
    }

    renderResults();
  }

  function selectCleanlinessRating(rating) {
    if (!selectedToilet) {
      setStatus("Select a toilet marker before leaving feedback.");
      return;
    }

    const safeRating = Number(rating);
    if (!Number.isInteger(safeRating) || safeRating < 1 || safeRating > 5) return;

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

    const previousTotal = Number(selectedToilet?.cleanlinessSurvey?.ratingTotal);
    const previousCount = Number(selectedToilet?.cleanlinessSurvey?.ratingCount);
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

    const toiletUpdate = createCurrentRangeCleanlinessUpdate(result.toilet, rating);
    updateToiletCleanliness(toiletUpdate, {
      store: true,
      cleanlinessRange: currentCleanlinessRange
    });

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

  async function submitCleanlinessSurveySelection() {
    if (selectedRating === null) return;
    const saved = await answerCleanlinessSurvey(selectedRating);
    if (!saved) return;

    selectedRating = null;
    renderCleanlinessSurvey(selectedToilet);
  }

  async function answerCleanlinessSurvey(rating) {
    if (!selectedToilet) {
      setStatus("Select a toilet marker before leaving feedback.");
      return false;
    }

    const safeRating = Number(rating);
    if (!Number.isInteger(safeRating) || safeRating < 1 || safeRating > 5) return false;

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
    if (!Number.isInteger(feedbackRating) || feedbackRating < 1 || feedbackRating > 5) {
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
    openCommentThread,
    updateToiletCleanliness,
    selectCleanlinessRating,
    submitCleanlinessSurveySelection,
    answerCleanlinessSurvey,
    postComment,
    getAiSummary,
    setCommentSortMode: feedbackThreadController.setCommentSortMode,
    setCommentFilter: feedbackThreadController.setCommentFilter,
    toggleCommentComposer,
    closeCommentComposer,
    toggleVisualFeedback,
    openVisualFeedback,
    closeVisualFeedback,
    setVisualCleanlinessLevel,
    submitVisualFeedback,
    applyCommentPreset,
    previewCommentMediaSelection,
    removeCommentMediaSelection,
    applyProfilePreferences
  };
}
