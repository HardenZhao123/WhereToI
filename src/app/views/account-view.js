import { appConfig } from "../config/app-config.js";
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

function createReviewPanelId(prefix, rawId, index) {
  const idPart = String(rawId ?? index)
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-") || String(index);
  return `${prefix}-${idPart}-${index}`;
}

function createReviewDisclosure({
  panelId,
  reviewId,
  title,
  subtitle,
  meta,
  summary,
  bodyLabel,
  detailNodes,
  expanded = false
}) {
  const item = document.createElement("article");
  item.className = "submission-review-item";
  if (reviewId) {
    item.setAttribute("data-review-id", reviewId);
  }

  const toggle = document.createElement("button");
  toggle.className = "submission-review-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  toggle.setAttribute("aria-label", `Show review details for ${title}`);

  const text = document.createElement("span");
  text.className = "submission-review-toggle-text";

  const titleElement = document.createElement("strong");
  titleElement.className = "submission-review-title";
  titleElement.textContent = title;

  const subtitleElement = document.createElement("span");
  subtitleElement.className = "submission-review-toggle-subtitle";
  subtitleElement.textContent = subtitle;

  const metaElement = document.createElement("span");
  metaElement.className = "submission-review-toggle-meta";
  metaElement.textContent = meta;

  const summaryElement = document.createElement("span");
  summaryElement.className = "submission-review-toggle-summary";
  summaryElement.textContent = summary;

  text.append(titleElement, subtitleElement, metaElement, summaryElement);

  const state = document.createElement("span");
  state.className = "submission-review-toggle-state";
  state.textContent = "View details";

  toggle.append(text, state);

  const body = document.createElement("div");
  body.className = "submission-review-body";
  body.hidden = true;
  body.setAttribute("id", panelId);
  body.setAttribute("role", "region");
  body.setAttribute("aria-label", bodyLabel);
  body.append(...detailNodes);

  function setExpanded(isExpanded) {
    body.hidden = !isExpanded;
    item.className = isExpanded
      ? "submission-review-item is-expanded"
      : "submission-review-item";
    toggle.setAttribute("aria-expanded", String(isExpanded));
    toggle.setAttribute("aria-label", `${isExpanded ? "Hide" : "Show"} review details for ${title}`);
    state.textContent = isExpanded ? "Hide details" : "View details";
  }

  setExpanded(Boolean(expanded));
  toggle.addEventListener("click", () => setExpanded(body.hidden));

  item.append(toggle, body);
  return item;
}

