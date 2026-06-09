import {
  commentMediaMaxAttachments,
  commentMediaMaxImages,
  commentMediaMaxVideos,
  formatCommentMediaMaxBytes,
  formatCommentMediaSize,
  getCommentMediaStatus,
  getCommentMediaTypeFromMimeType,
  validateCommentMediaPolicy
} from "../../shared/comment-media-policy.js";

export {
  formatCommentMediaSize,
  getCommentMediaStatus
};

function createCommentMediaId() {
  return `comment-media-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCommentMediaPolicyError(reason, file) {
  if (reason === "too-large") {
    return `${file?.name || "This file"} is over ${formatCommentMediaMaxBytes()}.`;
  }

  if (reason === "videos-disabled") {
    return "Video attachments are disabled for now.";
  }

  if (reason === "too-many-attachments") {
    return `You can attach up to ${commentMediaMaxAttachments} files total.`;
  }

  if (reason === "too-many-videos") {
    return `You can attach up to ${commentMediaMaxVideos} videos.`;
  }

  if (reason === "too-many-images") {
    return `You can attach up to ${commentMediaMaxImages} images.`;
  }

  return `${file?.name || "This file"} is not a supported image attachment.`;
}

export function validateCommentMediaFile(file, selectedMedia = []) {
  const mediaType = getCommentMediaTypeFromMimeType(file?.type);
  if (!mediaType) {
    return { error: `${file?.name || "This file"} is not a supported image attachment.` };
  }

  const result = validateCommentMediaPolicy({
    mediaType,
    fileSize: file?.size,
    currentMedia: selectedMedia
  });

  if (!result.valid) {
    return { error: getCommentMediaPolicyError(result.reason, file) };
  }

  return { mediaType };
}

export function addCommentMediaFiles({
  files = [],
  selectedMedia = [],
  createObjectUrl = (file) => URL.createObjectURL(file),
  createId = createCommentMediaId
} = {}) {
  let nextSelectedMedia = [...selectedMedia];
  let statusMessage = "";

  for (const file of Array.from(files ?? [])) {
    const { mediaType, error } = validateCommentMediaFile(file, nextSelectedMedia);
    if (error) {
      statusMessage = error;
      continue;
    }

    nextSelectedMedia = [
      ...nextSelectedMedia,
      {
        id: createId(),
        file,
        type: mediaType,
        previewUrl: createObjectUrl(file)
      }
    ];
  }

  return {
    selectedMedia: nextSelectedMedia,
    statusMessage: statusMessage || getCommentMediaStatus(nextSelectedMedia)
  };
}

export function revokeCommentMediaPreview(media) {
  if (media?.previewUrl) {
    URL.revokeObjectURL(media.previewUrl);
  }
}

export function clearCommentMediaSelections(selectedMedia = []) {
  selectedMedia.forEach(revokeCommentMediaPreview);
  return [];
}

export function removeCommentMediaSelectionById(selectedMedia = [], mediaId) {
  const removedMedia = selectedMedia.find((media) => media.id === mediaId);
  revokeCommentMediaPreview(removedMedia);
  return selectedMedia.filter((media) => media.id !== mediaId);
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(new Error("Could not read selected file.")));
    reader.readAsDataURL(file);
  });
}

export async function readCommentMediaAttachments(selectedMedia = []) {
  return Promise.all(
    selectedMedia.map(async (media) => ({
      type: media.type,
      mimeType: media.file.type,
      name: media.file.name,
      size: media.file.size,
      dataUrl: await readFileAsDataUrl(media.file)
    }))
  );
}
