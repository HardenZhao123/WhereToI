import { appConfig } from "../config/app-config.js";
import {
  deleteComment as deleteCommentRequest,
  fetchComments,
  submitCleanlinessSurvey,
  submitComment,
  toggleCommentLike as toggleCommentLikeRequest
} from "../services/toilets-service.js";
import {
  formatCleanlinessRating,
  formatCleanlinessRatingCount,
  getCleanlinessScore,
  getCleanlinessStars
} from "../utils/cleanliness.js";
import {
  commentFilterKeys,
  filterAndSortComments,
  getCommentMediaAttachments,
  normaliseCommentSortMode
} from "../utils/comments.js";
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
const commentMediaMaxBytes = 8 * 1024 * 1024;
const commentMediaMaxAttachments = 9;
const commentMediaMaxImages = 9;
const commentMediaMaxVideos = 3;

export function createMapController(elements, onToiletSelected = () => {}, auth = {}) {
  const {
    statusText,
    searchInput,
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
    commentComposer,
    commentComposerToggle,
    commentForm,
    commentInput,
    commentAnonymousInput,
    commentMediaInput,
    commentMediaPreview,
    commentMediaStatus,
    featureFilterInputs = [],
    sortSelect,
    resultsSummary,
    resultsList
  } = elements;
  const {
    isAuthenticated = () => true,
    showLoginPrompt = () => {}
  } = auth;

  const surveyStorageKey = "wheretoi-map-cleanliness-survey";

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
  let selectedRating = null;
  let selectedCommentMedia = [];
  let currentComments = [];
  let commentSortMode = "newest";
  let selectedCommentFilters = new Set();

  document.addEventListener("click", closeOpenCommentMenus);

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

    if (submitCleanlinessSurveyButton) {
      submitCleanlinessSurveyButton.disabled = selectedRating === null;
    }

    if (mapSurveyStatus) {
      if (selectedRating !== null) {
        mapSurveyStatus.textContent = `You've selected ${selectedRating}/5 stars. Click submit to save.`;
      } else {
        mapSurveyStatus.textContent = isWithinCooldown
          ? `Thanks! You can rate this toilet again in 30 minutes.`
          : isAuthenticated()
            ? "Choose 1 to 5 stars to help others."
            : "Log in or sign up to rate cleanliness.";
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

  function getCommentMediaType(file) {
    if (!file?.type) return null;
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    return null;
  }

  function formatMediaSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function getSelectedCommentMediaCounts() {
    return selectedCommentMedia.reduce(
      (counts, media) => {
        counts.total += 1;
        if (media.type === "image") counts.images += 1;
        if (media.type === "video") counts.videos += 1;
        return counts;
      },
      { total: 0, images: 0, videos: 0 }
    );
  }

  function getDefaultMediaStatus() {
    const counts = getSelectedCommentMediaCounts();
    if (counts.total === 0) {
      return "Up to 9 attachments total, including up to 3 videos.";
    }

    return `${counts.total}/9 attachments selected. Images ${counts.images}/9, videos ${counts.videos}/3.`;
  }

  function setCommentMediaStatus(message = getDefaultMediaStatus()) {
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
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `Remove ${media.file.name || "attachment"}`);
    removeButton.addEventListener("click", () => removeCommentMediaSelection(media.id));

    const caption = document.createElement("p");
    caption.className = "comment-media-caption";
    caption.textContent = `${media.file.name || "Attachment"} ${formatMediaSize(media.file.size)}`.trim();

    item.append(frame, removeButton, caption);
    return item;
  }

  function renderCommentMediaPreview(statusMessage = getDefaultMediaStatus()) {
    if (commentMediaPreview) {
      commentMediaPreview.replaceChildren();
      selectedCommentMedia.forEach((media) => {
        commentMediaPreview.append(createCommentMediaPreviewCard(media));
      });
    }

    setCommentMediaStatus(statusMessage);
  }

  function validateCommentMediaFile(file) {
    const mediaType = getCommentMediaType(file);
    if (!mediaType) {
      return { error: `${file?.name || "This file"} is not an image or video.` };
    }

    if (file.size > commentMediaMaxBytes) {
      return { error: `${file.name} is over 8 MB.` };
    }

    const counts = getSelectedCommentMediaCounts();
    if (counts.total >= commentMediaMaxAttachments) {
      return { error: "You can attach up to 9 files total." };
    }

    if (mediaType === "video" && counts.videos >= commentMediaMaxVideos) {
      return { error: "You can attach up to 3 videos." };
    }

    if (mediaType === "image" && counts.images >= commentMediaMaxImages) {
      return { error: "You can attach up to 9 images." };
    }

    return { mediaType };
  }

  function previewCommentMediaSelection() {
    const files = Array.from(commentMediaInput?.files ?? []);
    let statusMessage = "";

    for (const file of files) {
      const { mediaType, error } = validateCommentMediaFile(file);
      if (error) {
        statusMessage = error;
        continue;
      }

      selectedCommentMedia.push({
        id: `comment-media-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        type: mediaType,
        previewUrl: URL.createObjectURL(file)
      });
    }

    if (commentMediaInput) {
      commentMediaInput.value = "";
    }

    renderCommentMediaPreview(statusMessage || getDefaultMediaStatus());
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
      reader.addEventListener("error", () => reject(new Error("Could not read selected file.")));
      reader.readAsDataURL(file);
    });
  }

  async function readCommentMediaAttachments() {
    return Promise.all(
      selectedCommentMedia.map(async (media) => ({
        type: media.type,
        mimeType: media.file.type,
        name: media.file.name,
        size: media.file.size,
        dataUrl: await readFileAsDataUrl(media.file)
      }))
    );
  }

  function resetCommentMediaAttachment() {
    if (commentMediaInput) {
      commentMediaInput.value = "";
    }

    selectedCommentMedia.forEach((media) => URL.revokeObjectURL(media.previewUrl));
    selectedCommentMedia = [];
    renderCommentMediaPreview();
  }

  function removeCommentMediaSelection(mediaId) {
    const media = selectedCommentMedia.find((item) => item.id === mediaId);
    if (media) {
      URL.revokeObjectURL(media.previewUrl);
    }

    selectedCommentMedia = selectedCommentMedia.filter((item) => item.id !== mediaId);
    renderCommentMediaPreview();
  }

  function createCommentMediaElement(comment) {
    const attachments = getCommentMediaAttachments(comment);
    if (attachments.length === 0) return null;

    const wrapper = document.createElement("div");
    wrapper.className = "comment-media";

    attachments.forEach((attachment) => {
      const item = document.createElement("div");
      item.className = "comment-media-item";

      if (attachment.type === "image" && attachment.mimeType?.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = attachment.dataUrl;
        image.alt = attachment.name ? `Attached image: ${attachment.name}` : "Attached image";
        image.loading = "lazy";
        item.append(image);
      }

      if (attachment.type === "video" && attachment.mimeType?.startsWith("video/")) {
        const video = document.createElement("video");
        video.src = attachment.dataUrl;
        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;
        item.append(video);
      }

      if (item.childElementCount > 0) {
        wrapper.append(item);
      }
    });

    return wrapper.childElementCount > 0 ? wrapper : null;
  }

  function renderComments(comments) {
    currentComments = Array.isArray(comments) ? [...comments] : [];
    renderCommentList();
  }

  function updateCommentsSummary(totalCount, visibleCount) {
    if (!commentsSummary) return;

    const sortLabel = commentSortSelect?.selectedOptions?.[0]?.textContent ?? "Newest";
    const countLabel =
      selectedCommentFilters.size > 0
        ? `${visibleCount} of ${totalCount} comments`
        : `${totalCount} comment${totalCount === 1 ? "" : "s"}`;
    commentsSummary.textContent = `${countLabel} - ${sortLabel}`;
  }

  function renderCommentList() {
    const visibleComments = filterAndSortComments(currentComments, {
      sortMode: commentSortMode,
      filters: selectedCommentFilters
    });
    updateCommentsSummary(currentComments.length, visibleComments.length);

    if (!commentsList) return;

    commentsList.replaceChildren();

    if (currentComments.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No comments yet. Be the first to write one!";
      commentsList.append(empty);
      return;
    }

    if (visibleComments.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No comments match the selected tags.";
      commentsList.append(empty);
      return;
    }

    visibleComments.forEach((comment) => {
      const item = document.createElement("div");
      item.className = "comment-item";

      const header = document.createElement("div");
      header.className = "comment-header";

      const author = document.createElement("p");
      author.className = "comment-author";
      author.textContent = comment.author_name || comment.username || "Anonymous";

      header.append(author);
      header.append(createCommentActions(comment));

      const text = document.createElement("p");
      text.className = "comment-text";
      text.textContent = comment.comment_text;

      const media = createCommentMediaElement(comment);

      const date = document.createElement("p");
      date.className = "comment-date";
      date.textContent = new Date(comment.created_at).toLocaleString();

      item.append(header);
      item.append(text);
      if (media) item.append(media);
      item.append(date);
      commentsList.append(item);
    });
  }

  function setCommentSortMode(nextSortMode) {
    commentSortMode = normaliseCommentSortMode(nextSortMode);
    renderCommentList();
  }

  function setCommentFilter(filterKey, checked) {
    if (!commentFilterKeys.has(filterKey)) return;

    selectedCommentFilters = new Set(selectedCommentFilters);
    if (checked) {
      selectedCommentFilters.add(filterKey);
    } else {
      selectedCommentFilters.delete(filterKey);
    }

    renderCommentList();
  }

  function closeOpenCommentMenus() {
    commentsList?.querySelectorAll(".comment-menu").forEach((menu) => {
      menu.hidden = true;
    });

    commentsList?.querySelectorAll(".comment-menu-button").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  }

  function createCommentActions(comment) {
    const actions = document.createElement("div");
    actions.className = "comment-actions";

    const likeButton = document.createElement("button");
    likeButton.className = "comment-like-button";
    likeButton.type = "button";
    likeButton.setAttribute("aria-label", comment.viewer_has_liked ? "Unlike comment" : "Like comment");
    likeButton.setAttribute("aria-pressed", comment.viewer_has_liked ? "true" : "false");
    likeButton.classList.toggle("is-liked", Boolean(comment.viewer_has_liked));

    const likeIcon = document.createElement("span");
    likeIcon.className = "comment-like-icon";
    likeIcon.textContent = "\u{1F44D}";

    const likeCount = document.createElement("span");
    likeCount.className = "comment-like-count";
    likeCount.textContent = String(comment.like_count ?? 0);

    likeButton.append(likeIcon, likeCount);
    likeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCommentLike(comment, likeButton);
    });

    actions.append(likeButton);

    if (!comment.can_delete) {
      return actions;
    }

    const menuButton = document.createElement("button");
    menuButton.className = "comment-menu-button";
    menuButton.type = "button";
    menuButton.textContent = "...";
    menuButton.setAttribute("aria-label", "Comment options");
    menuButton.setAttribute("aria-haspopup", "menu");
    menuButton.setAttribute("aria-expanded", "false");

    const menu = document.createElement("div");
    menu.className = "comment-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    const deleteButton = document.createElement("button");
    deleteButton.className = "comment-delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("role", "menuitem");
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteOwnComment(comment);
    });

    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const shouldOpen = menu.hidden;
      closeOpenCommentMenus();
      menu.hidden = !shouldOpen;
      menuButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    });

    menu.append(deleteButton);
    actions.append(menuButton, menu);
    return actions;
  }

  async function toggleCommentLike(comment, button) {
    if (!selectedToilet || !comment?.id) return;
    closeOpenCommentMenus();

    if (!isAuthenticated()) {
      showLoginPrompt("Log in to like a comment.");
      return;
    }

    if (button) {
      button.disabled = true;
    }

    try {
      const updatedComments = await toggleCommentLikeRequest(selectedToilet.id, comment.id);
      renderComments(updatedComments);
    } catch (error) {
      console.error("Failed to like comment:", error);
      if (error.status === 401) {
        showLoginPrompt("Log in to like a comment.");
        return;
      }
      alert(error?.message || "Could not update like. Please try again later.");
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  async function deleteOwnComment(comment) {
    if (!selectedToilet || !comment?.id) return;
    closeOpenCommentMenus();

    const confirmed = window.confirm("Delete this comment?");
    if (!confirmed) return;

    try {
      const updatedComments = await deleteCommentRequest(selectedToilet.id, comment.id);
      renderComments(updatedComments);
    } catch (error) {
      console.error("Failed to delete comment:", error);
      if (error.status === 401) {
        showLoginPrompt("Log in to delete a comment.");
        return;
      }
      alert(error?.message || "Could not delete comment. Please try again later.");
    }
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
      commentComposerToggle.textContent = shouldOpen ? "Hide editor" : "Write comment";
    }

    mapPanel?.classList.toggle("has-comment-composer", shouldOpen);

    if (shouldOpen) {
      requestAnimationFrame(() => commentInput?.focus());
    }
  }

  function setCommentComposerAvailable(available) {
    const shouldShow = Boolean(available && selectedToilet && commentComposerToggle);

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

  function setDetailSection(sectionName = "features") {
    const hasPanel = [...detailPanels].some((panel) => panel.dataset.detailPanel === sectionName);
    const nextSection = hasPanel ? sectionName : "features";

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
      button.addEventListener("click", () => setToilet(toilet.id));

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
    detailsCard?.classList.add("is-hidden");
    mapPanel?.classList.remove("has-details");

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

  function setToilet(toiletId, { fly = true, updateDistance = true, defaultSection = "features" } = {}) {
    const toilet = allToilets.find((item) => item.id === toiletId);
    if (!toilet) return;

    selectedToilet = toilet;
    selectedRating = null;
    closeCommentComposer();
    setCommentComposerAvailable(true);
    
    if (defaultSection) {
      setDetailSection(defaultSection);
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

    if (commentsList) {
      currentComments = [];
      updateCommentsSummary(0, 0);
      commentsList.replaceChildren();
      const loading = document.createElement("p");
      loading.textContent = "Loading comments...";
      commentsList.append(loading);

      fetchComments(toilet.id)
        .then((comments) => renderComments(comments))
        .catch((error) => {
          console.error("Failed to fetch comments:", error);
          if (commentsList) {
            commentsList.textContent = "Could not load comments.";
          }
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
  }

  function renderMarkers() {
    if (!map || !markersLayer) {
      visibleToilets = [...filteredToilets];
      hiddenByMarkerLimit = 0;
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

      marker.on("click", () => setToilet(toilet.id));
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
    const limitHint = hiddenByMarkerLimit > 0 ? ` Zoom in to load ${hiddenByMarkerLimit} more.` : "";
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
        }

        setStatus("Location found. Distances are now updated.");
      },
      () => {
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
    });

    return true;
  }

  function setToilets(nextToilets, { hideDetails = true } = {}) {
    allToilets = nextToilets.map(applyStoredCleanlinessUpdate);
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

  function getCleanlinessUpdateCount(cleanlinessUpdate) {
    const ratingCount = Number(cleanlinessUpdate?.cleanlinessSurvey?.ratingCount);
    return Number.isFinite(ratingCount) ? ratingCount : 0;
  }

  function applyStoredCleanlinessUpdate(toilet) {
    const storedUpdate = cleanlinessUpdateById.get(toilet.id);
    if (!storedUpdate) return toilet;

    const incomingCount = getCleanlinessUpdateCount(toilet);
    const storedCount = getCleanlinessUpdateCount(storedUpdate);
    if (incomingCount >= storedCount) return toilet;

    return {
      ...toilet,
      cleanliness: storedUpdate.cleanliness,
      cleanlinessSurvey: storedUpdate.cleanlinessSurvey
    };
  }

  function updateToiletCleanliness(toiletUpdate) {
    if (!toiletUpdate?.id) return;

    cleanlinessUpdateById = new Map(cleanlinessUpdateById);
    cleanlinessUpdateById.set(toiletUpdate.id, {
      cleanliness: toiletUpdate.cleanliness,
      cleanlinessSurvey: toiletUpdate.cleanlinessSurvey
    });

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
      setStatus("Select a toilet marker before writing a review.");
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

  async function submitCleanlinessSurveySelection() {
    if (selectedRating === null) return;
    await answerCleanlinessSurvey(selectedRating);
    selectedRating = null;
    renderCleanlinessSurvey(selectedToilet);
  }

  async function answerCleanlinessSurvey(rating) {
    if (!selectedToilet) {
      setStatus("Select a toilet marker before writing a review.");
      return;
    }

    const safeRating = Number(rating);
    if (!Number.isInteger(safeRating) || safeRating < 1 || safeRating > 5) return;

    if (!isAuthenticated()) {
      if (mapSurveyStatus) {
        mapSurveyStatus.textContent = "Log in or sign up to rate cleanliness.";
      }
      showLoginPrompt("Log in or sign up to rate cleanliness.");
      return;
    }

    if (mapSurveyStatus) {
      mapSurveyStatus.classList.remove("warning");
      mapSurveyStatus.textContent = "Saving rating to database...";
    }

    let savedToDatabase = false;

    try {
      const result = await submitCleanlinessSurvey({
        toiletId: selectedToilet.id,
        toiletName: selectedToilet.name,
        rating: safeRating
      });

      savedToDatabase = true;

      if (result.toilet?.id) {
        updateToiletCleanliness(result.toilet);
      }
    } catch (error) {
      console.error("Cleanliness survey failed:", error);
      if (error.status === 401) {
        if (mapSurveyStatus) {
          mapSurveyStatus.classList.add("warning");
          mapSurveyStatus.textContent = "Log in or sign up to rate cleanliness.";
        }
        showLoginPrompt("Log in or sign up to rate cleanliness.");
        return;
      }

      if (mapSurveyStatus) {
        mapSurveyStatus.classList.add("warning");
        mapSurveyStatus.textContent = error.message || "Could not save to database. Saved on this device only.";
      }
    }

    cleanlinessSurveyAnswers = {
      ...cleanlinessSurveyAnswers,
      [selectedToilet.id]: {
        rating: safeRating,
        toiletName: selectedToilet.name,
        submittedAt: new Date().toISOString()
      }
    };

    saveSurveyAnswers();
    renderCleanlinessSurvey(selectedToilet);

    if (!savedToDatabase && mapSurveyStatus) {
      mapSurveyStatus.textContent = "Could not save to database. Saved on this device only.";
    }
  }

  async function postComment(event) {
    event.preventDefault();

    if (!selectedToilet || !commentInput) return;

    const commentText = commentInput.value.trim();
    if (!commentText) return;

    if (!isAuthenticated()) {
      showLoginPrompt("Log in to post a comment.");
      return;
    }

    const submitButton = commentForm?.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      const media = await readCommentMediaAttachments();
      const commentVisibility = getCommentVisibility();
      const updatedComments = await submitComment(selectedToilet.id, commentText, media, commentVisibility);
      renderComments(updatedComments);
      commentInput.value = "";
      resetCommentMediaAttachment();
      closeCommentComposer();
    } catch (error) {
      console.error("Failed to post comment:", error);
      if (error.status === 401) {
        showLoginPrompt("Log in to post a comment.");
        return;
      }
      alert(error?.message || "Could not post comment. Please try again later.");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
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
    setDetailSection,
    hideToiletDetails,
    refreshAfterTabVisible,
    getSelectedToilet,
    setToilet,
    updateToiletCleanliness,
    selectCleanlinessRating,
    submitCleanlinessSurveySelection,
    answerCleanlinessSurvey,
    postComment,
    setCommentSortMode,
    setCommentFilter,
    toggleCommentComposer,
    closeCommentComposer,
    applyCommentPreset,
    previewCommentMediaSelection,
    removeCommentMediaSelection,
    applyProfilePreferences
  };
}