function getOpenStreetMapUrl(lat, lng) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=19/${lat}/${lng}`;
}

function getGoogleMapsUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}

function createExternalMapLink(label, href) {
  const link = document.createElement("a");
  link.className = "submission-map-link";
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

function renderSubmissionLocationChecks(submission) {
  const container = document.createElement("section");
  container.className = "submission-location-checks";
  container.setAttribute("aria-label", "Location verification");

  const heading = document.createElement("h5");
  heading.textContent = "Verify location";

  const links = document.createElement("div");
  links.className = "submission-map-links";
  links.append(
    createExternalMapLink("OpenStreetMap", getOpenStreetMapUrl(submission.lat, submission.lng)),
    createExternalMapLink("Google Maps", getGoogleMapsUrl(submission.lat, submission.lng))
  );

  container.append(heading, links);
  return container;
}

function renderSubmissionEvidence(submission, { onRetryOcr = () => {} } = {}) {
  const container = document.createElement("section");
  container.className = "submission-evidence";
  container.setAttribute("aria-label", "Submission evidence");

  const heading = document.createElement("h5");
  heading.textContent = "Submission evidence";
  container.append(heading);

  const accuracyValue = submission?.locationAccuracyMetres;
  const markerDistanceValue = submission?.locationDistanceMetres;
  const accuracy = Number(accuracyValue);
  const markerDistance = Number(markerDistanceValue);
  const hasAccuracy =
    accuracyValue !== null && accuracyValue !== undefined && accuracyValue !== "" && Number.isFinite(accuracy);
  const hasMarkerDistance =
    markerDistanceValue !== null &&
    markerDistanceValue !== undefined &&
    markerDistanceValue !== "" &&
    Number.isFinite(markerDistance);

  const location = document.createElement("p");
  const locationWarning =
    !hasAccuracy || accuracy > 50 || (hasMarkerDistance && markerDistance > 200);
  location.className = locationWarning
    ? "submission-evidence-location warning"
    : "submission-evidence-location";
  const locationParts = [
    hasAccuracy ? `GPS accuracy: +/- ${Math.round(accuracy)} m` : "GPS accuracy unavailable",
    hasMarkerDistance ? `marker ${Math.round(markerDistance)} m from device location` : "",
    submission?.locationCapturedAt ? `recorded ${formatAccessTime(submission.locationCapturedAt)}` : ""
  ].filter(Boolean);
  location.textContent = locationParts.join(" - ");
  container.append(location);

  if (submission?.hasEntrancePhoto) {
    const figure = document.createElement("figure");
    figure.className = "submission-evidence-photo";

    const image = document.createElement("img");
    image.src = `${appConfig.apiBasePath}/admin/toilet-submissions/photo?toiletId=${encodeURIComponent(submission.id)}`;
    image.alt = `Entrance photo for ${submission.name || "submitted toilet"}`;
    image.loading = "lazy";

    const caption = document.createElement("figcaption");
    const sizeKilobytes = Number(submission.entrancePhotoSize) > 0
      ? ` - ${Math.max(1, Math.round(Number(submission.entrancePhotoSize) / 1024))} KB`
      : "";
    caption.textContent = `Entrance photo${sizeKilobytes}`;
    figure.append(image, caption);
    container.append(figure);
  } else {
    const noPhoto = document.createElement("p");
    noPhoto.className = "submission-evidence-no-photo";
    noPhoto.textContent = "No entrance photo provided.";
    container.append(noPhoto);
  }

  container.append(renderSubmissionOcrEvidence(submission, { onRetryOcr }));
  return container;
}

const ocrStatusLabels = {
  not_requested: "OCR not run",
  pending: "OCR pending",
  completed: "OCR completed",
  no_text: "OCR found no readable text",
  unavailable: "OCR unavailable",
  failed: "OCR failed"
};

const retryableOcrStatuses = new Set(["failed", "unavailable"]);

function renderSubmissionOcrEvidence(submission, { onRetryOcr = () => {} } = {}) {
  const ocr = submission?.ocrEvidence ?? {};
  const status = ocr.status || "not_requested";
  const container = document.createElement("section");
  container.className = `submission-ocr submission-ocr-${status}`;
  container.setAttribute("aria-label", "OCR text evidence");

  const heading = document.createElement("h5");
  heading.textContent = "OCR text check";
  container.append(heading);

  const statusLine = document.createElement("p");
  statusLine.className = "submission-ocr-status";
  const provider = ocr.provider ? ` via ${ocr.provider}` : "";
  const checkedAt = ocr.checkedAt ? ` - checked ${formatAccessTime(ocr.checkedAt)}` : "";
  statusLine.textContent = `${ocrStatusLabels[status] || status}${provider}${checkedAt}`;
  container.append(statusLine);

  if (ocr.error) {
    const error = document.createElement("p");
    error.className = "submission-ocr-error";
    error.textContent = ocr.error;
    container.append(error);
  }

  const keywords = Array.isArray(ocr.keywords) ? ocr.keywords : [];
  if (keywords.length > 0) {
    const keywordList = document.createElement("div");
    keywordList.className = "submission-ocr-keywords";
    keywords.forEach((keyword) => {
      const chip = document.createElement("span");
      chip.className = "submission-ocr-keyword";
      chip.textContent = keyword.label || keyword.matchedText || keyword.id;
      keywordList.append(chip);
    });
    container.append(keywordList);
  }

  const openingHoursHints = Array.isArray(ocr.openingHoursHints) ? ocr.openingHoursHints : [];
  if (openingHoursHints.length > 0) {
    const list = document.createElement("ul");
    list.className = "submission-ocr-opening-hours";
    openingHoursHints.slice(0, 4).forEach((hint) => {
      const item = document.createElement("li");
      item.textContent = hint.text || String(hint);
      list.append(item);
    });
    container.append(list);
  }

  if (ocr.text) {
    const text = document.createElement("p");
    text.className = "submission-ocr-text";
    text.textContent = ocr.text;
    container.append(text);
  }

  if (submission?.id && retryableOcrStatuses.has(status)) {
    const retryButton = document.createElement("button");
    retryButton.className = "outline-button submission-ocr-retry";
    retryButton.type = "button";
    retryButton.textContent = "Retry OCR";
    retryButton.addEventListener("click", () => onRetryOcr(submission, retryButton));
    container.append(retryButton);
  }

  return container;
}

function renderNearbyApprovedToilets(submission) {
  const container = document.createElement("section");
  container.className = "submission-nearby";
  container.setAttribute("aria-label", "Nearby approved toilets");

  const heading = document.createElement("h5");
  heading.textContent = "Nearby approved toilets";
  container.append(heading);

  const nearbyToilets = Array.isArray(submission?.nearbyApprovedToilets)
    ? submission.nearbyApprovedToilets
    : [];
  if (nearbyToilets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "submission-nearby-empty";
    const radiusMetres = Math.max(1, Math.round(Number(submission?.nearbyRadiusMetres) || 750));
    empty.textContent = `None found within ${radiusMetres} m.`;
    container.append(empty);
    return container;
  }

  const list = document.createElement("ul");
  list.className = "submission-nearby-list";
  nearbyToilets.forEach((toilet) => {
    const item = document.createElement("li");
    item.className = "submission-nearby-item";

    const details = document.createElement("div");
    details.className = "submission-nearby-details";

    const name = document.createElement("strong");
    name.textContent = toilet.name || "Unnamed toilet";

    const distance = document.createElement("span");
    const distanceMetres = Math.max(0, Math.round(Number(toilet.distanceMetres) || 0));
    distance.className = distanceMetres <= 100
      ? "submission-nearby-distance is-close"
      : "submission-nearby-distance";
    distance.textContent = distanceMetres <= 100
      ? `${distanceMetres} m away - check for duplicate`
      : `${distanceMetres} m away`;

    const location = document.createElement("span");
    location.className = "submission-nearby-location";
    location.textContent = `${toilet.area || "Unknown area"} - ${Number(toilet.lat).toFixed(5)}, ${Number(toilet.lng).toFixed(5)}`;

    details.append(name, distance, location);
    item.append(
      details,
      createExternalMapLink("View on map", getOpenStreetMapUrl(toilet.lat, toilet.lng))
    );
    list.append(item);
  });

  container.append(list);
  return container;
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
  { onReviewSubmission = () => {}, onRetryOcr = () => {}, openSubmissionIds = new Set() } = {}
) {
  if (!submissionsContainer) return;

  submissionsContainer.textContent = "";

  if (!Array.isArray(submissions) || submissions.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No pending submissions.";
    submissionsContainer.append(empty);
    return;
  }

  submissions.forEach((submission, index) => {
    const title = submission.name || "Unnamed toilet";
    const subtitle = `${submission.area || "Unknown area"} - ${Number(submission.lat).toFixed(5)}, ${Number(submission.lng).toFixed(5)}`;
    const metaText = getSubmissionMeta(submission);
    const summaryText = `${getSubmissionFeatureSummary(submission)} - ${getSubmissionHoursSummary(submission)}`;

    const heading = document.createElement("h4");
    heading.textContent = title;

    const area = document.createElement("p");
    area.className = "submission-review-area";
    area.textContent = subtitle;

    const meta = document.createElement("p");
    meta.className = "submission-review-meta";
    meta.textContent = metaText;

    const note = document.createElement("p");
    note.className = "submission-review-note";
    note.textContent = submission.comment || "No note provided.";

    const details = document.createElement("p");
    details.className = "submission-review-details";
    details.textContent = summaryText;

    const evidence = renderSubmissionEvidence(submission, { onRetryOcr });
    const locationChecks = renderSubmissionLocationChecks(submission);
    const nearbyToilets = renderNearbyApprovedToilets(submission);

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
    const item = createReviewDisclosure({
      panelId: createReviewPanelId("toilet-submission-review", submission.id, index),
      reviewId: String(submission.id),
      title,
      subtitle,
      meta: metaText,
      summary: summaryText,
      bodyLabel: `Review details for ${title}`,
      detailNodes: [heading, area, meta, note, details, evidence, locationChecks, nearbyToilets, actions],
      expanded: openSubmissionIds.has(String(submission.id))
    });
    submissionsContainer.append(item);
  });
}

const reportIssueLabels = {
  missing: "Toilet is not here",
  location: "Wrong location",
  features: "Wrong features",
  hours: "Wrong opening hours",
  other: "Other problem"
};

function getReportIssueSummary(report) {
  const summary = (report?.issueTypes ?? [])
    .map((issue) => reportIssueLabels[issue] ?? issue)
    .join(", ");
  return summary || "No issue type supplied";
}

function formatReportOpeningTimes(openingTimes) {
  if (!Array.isArray(openingTimes)) return null;
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return openingTimes.map((slot, index) => {
    if (slot === null) return `${labels[index]} Unknown`;
    if (!Array.isArray(slot) || slot.length < 2) return `${labels[index]} Closed`;
    return `${labels[index]} ${slot[0]}-${slot[1]}`;
  }).join("; ");
}

function getReportChangeLines(report) {
  const changes = report?.proposedChanges ?? {};
  const lines = [];
  if (Number.isFinite(Number(changes.lat)) && Number.isFinite(Number(changes.lng))) {
    lines.push(`Move marker to ${Number(changes.lat).toFixed(5)}, ${Number(changes.lng).toFixed(5)}`);
  }
  if (changes.features && typeof changes.features === "object") {
    const featureText = Object.entries(changes.features)
      .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${value}`)
      .join(", ");
    lines.push(`Features: ${featureText}`);
  }
  const hoursText = formatReportOpeningTimes(changes.openingTimes);
  if (hoursText) lines.push(`Hours: ${hoursText}`);
  return lines;
}

