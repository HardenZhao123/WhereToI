export const commentMediaMaxBytes = 1 * 1024 * 1024;
export const commentMediaMaxAttachments = 3;
export const commentMediaMaxImages = 3;
export const commentMediaMaxVideos = 0;
export const commentMediaTypes = Object.freeze(["image"]);

export const commentMediaPolicy = Object.freeze({
  maxBytes: commentMediaMaxBytes,
  maxAttachments: commentMediaMaxAttachments,
  maxImages: commentMediaMaxImages,
  maxVideos: commentMediaMaxVideos,
  types: commentMediaTypes
});

export function getCommentMediaTypeFromMimeType(mimeType) {
  const safeMimeType = String(mimeType ?? "").toLowerCase();
  if (safeMimeType.startsWith("image/")) return "image";
  if (safeMimeType.startsWith("video/")) return "video";
  return null;
}

export function isSupportedCommentMediaType(mediaType) {
  return commentMediaTypes.includes(String(mediaType ?? "").toLowerCase());
}

export function getCommentMediaCounts(media = []) {
  return (Array.isArray(media) ? media : []).reduce(
    (counts, attachment) => {
      counts.total += 1;
      if (attachment?.type === "image") counts.images += 1;
      if (attachment?.type === "video") counts.videos += 1;
      return counts;
    },
    { total: 0, images: 0, videos: 0 }
  );
}

export function formatCommentMediaSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatCommentMediaMaxBytes() {
  const maxMegabytes = commentMediaMaxBytes / (1024 * 1024);
  return Number.isInteger(maxMegabytes) ? `${maxMegabytes} MB` : `${maxMegabytes.toFixed(1)} MB`;
}

export function getCommentMediaStatus(media = []) {
  const counts = getCommentMediaCounts(media);
  if (counts.total === 0) {
    return `Up to ${commentMediaMaxAttachments} image attachments.`;
  }

  return `${counts.total}/${commentMediaMaxAttachments} image attachments selected.`;
}

export function validateCommentMediaPolicy({ mediaType, fileSize, currentMedia = [] } = {}) {
  if (String(mediaType ?? "").toLowerCase() === "video" && commentMediaMaxVideos <= 0) {
    return { valid: false, reason: "videos-disabled" };
  }

  if (!isSupportedCommentMediaType(mediaType)) {
    return { valid: false, reason: "unsupported-type" };
  }

  const safeFileSize = Number(fileSize);
  if (Number.isFinite(safeFileSize) && safeFileSize > commentMediaMaxBytes) {
    return { valid: false, reason: "too-large" };
  }

  const counts = getCommentMediaCounts(currentMedia);
  if (counts.total >= commentMediaMaxAttachments) {
    return { valid: false, reason: "too-many-attachments" };
  }

  if (mediaType === "video" && counts.videos >= commentMediaMaxVideos) {
    return { valid: false, reason: "too-many-videos" };
  }

  if (mediaType === "image" && counts.images >= commentMediaMaxImages) {
    return { valid: false, reason: "too-many-images" };
  }

  return { valid: true };
}
