import { appConfig } from "../config/app-config.js";
import { fetchJson } from "./http-client.js";

export function getCachedToiletsFromApi(cleanlinessRange = "all", bounds = null) {
  void cleanlinessRange;
  void bounds;
  return null;
}

export function clearToiletsApiCache() {
  // Client-side toilet list caching is disabled while feedback/rating behavior is iterating.
}

export function clearToiletDetailCache(toiletId = null) {
  void toiletId;
  // Client-side toilet detail caching is disabled while feedback/rating behavior is iterating.
}

function cloneToilet(toilet) {
  if (!toilet || typeof toilet !== "object") return toilet;

  return {
    ...toilet,
    features: toilet.features ? { ...toilet.features } : toilet.features,
    hours: toilet.hours ? { ...toilet.hours } : toilet.hours,
    cleanlinessSurvey: toilet.cleanlinessSurvey ? { ...toilet.cleanlinessSurvey } : toilet.cleanlinessSurvey,
    openingTimes: Array.isArray(toilet.openingTimes)
      ? toilet.openingTimes.map((day) => Array.isArray(day) ? [...day] : day)
      : toilet.openingTimes
  };
}

export function getCachedToiletDetail(toiletId, cleanlinessRange = "all") {
  void toiletId;
  void cleanlinessRange;
  return null;
}

export async function loadToiletsFromApi(
  cleanlinessRange = "all",
  retryCount = 2,
  timeoutMs = 30000,
  bounds = null,
  { force = false } = {}
) {
  void force;

  let url = `${appConfig.apiBasePath}/toilets?cleanlinessRange=${encodeURIComponent(cleanlinessRange)}`;

  if (bounds) {
    url += `&minLat=${bounds.minLat}&maxLat=${bounds.maxLat}&minLng=${bounds.minLng}&maxLng=${bounds.maxLng}`;
  }

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const payload = await fetchJson(url, { signal: controller.signal });
      if (Array.isArray(payload.toilets)) {
        return payload.toilets;
      }
    } catch (error) {
      if (attempt >= retryCount) {
        throw error;
      }
      // Wait 2 seconds before retrying (Render cold start can be slow)
      await new Promise(resolve => setTimeout(resolve, 2000));
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  throw new Error("Invalid toilets API response.");
}

export async function fetchToiletDetail(toiletId, { force = false, cleanlinessRange = "all" } = {}) {
  void force;

  const safeRange = String(cleanlinessRange || "all");
  let url = `${appConfig.apiBasePath}/toilets/detail?toiletId=${encodeURIComponent(toiletId)}`;
  if (safeRange !== "all") {
    url += `&cleanlinessRange=${encodeURIComponent(safeRange)}`;
  }

  const payload = await fetchJson(url);
  return cloneToilet(payload.toilet);
}

export function submitCleanlinessSurvey(payload) {
  return fetchJson(`${appConfig.apiBasePath}/cleanliness-survey`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchComments(toiletId) {
  const payload = await fetchJson(`${appConfig.apiBasePath}/comments?toiletId=${encodeURIComponent(toiletId)}`);
  return payload.comments || [];
}

export async function fetchAiSummary(toiletId) {
  const payload = await fetchJson(`${appConfig.apiBasePath}/toilets/summary?toiletId=${encodeURIComponent(toiletId)}`);
  return payload.summary;
}

export async function submitComment(
  toiletId,
  commentText,
  commentVisibility = "real",
  cleanlinessRating,
  sceneSnapshot = null
) {
  const payload = await fetchJson(`${appConfig.apiBasePath}/comments`, {
    method: "POST",
    body: JSON.stringify({ toiletId, commentText, commentVisibility, cleanlinessRating, sceneSnapshot })
  });
  return {
    comments: payload.comments || [],
    toilet: payload.toilet || null
  };
}

export async function deleteComment(toiletId, commentId) {
  const payload = await fetchJson(`${appConfig.apiBasePath}/comments`, {
    method: "DELETE",
    body: JSON.stringify({ toiletId, commentId })
  });
  return payload.comments || [];
}

export async function toggleCommentLike(toiletId, commentId) {
  const payload = await fetchJson(`${appConfig.apiBasePath}/comment-likes`, {
    method: "POST",
    body: JSON.stringify({ toiletId, commentId })
  });
  return payload.comments || [];
}

export async function toggleCommentDislike(toiletId, commentId) {
  const payload = await fetchJson(`${appConfig.apiBasePath}/comment-dislikes`, {
    method: "POST",
    body: JSON.stringify({ toiletId, commentId })
  });
  return payload.comments || [];
}
