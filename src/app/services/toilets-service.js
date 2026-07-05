import { appConfig } from "../config/app-config.js";
import { fetchJson } from "./http-client.js";

const TOILET_LIST_CACHE_TTL_MS = 30_000;
const TOILET_DETAIL_CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 40;
const toiletsCache = new Map();
const toiletDetailCache = new Map();
const pendingToiletLoads = new Map();
const pendingToiletDetailLoads = new Map();

function getBoundsCacheKey(bounds) {
  if (!bounds) return "all";
  return [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng]
    .map((value) => Number(value).toFixed(5))
    .join(":");
}

function getToiletsCacheKey(cleanlinessRange, bounds) {
  return `${cleanlinessRange}:${getBoundsCacheKey(bounds)}`;
}

function getToiletDetailCacheKey(toiletId, cleanlinessRange) {
  return `${toiletId}:${cleanlinessRange}`;
}

function getFreshCacheValue(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function setCacheValue(cache, key, value, ttlMs) {
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

export function getCachedToiletsFromApi(cleanlinessRange = "all", bounds = null) {
  const cached = getFreshCacheValue(
    toiletsCache,
    getToiletsCacheKey(String(cleanlinessRange || "all"), bounds)
  );
  return cached ? cached.map(cloneToilet) : null;
}

export function clearToiletsApiCache() {
  toiletsCache.clear();
}

export function clearToiletDetailCache(toiletId = null) {
  if (toiletId === null) {
    toiletDetailCache.clear();
    return;
  }

  const prefix = `${toiletId}:`;
  for (const key of toiletDetailCache.keys()) {
    if (key.startsWith(prefix)) {
      toiletDetailCache.delete(key);
    }
  }
}

export function submitToiletReport(payload) {
  return fetchJson(`${appConfig.apiBasePath}/toilets/report`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
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
  const cached = getFreshCacheValue(
    toiletDetailCache,
    getToiletDetailCacheKey(toiletId, String(cleanlinessRange || "all"))
  );
  return cached ? cloneToilet(cached) : null;
}

function isRetryableRequestError(error) {
  if (error?.name === "AbortError") return true;
  if (!Number.isInteger(error?.status)) return true;
  return [408, 425, 429, 500, 502, 503, 504].includes(error.status);
}

function getRetryDelayMs(error, attempt) {
  if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0) {
    return Math.min(error.retryAfterMs, 10_000);
  }

  const baseDelay = Math.min(1_000 * (2 ** attempt), 8_000);
  return Math.round(baseDelay * (0.75 + Math.random() * 0.5));
}

export async function loadToiletsFromApi(
  cleanlinessRange = "all",
  retryCount = 2,
  timeoutMs = 30000,
  bounds = null,
  { force = false, signal = null } = {}
) {
  const safeRange = String(cleanlinessRange || "all");
  const cacheKey = getToiletsCacheKey(safeRange, bounds);
  if (!force) {
    const cached = getCachedToiletsFromApi(safeRange, bounds);
    if (cached) return cached;
  }

  const pendingLoad = signal ? null : pendingToiletLoads.get(cacheKey);
  if (pendingLoad) {
    return (await pendingLoad).map(cloneToilet);
  }

  let url = `${appConfig.apiBasePath}/toilets?cleanlinessRange=${encodeURIComponent(safeRange)}`;

  if (bounds) {
    url += `&minLat=${bounds.minLat}&maxLat=${bounds.maxLat}&minLng=${bounds.minLng}&maxLng=${bounds.maxLng}`;
  }
  if (force) {
    url += "&refresh=1";
  }

  const loadPromise = (async () => {
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      if (signal?.aborted) {
        throw new DOMException("The request was aborted.", "AbortError");
      }

      const controller = new AbortController();
      const abortFromCaller = () => controller.abort();
      signal?.addEventListener?.("abort", abortFromCaller, { once: true });
      const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const payload = await fetchJson(url, {
          signal: controller.signal,
          cache: force ? "reload" : "default"
        });
        if (Array.isArray(payload.toilets)) {
          const toilets = payload.toilets.map(cloneToilet);
          setCacheValue(toiletsCache, cacheKey, toilets, TOILET_LIST_CACHE_TTL_MS);
          return toilets;
        }
      } catch (error) {
        if (signal?.aborted || attempt >= retryCount || !isRetryableRequestError(error)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, getRetryDelayMs(error, attempt)));
      } finally {
        globalThis.clearTimeout(timeoutId);
        signal?.removeEventListener?.("abort", abortFromCaller);
      }
    }

    throw new Error("Invalid toilets API response.");
  })();

  if (!signal) {
    pendingToiletLoads.set(cacheKey, loadPromise);
  }
  try {
    return (await loadPromise).map(cloneToilet);
  } finally {
    if (pendingToiletLoads.get(cacheKey) === loadPromise) {
      pendingToiletLoads.delete(cacheKey);
    }
  }
}

export async function fetchToiletDetail(toiletId, { force = false, cleanlinessRange = "all" } = {}) {
  const safeRange = String(cleanlinessRange || "all");
  const cacheKey = getToiletDetailCacheKey(toiletId, safeRange);
  if (!force) {
    const cached = getCachedToiletDetail(toiletId, safeRange);
    if (cached) return cached;
  }

  const pendingLoad = pendingToiletDetailLoads.get(cacheKey);
  if (pendingLoad) {
    return cloneToilet(await pendingLoad);
  }

  let url = `${appConfig.apiBasePath}/toilets/detail?toiletId=${encodeURIComponent(toiletId)}&cleanlinessRange=${encodeURIComponent(safeRange)}`;
  if (force) {
    url += "&refresh=1";
  }

  const loadPromise = fetchJson(url, { cache: force ? "reload" : "default" })
    .then((payload) => {
      const toilet = cloneToilet(payload.toilet);
      setCacheValue(toiletDetailCache, cacheKey, toilet, TOILET_DETAIL_CACHE_TTL_MS);
      return toilet;
    });

  pendingToiletDetailLoads.set(cacheKey, loadPromise);
  try {
    return cloneToilet(await loadPromise);
  } finally {
    if (pendingToiletDetailLoads.get(cacheKey) === loadPromise) {
      pendingToiletDetailLoads.delete(cacheKey);
    }
  }
}

export function submitCleanlinessSurvey(payload) {
  return fetchJson(`${appConfig.apiBasePath}/cleanliness-survey`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function submitToiletContribution(payload) {
  const result = await fetchJson(`${appConfig.apiBasePath}/toilets`, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  clearToiletsApiCache();
  if (result.toilet?.id) {
    clearToiletDetailCache(result.toilet.id);
  }

  return result.toilet ?? null;
}

export async function detectPeopleInToiletPhoto({ dataUrl, signal } = {}) {
  const payload = await fetchJson(`${appConfig.apiBasePath}/toilets/photo/person-detection`, {
    method: "POST",
    signal,
    body: JSON.stringify({ dataUrl })
  });

  return payload.personDetection ?? null;
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