export function renderToiletReports(
  reportsContainer,
  reports,
  { onReviewReport = () => {} } = {}
) {
  if (!reportsContainer) return;
  reportsContainer.textContent = "";

  if (!Array.isArray(reports) || reports.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No pending reports.";
    reportsContainer.append(empty);
    return;
  }

  reports.forEach((report, index) => {
    const title = report.toiletName || "Unknown toilet";
    const location = report.currentLocation
      ? ` - ${Number(report.currentLocation.lat).toFixed(5)}, ${Number(report.currentLocation.lng).toFixed(5)}`
      : "";
    const subtitle = `${report.toiletArea || "Unknown area"}${location}`;
    const reporter = report.reportedByUsername || "Unknown user";
    const createdAt = report.createdAt ? formatAccessTime(report.createdAt) : "Unknown time";
    const metaText = `Reported by ${reporter} - ${createdAt}`;
    const issueSummary = getReportIssueSummary(report);
    const existenceSummary = `Toilet exists here: ${report.toiletExists || "unsure"}`;

    const heading = document.createElement("h4");
    heading.textContent = title;

    const area = document.createElement("p");
    area.className = "submission-review-area";
    area.textContent = subtitle;

    const meta = document.createElement("p");
    meta.className = "submission-review-meta";
    meta.textContent = metaText;

    const issues = document.createElement("p");
    issues.className = "submission-review-details";
    issues.textContent = issueSummary;

    const existence = document.createElement("p");
    existence.className = "submission-review-details";
    existence.textContent = existenceSummary;

    const note = document.createElement("p");
    note.className = "submission-review-note";
    note.textContent = report.details || "No additional details.";

    const changeLines = getReportChangeLines(report);
    const changeList = document.createElement("ul");
    changeList.className = "toilet-report-change-list";
    if (changeLines.length === 0) {
      const line = document.createElement("li");
      line.textContent = "No structured correction supplied.";
      changeList.append(line);
    } else {
      changeLines.forEach((change) => {
        const line = document.createElement("li");
        line.textContent = change;
        changeList.append(line);
      });
    }

    const actions = document.createElement("div");
    actions.className = "submission-review-actions";

    const applyButton = document.createElement("button");
    applyButton.className = "solid-button";
    applyButton.type = "button";
    applyButton.textContent = "Apply correction";
    applyButton.disabled = changeLines.length === 0;
    applyButton.addEventListener("click", () => onReviewReport(report, "apply", applyButton));

    const removeButton = document.createElement("button");
    removeButton.className = "danger-button";
    removeButton.type = "button";
    removeButton.textContent = "Remove toilet";
    removeButton.addEventListener("click", () => onReviewReport(report, "remove", removeButton));

    const rejectButton = document.createElement("button");
    rejectButton.className = "outline-button";
    rejectButton.type = "button";
    rejectButton.textContent = "Dismiss";
    rejectButton.addEventListener("click", () => onReviewReport(report, "reject", rejectButton));

    actions.append(applyButton, removeButton, rejectButton);
    const item = createReviewDisclosure({
      panelId: createReviewPanelId("toilet-report-review", report.id, index),
      title,
      subtitle,
      meta: metaText,
      summary: `${issueSummary} - ${existenceSummary}`,
      bodyLabel: `Report details for ${title}`,
      detailNodes: [heading, area, meta, issues, existence, note, changeList, actions]
    });
    reportsContainer.append(item);
  });
}
