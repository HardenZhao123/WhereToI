import { appConfig } from "../config/app-config.js";
import { parseCsv, rowsToObjects } from "../utils/csv.js";
import { mapRecordToToilet } from "../toilets/toilet-record-mapper.js";
import { fetchJson } from "./http-client.js";

const toiletsApiCacheTtlMs = 2 * 60 * 1000;
let toiletsApiCache = new Map();

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

export async function loadToiletsFromCsv() {
  const response = await fetch(appConfig.csvDataPath);
  if (!response.ok) {
    throw new Error(`CSV request failed with status ${response.status}`);
  }

  const csvContent = await response.text();
  const rows = parseCsv(csvContent);
  const records = rowsToObjects(rows);
  return records.map(mapRecordToToilet).filter(Boolean);
}

export async function fetchToiletDetail(toiletId) {
  const payload = await fetchJson(`${appConfig.apiBasePath}/toilets/detail?toiletId=${encodeURIComponent(toiletId)}`);
  return payload.toilet;
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
