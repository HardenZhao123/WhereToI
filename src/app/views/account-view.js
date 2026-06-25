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

function getSubmissionFeatureSummary(submission) {
  const features = submission?.features ?? {};
  const enabled = Object.entries(features)
    .filter(([, value]) => value === "Y")
    .map(([key]) => key.replace(/([A-Z])/g, " $1").toLowerCase());

  return enabled.length > 0 ? enabled.join(", ") : "No confirmed features";
}

function getSubmissionHoursSummary(submission) {
  const hours = submission?.hours ?? {};
  const parts = [hours.today, hours.sat, hours.sun].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "Opening hours unknown";
}

function getSubmissionMeta(submission) {
  const submittedBy = submission?.submittedByUsername || "Unknown user";
  const submittedAt = submission?.submittedAt ? formatAccessTime(submission.submittedAt) : "Unknown time";
  return `Submitted by ${submittedBy} - ${submittedAt}`;
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

export function renderToiletSubmissions(
  submissionsContainer,
  submissions,
  { onReviewSubmission = () => {} } = {}
) {
  if (!submissionsContainer) return;

  submissionsContainer.textContent = "";

  if (!Array.isArray(submissions) || submissions.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No pending submissions.";
    submissionsContainer.append(empty);
    return;
  }

  submissions.forEach((submission) => {
    const item = document.createElement("article");
    item.className = "submission-review-item";

    const heading = document.createElement("h4");
    heading.textContent = submission.name || "Unnamed toilet";

    const area = document.createElement("p");
    area.className = "submission-review-area";
    area.textContent = `${submission.area || "Unknown area"} - ${Number(submission.lat).toFixed(5)}, ${Number(submission.lng).toFixed(5)}`;

    const meta = document.createElement("p");
    meta.className = "submission-review-meta";
    meta.textContent = getSubmissionMeta(submission);

    const note = document.createElement("p");
    note.className = "submission-review-note";
    note.textContent = submission.comment || "No note provided.";

    const details = document.createElement("p");
    details.className = "submission-review-details";
    details.textContent = `${getSubmissionFeatureSummary(submission)} - ${getSubmissionHoursSummary(submission)}`;

    const actions = document.createElement("div");
    actions.className = "submission-review-actions";

    const approveButton = document.createElement("button");
    approveButton.className = "solid-button";
    approveButton.type = "button";
    approveButton.textContent = "Approve";
    approveButton.addEventListener("click", () => onReviewSubmission(submission, "approved", approveButton));

    const rejectButton = document.createElement("button");
    rejectButton.className = "outline-button";
    rejectButton.type = "button";
    rejectButton.textContent = "Reject";
    rejectButton.addEventListener("click", () => onReviewSubmission(submission, "rejected", rejectButton));

    actions.append(approveButton, rejectButton);
    item.append(heading, area, meta, note, details, actions);
    submissionsContainer.append(item);
  });
}
