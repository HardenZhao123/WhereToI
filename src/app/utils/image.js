const DEFAULT_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 700 * 1024;
const DEFAULT_MAX_DIMENSION = 1280;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    }, { once: true });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read this image. Choose a JPEG, PNG, or WebP photo."));
    }, { once: true });
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not compress this photo."));
      }
    }, "image/jpeg", quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(new Error("Could not prepare this photo.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

export async function compressEntrancePhoto(
  file,
  {
    maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    maxDimension = DEFAULT_MAX_DIMENSION
  } = {}
) {
  if (!(file instanceof Blob) || !String(file.type || "").startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  if (file.size > maxSourceBytes) {
    throw new Error("Photo is too large. Choose an image smaller than 12 MB.");
  }

  const image = await loadImage(file);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  let scale = Math.min(1, maxDimension / Math.max(longestSide, 1));

  for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Photo compression is not supported on this device.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of [0.82, 0.7, 0.58]) {
      const blob = await canvasToBlob(canvas, quality);
      if (blob.size <= maxOutputBytes) {
        return {
          dataUrl: await blobToDataUrl(blob),
          mimeType: "image/jpeg",
          size: blob.size,
          width,
          height
        };
      }
    }

    scale *= 0.78;
  }

  throw new Error("Photo could not be compressed enough. Choose a smaller image.");
}
