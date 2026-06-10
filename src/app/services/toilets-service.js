import { appConfig } from "../config/app-config.js";
import { fetchJson } from "./http-client.js";

const toiletsApiCacheTtlMs = 2 * 60 * 1000;
const toiletDetailCacheTtlMs = 5 * 60 * 1000;
let toiletsApiCache = new Map();
let toiletDetailCache = new Map();

function getBoundsCacheKey(bounds) {
  if (!bounds) return "all";

  const minLat = Number(bounds.minLat);
  const maxLat = Number(bounds.maxLat);
  const minLng = Number(bounds.minLng);
  const maxLng = Number(bounds.maxLng);

  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return "all";

  return [minLat, maxLat, minLng, maxLng]
    .map((value) => value.toFixed(5))
    .join(",");
}

function getToiletsApiCacheKey(cleanlinessRange, bounds) {
  return `${String(cleanlinessRange || "3days")}::${getBoundsCacheKey(bounds)}`;
}

function getToiletDetailCacheKey(toiletId, cleanlinessRange = "all") {
  return `${String(toiletId)}::${String(cleanlinessRange || "all")}`;
}

export function getCachedToiletsFromApi(cleanlinessRange = "3days", bounds = null) {
  const cacheKey = getToiletsApiCacheKey(cleanlinessRange, bounds);
  const cached = toiletsApiCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.loadedAt > toiletsApiCacheTtlMs) {
    toiletsApiCache = new Map(toiletsApiCache);
    toiletsApiCache.delete(cacheKey);
    return null;
  }

  return [...cached.toilets];
}

export function clearToiletsApiCache() {
  toiletsApiCache = new Map();
}

export function clearToiletDetailCache(toiletId = null) {
  if (!toiletId) {
    toiletDetailCache = new Map();
    return;
  }

  const prefix = `${String(toiletId)}::`;
  toiletDetailCache = new Map(
    [...toiletDetailCache].filter(([cacheKey]) => !String(cacheKey).startsWith(prefix))
  );
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
  const cacheKey = getToiletDetailCacheKey(toiletId, cleanlinessRange);
  const cached = toiletDetailCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.loadedAt > toiletDetailCacheTtlMs) {
    toiletDetailCache = new Map(toiletDetailCache);
    toiletDetailCache.delete(cacheKey);
    return null;
  }

  return cloneToilet(cached.toilet);
}

export async function loadToiletsFromApi(
  cleanlinessRange = "3days",
  retryCount = 2,
  timeoutMs = 30000,
  bounds = null,
  { force = false } = {}
) {
  const cacheKey = getToiletsApiCacheKey(cleanlinessRange, bounds);
  if (!force) {
    const cachedToilets = getCachedToiletsFromApi(cleanlinessRange, bounds);
    if (cachedToilets) {
      return cachedToilets;
    }
  }

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
        toiletsApiCache = new Map(toiletsApiCache);
        toiletsApiCache.set(cacheKey, {
          toilets: [...payload.toilets],
          loadedAt: Date.now()
        });
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
  if (!force) {
    const cached = getCachedToiletDetail(toiletId, cleanlinessRange);
    if (cached) return cached;
  }

  const safeRange = String(cleanlinessRange || "all");
  let url = `${appConfig.apiBasePath}/toilets/detail?toiletId=${encodeURIComponent(toiletId)}`;
  if (safeRange !== "all") {
    url += `&cleanlinessRange=${encodeURIComponent(safeRange)}`;
  }

  const payload = await fetchJson(url);
  if (payload.toilet?.id) {
    const cacheKey = getToiletDetailCacheKey(toiletId, safeRange);
    toiletDetailCache = new Map(toiletDetailCache);
    toiletDetailCache.set(cacheKey, {
      toilet: cloneToilet(payload.toilet),
      loadedAt: Date.now()
    });
  }
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

export async function submitComment(toiletId, commentText, media = [], commentVisibility = "real", cleanlinessRating) {
  const payload = await fetchJson(`${appConfig.apiBasePath}/comments`, {
    method: "POST",
    body: JSON.stringify({ toiletId, commentText, media, commentVisibility, cleanlinessRating })
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
