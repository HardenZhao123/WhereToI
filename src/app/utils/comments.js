export const commentLongTextMinLength = 120;
export const commentSortModes = new Set(["newest", "liked"]);
export const commentFilterKeys = new Set(["media", "long"]);

export function getCommentMediaAttachments(comment) {
  if (Array.isArray(comment?.media_attachments)) {
    return comment.media_attachments;
  }

  if (typeof comment?.media_attachments === "string" && comment.media_attachments.trim()) {
    try {
      const parsed = JSON.parse(comment.media_attachments);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }

  if (comment?.media_url && comment?.media_type && comment?.media_mime_type) {
    return [
      {
        type: comment.media_type,
        mimeType: comment.media_mime_type,
        name: comment.media_name,
        dataUrl: comment.media_url
      }
    ];
  }

  return [];
}

export function hasCommentMedia(comment) {
  return getCommentMediaAttachments(comment).length > 0;
}

export function isLongComment(comment, minimumLength = commentLongTextMinLength) {
  return String(comment?.comment_text ?? "").trim().length >= minimumLength;
}

export function normaliseCommentSortMode(sortMode) {
  return commentSortModes.has(sortMode) ? sortMode : "newest";
}

function getCommentTimestamp(comment) {
  const timestamp = Date.parse(comment?.created_at ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getCommentId(comment) {
  const id = Number(comment?.id ?? 0);
  return Number.isFinite(id) ? id : 0;
}

function getCommentLikeCount(comment) {
  const likeCount = Number(comment?.like_count ?? 0);
  return Number.isFinite(likeCount) ? Math.max(0, likeCount) : 0;
}

function compareByNewest(a, b) {
  return getCommentTimestamp(b) - getCommentTimestamp(a) || getCommentId(b) - getCommentId(a);
}

function compareByLikes(a, b) {
  return getCommentLikeCount(b) - getCommentLikeCount(a) || compareByNewest(a, b);
}

function getFilterList(filters) {
  if (filters instanceof Set) return [...filters];
  if (Array.isArray(filters)) return filters;
  return [];
}

function matchesCommentFilter(comment, filterKey) {
  if (filterKey === "media") return hasCommentMedia(comment);
  if (filterKey === "long") return isLongComment(comment);
  return true;
}

export function filterAndSortComments(comments, { sortMode = "newest", filters = [] } = {}) {
  const activeFilters = getFilterList(filters).filter((filterKey) => commentFilterKeys.has(filterKey));
  const filteredComments = (Array.isArray(comments) ? comments : [])
    .filter((comment) => activeFilters.every((filterKey) => matchesCommentFilter(comment, filterKey)));

  filteredComments.sort(normaliseCommentSortMode(sortMode) === "liked" ? compareByLikes : compareByNewest);
  return filteredComments;
}
