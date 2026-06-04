import { formatAccessTime, formatCharge, formatCurrency, formatRenewDate } from "../utils/account-formatters.js";
import { getCommentMediaAttachments } from "../utils/comments.js";

export function renderAccount({ walletBalance, subscriptionPlan, monthlyTicketsLeft, accountUsername, accountWelcome, displayGender, displayNeeds }, account, user) {
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

  if (!account) return;

  if (walletBalance) {
    walletBalance.textContent = formatCurrency(account.walletBalanceGbp);
  }

  if (subscriptionPlan) {
    const renewDate = formatRenewDate(account.subscriptionRenewsOn);
    subscriptionPlan.textContent = `${account.subscriptionName} - renews ${renewDate}`;
  }

  if (monthlyTicketsLeft) {
    monthlyTicketsLeft.textContent = `${Number(account.monthlyFreeTicketsLeft ?? 0)} left`;
  }
}

export function renderAccessHistory(historyContainer, history) {
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
    const block = document.createElement("div");
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

function createCommentMediaPreview(comment) {
  const attachments = getCommentMediaAttachments(comment);
  if (attachments.length === 0) return null;

  const preview = document.createElement("div");
  preview.className = "my-comment-media";
  preview.setAttribute("aria-label", "Comment attachments");

  attachments.slice(0, 4).forEach((attachment) => {
    const item = document.createElement("div");
    item.className = "my-comment-media-item";

    if (attachment.type === "image" && attachment.dataUrl) {
      const image = document.createElement("img");
      image.src = attachment.dataUrl;
      image.alt = attachment.name ? `Attached image: ${attachment.name}` : "Attached image";
      image.loading = "lazy";
      item.append(image);
    }

    if (attachment.type === "video" && attachment.dataUrl) {
      const video = document.createElement("video");
      video.src = attachment.dataUrl;
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      item.append(video);
    }

    if (item.childElementCount > 0) {
      preview.append(item);
    }
  });

  if (attachments.length > 4) {
    const more = document.createElement("span");
    more.className = "my-comment-media-more";
    more.textContent = `+${attachments.length - 4}`;
    preview.append(more);
  }

  return preview.childElementCount > 0 ? preview : null;
}

export function renderMyComments(commentsContainer, comments, { onOpenComment = () => {}, onSetProfileVisibility = () => {} } = {}) {
  if (!commentsContainer) return;

  commentsContainer.textContent = "";

  if (!Array.isArray(comments) || comments.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No comments yet.";
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

    const toiletName = document.createElement("strong");
    toiletName.textContent = comment.toilet_name || comment.toiletName || "Unknown toilet";

    const text = document.createElement("span");
    text.className = "my-comment-text";
    text.textContent = comment.comment_text || "";

    const meta = document.createElement("span");
    meta.className = "my-comment-meta";
    meta.textContent = [
      getCommentIdentityLabel(comment),
      getCommentProfileVisibilityLabel(comment),
      `${Number(comment.like_count ?? 0)} likes`,
      formatAccessTime(comment.created_at)
    ].join(" - ");

    openButton.append(toiletName, text, meta);

    const visibilityButton = document.createElement("button");
    visibilityButton.className = "my-comment-visibility";
    visibilityButton.type = "button";
    visibilityButton.textContent = comment.profile_visibility === "public" ? "Hide from profile" : "Show on profile";
    visibilityButton.addEventListener("click", () => {
      const nextVisibility = comment.profile_visibility === "public" ? "private" : "public";
      onSetProfileVisibility(comment, nextVisibility, visibilityButton);
    });

    const mediaPreview = createCommentMediaPreview(comment);

    item.append(openButton, visibilityButton);
    if (mediaPreview) item.append(mediaPreview);
    commentsContainer.append(item);
  });
}
