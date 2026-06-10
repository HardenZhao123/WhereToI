import {
  deleteComment as deleteCommentRequest,
  fetchComments,
  toggleCommentLike as toggleCommentLikeRequest
} from "../services/toilets-service.js";
import {
  commentFilterKeys,
  filterAndSortComments,
  getCommentMediaAttachments,
  normaliseCommentSortMode
} from "../utils/comments.js";

export function createFeedbackThreadController(elements = {}, options = {}) {
  const {
    commentsList,
    commentsSummary,
    commentSortSelect,
    commentFilterInputs = []
  } = elements;
  const {
    getSelectedToilet = () => null,
    isAuthenticated = () => false,
    showLoginPrompt = () => {},
    onPublicProfileSelected = () => {},
    alertUser = (message) => alert(message),
    confirmDelete = (message) => window.confirm(message)
  } = options;

  let currentComments = [];
  let commentSortMode = "newest";
  let selectedCommentFilters = new Set();
  let pendingFocusedCommentId = null;
  let commentRequestsByToiletId = new Map();

  function renderCommentsPlaceholder(message) {
    currentComments = [];
    updateCommentsSummary(0, 0);

    if (!commentsList) return;

    commentsList.replaceChildren();
    const placeholder = document.createElement("p");
    placeholder.textContent = message;
    commentsList.append(placeholder);
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
        if (attachment.dataUrl) {
          const image = document.createElement("img");
          image.src = attachment.dataUrl;
          image.alt = attachment.name ? `Attached image: ${attachment.name}` : "Attached image";
          image.loading = "lazy";
          item.append(image);
        } else {
          const label = document.createElement("span");
          label.className = "comment-media-metadata";
          label.textContent = attachment.name ? `Image attached: ${attachment.name}` : "Image attached";
          item.append(label);
        }
      }

      if (attachment.type === "video" && attachment.mimeType?.startsWith("video/")) {
        if (attachment.dataUrl) {
          const video = document.createElement("video");
          video.src = attachment.dataUrl;
          video.controls = true;
          video.preload = "metadata";
          video.playsInline = true;
          item.append(video);
        } else {
          const label = document.createElement("span");
          label.className = "comment-media-metadata";
          label.textContent = attachment.name ? `Video attached: ${attachment.name}` : "Video attached";
          item.append(label);
        }
      }

      if (item.childElementCount > 0) {
        wrapper.append(item);
      }
    });

    return wrapper.childElementCount > 0 ? wrapper : null;
  }

  function createCommentAuthorElement(comment) {
    const authorName = comment.author_name || comment.username || "Anonymous";

    if (!comment.is_anonymous && comment.user_id) {
      const button = document.createElement("button");
      button.className = "comment-author comment-author-link";
      button.type = "button";
      button.textContent = authorName;
      button.setAttribute("aria-label", `View ${authorName}'s public profile`);
      button.addEventListener("click", () => onPublicProfileSelected(comment.user_id));
      return button;
    }

    const author = document.createElement("p");
    author.className = "comment-author";
    author.textContent = authorName;
    return author;
  }

  function createCommentRatingElement(comment) {
    const rating = Number(comment?.cleanliness_rating);
    if (!Number.isFinite(rating) || rating < 0.5 || rating > 5 || !Number.isInteger(rating * 2)) {
      return null;
    }

    const ratingElement = document.createElement("span");
    const full = Math.floor(rating);
    const half = rating > full ? 1 : 0;
    const empty = Math.max(5 - full - half, 0);
    ratingElement.className = "comment-rating";
    ratingElement.setAttribute("aria-label", `Cleanliness rating ${rating} out of 5`);
    ratingElement.textContent = `${"\u2605".repeat(full)}${half ? "\u00bd" : ""}${"\u2606".repeat(empty)}`;
    return ratingElement;
  }

  function updateCommentsSummary(totalCount, visibleCount) {
    if (!commentsSummary) return;

    const sortLabel = commentSortSelect?.selectedOptions?.[0]?.textContent ?? "Newest";
    const countLabel =
      selectedCommentFilters.size > 0
        ? `${visibleCount} of ${totalCount} feedback`
        : `${totalCount} feedback`;
    commentsSummary.textContent = `${countLabel} - ${sortLabel}`;
  }

  function focusPendingComment() {
    if (!commentsList || pendingFocusedCommentId === null) return;

    const target = commentsList.querySelector(`[data-comment-id="${pendingFocusedCommentId}"]`);
    if (!target) return;

    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("is-highlighted");
    window.setTimeout(() => target.classList.remove("is-highlighted"), 2400);
    pendingFocusedCommentId = null;
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
    likeButton.setAttribute("aria-label", comment.viewer_has_liked ? "Unlike feedback" : "Like feedback");
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
    menuButton.setAttribute("aria-label", "Feedback options");
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
      empty.textContent = "No feedback yet.";
      commentsList.append(empty);
      return;
    }

    if (visibleComments.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No feedback matches the selected tags.";
      commentsList.append(empty);
      return;
    }

    visibleComments.forEach((comment) => {
      const item = document.createElement("div");
      item.className = "comment-item";
      item.dataset.commentId = String(comment.id);
      if (pendingFocusedCommentId === Number(comment.id)) {
        item.classList.add("is-highlighted");
      }

      const header = document.createElement("div");
      header.className = "comment-header";

      const authorLine = document.createElement("div");
      authorLine.className = "comment-author-line";
      const author = createCommentAuthorElement(comment);
      const rating = createCommentRatingElement(comment);

      authorLine.append(author);
      if (rating) authorLine.append(rating);

      header.append(authorLine);
      header.append(createCommentActions(comment));

      const media = createCommentMediaElement(comment);
      const commentText = String(comment.comment_text ?? "").trim();
      const text = commentText ? document.createElement("p") : null;
      if (text) {
        text.className = "comment-text";
        text.textContent = commentText;
      }

      const date = document.createElement("p");
      date.className = "comment-date";
      date.textContent = new Date(comment.created_at).toLocaleString();

      item.append(header);
      if (text) item.append(text);
      if (media) item.append(media);
      item.append(date);
      commentsList.append(item);
    });

    focusPendingComment();
  }

  function renderComments(comments) {
    currentComments = Array.isArray(comments) ? [...comments] : [];
    renderCommentList();
  }

  function clearComments() {
    currentComments = [];
    updateCommentsSummary(0, 0);
    commentsList?.replaceChildren();
  }

  function resetCommentsForToilet(toilet) {
    if (!commentsList || !toilet?.id) return;

    renderCommentsPlaceholder("Open Feedback to load comments.");
  }

  async function loadComments(toilet, { focusCommentId = null, force = false } = {}) {
    if (!commentsList || !toilet?.id) return [];

    const focusId = Number(focusCommentId);
    pendingFocusedCommentId = Number.isInteger(focusId) && focusId > 0 ? focusId : null;

    void force;

    const existingRequest = commentRequestsByToiletId.get(toilet.id);
    if (existingRequest) return existingRequest;

    renderCommentsPlaceholder("Loading feedback...");

    const request = fetchComments(toilet.id)
      .then((comments) => {
        if (getSelectedToilet()?.id === toilet.id) {
          renderComments(comments);
        }
        return comments;
      })
      .catch((error) => {
        console.error("Failed to fetch feedback:", error);
        if (getSelectedToilet()?.id === toilet.id) {
          renderCommentsPlaceholder("Could not load feedback.");
        }
        return [];
      })
      .finally(() => {
        commentRequestsByToiletId = new Map(commentRequestsByToiletId);
        commentRequestsByToiletId.delete(toilet.id);
      });

    commentRequestsByToiletId = new Map(commentRequestsByToiletId);
    commentRequestsByToiletId.set(toilet.id, request);
    return request;
  }

  function resetCommentControls() {
    selectedCommentFilters = new Set();
    commentFilterInputs.forEach((input) => {
      input.checked = false;
    });
    commentSortMode = "newest";
    if (commentSortSelect) {
      commentSortSelect.value = "newest";
    }
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

  async function toggleCommentLike(comment, button) {
    const selectedToilet = getSelectedToilet();
    if (!selectedToilet || !comment?.id) return;
    closeOpenCommentMenus();

    if (!isAuthenticated()) {
      showLoginPrompt("Log in to like feedback.");
      return;
    }

    if (button) {
      button.disabled = true;
    }

    try {
      const updatedComments = await toggleCommentLikeRequest(selectedToilet.id, comment.id);
      renderComments(updatedComments);
    } catch (error) {
      console.error("Failed to like feedback:", error);
      if (error.status === 401) {
        showLoginPrompt("Log in to like feedback.");
        return;
      }
      alertUser(error?.message || "Could not update like. Please try again later.");
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  async function deleteOwnComment(comment) {
    const selectedToilet = getSelectedToilet();
    if (!selectedToilet || !comment?.id) return;
    closeOpenCommentMenus();

    const confirmed = confirmDelete("Delete this feedback?");
    if (!confirmed) return;

    try {
      const updatedComments = await deleteCommentRequest(selectedToilet.id, comment.id);
      renderComments(updatedComments);
    } catch (error) {
      console.error("Failed to delete comment:", error);
      if (error.status === 401) {
        showLoginPrompt("Log in to delete feedback.");
        return;
      }
      alertUser(error?.message || "Could not delete feedback. Please try again later.");
    }
  }

  return {
    clearComments,
    closeOpenCommentMenus,
    loadComments,
    renderComments,
    resetCommentsForToilet,
    resetCommentControls,
    setCommentFilter,
    setCommentSortMode
  };
}
