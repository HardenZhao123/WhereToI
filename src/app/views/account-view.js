import { formatAccessTime, formatCharge, formatCurrency } from "../utils/account-formatters.js";
import { createStarRatingElement, getHalfStepRating } from "../utils/star-rating.js";

export function renderAccount({ accountUsername, accountWelcome, displayGender, displayNeeds }, account, user) {
  if (user && accountUsername) {
    accountUsername.textContent = user.username;
    if (accountWelcome) {
      accountWelcome.textContent = `Welcome back, ${user.username}`;
    }

    if (displayGender) {
      displayGender.textContent = user.gender || "Not set";
    }

    if (displayNeeds) {
      try {
        const needs = JSON.parse(user.preferences || "[]");
        displayNeeds.textContent = needs.length > 0 ? needs.join(", ") : "None set";
      } catch {
        displayNeeds.textContent = "None set";
      }
    }
  }
}

export function renderAccessHistory(historyContainer, history, { onOpenToilet = () => {} } = {}) {
  if (!historyContainer) return;

  historyContainer.textContent = "";

  if (!Array.isArray(history) || history.length === 0) {
    const empty = document.createElement("div");
    const info = document.createElement("p");
    info.textContent = "No access history yet.";
    empty.append(info);
    historyContainer.append(empty);
    return;
  }

  history.forEach((entry) => {
    const hasToiletTarget = Boolean(entry?.toiletId);
    const block = document.createElement(hasToiletTarget ? "button" : "div");
    block.className = "history-item";
    if (hasToiletTarget) {
      block.type = "button";
      block.setAttribute("aria-label", `Open details for ${entry.toiletName || "this toilet"}`);
      block.addEventListener("click", () => onOpenToilet(entry));
    }

    const heading = document.createElement("strong");
    const line = document.createElement("p");

    heading.textContent = entry.toiletName || "Unknown toilet";
    line.textContent = `${formatAccessTime(entry.accessTime)} - ${entry.eventType || "Access"} - ${formatCharge(entry.amountGbp)}`;

    block.append(heading, line);
    historyContainer.append(block);
  });
}

function getCommentIdentityLabel(comment) {
  return `Identity: ${comment?.comment_visibility === "anonymous" || comment?.is_anonymous ? "Anonymous" : "Real name"}`;
}

function getCommentProfileVisibilityLabel(comment) {
  return `Profile: ${comment?.profile_visibility === "public" ? "Public" : "Private"}`;
}

function getCommentRating(comment) {
  return getHalfStepRating(comment?.cleanliness_rating ?? comment?.cleanlinessRating);
}

function createCommentRatingElement(comment) {
  const rating = getCommentRating(comment);
  return createStarRatingElement(rating, "profile-feedback-rating");
}

function createCommentHeading(comment) {
  const heading = document.createElement("span");
  heading.className = "profile-feedback-heading";

  const toiletName = document.createElement("strong");
  toiletName.textContent = comment.toilet_name || comment.toiletName || "Unknown toilet";

  const ratingElement = createCommentRatingElement(comment);
  heading.append(toiletName);
  if (ratingElement) {
    heading.append(ratingElement);
  }

  return heading;
}

function renderCommentMeta(meta, parts) {
  const metaText = parts.filter(Boolean).join(" - ");

  meta.replaceChildren();
  if (metaText) {
    const text = document.createElement("span");
    text.textContent = metaText;
    meta.append(text);
  }
}

export function renderMyComments(commentsContainer, comments, { onOpenComment = () => {}, onSetProfileVisibility = () => {} } = {}) {
  if (!commentsContainer) return;

  commentsContainer.textContent = "";

  if (!Array.isArray(comments) || comments.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No feedback yet.";
    commentsContainer.append(empty);
    return;
  }

  comments.forEach((comment) => {
    const item = document.createElement("div");
    item.className = "my-comment-item";

    const openButton = document.createElement("button");
    openButton.className = "my-comment-open";
    openButton.type = "button";
    openButton.addEventListener("click", () => onOpenComment(comment));

    const heading = createCommentHeading(comment);

    const text = document.createElement("span");
    text.className = "my-comment-text";
    text.textContent = comment.comment_text || "";

    const meta = document.createElement("span");
    meta.className = "my-comment-meta";
    renderCommentMeta(meta, [
      getCommentIdentityLabel(comment),
      getCommentProfileVisibilityLabel(comment),
      `${Number(comment.like_count ?? 0)} likes`,
      `${Number(comment.dislike_count ?? 0)} dislikes`,
      formatAccessTime(comment.created_at)
    ]);

    openButton.append(heading, text, meta);

    const visibilityButton = document.createElement("button");
    visibilityButton.className = "my-comment-visibility";
    visibilityButton.type = "button";
    visibilityButton.textContent = comment.profile_visibility === "public" ? "Hide from profile" : "Show on profile";
    visibilityButton.addEventListener("click", () => {
      const nextVisibility = comment.profile_visibility === "public" ? "private" : "public";
      onSetProfileVisibility(comment, nextVisibility, visibilityButton);
    });

    item.append(openButton, visibilityButton);
    commentsContainer.append(item);
  });
}

export function renderPublicProfile(
  { publicProfileUsername, publicProfileSummary, publicProfileCommentsList },
  profile,
  { onOpenComment = () => {} } = {}
) {
  const username = profile?.user?.username || "Profile";
  const comments = Array.isArray(profile?.comments) ? profile.comments : [];

  if (publicProfileUsername) {
    publicProfileUsername.textContent = username;
  }

  if (publicProfileSummary) {
    publicProfileSummary.textContent =
      comments.length === 1
        ? "1 public feedback"
        : `${comments.length} public feedback`;
  }

  if (!publicProfileCommentsList) return;
  publicProfileCommentsList.textContent = "";

  if (comments.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No public feedback yet.";
    publicProfileCommentsList.append(empty);
    return;
  }

  comments.forEach((comment) => {
    const item = document.createElement("div");
    item.className = "public-profile-comment-item";

    const openButton = document.createElement("button");
    openButton.className = "public-profile-comment-open";
    openButton.type = "button";
    openButton.addEventListener("click", () => onOpenComment(comment));

    const heading = createCommentHeading(comment);

    const text = document.createElement("span");
    text.className = "public-profile-comment-text";
    text.textContent = comment.comment_text || "";

    const meta = document.createElement("span");
    meta.className = "public-profile-comment-meta";
    renderCommentMeta(meta, [
      `${Number(comment.like_count ?? 0)} likes`,
      `${Number(comment.dislike_count ?? 0)} dislikes`,
      formatAccessTime(comment.created_at)
    ]);

    openButton.append(heading, text, meta);

    item.append(openButton);
    publicProfileCommentsList.append(item);
  });
}
