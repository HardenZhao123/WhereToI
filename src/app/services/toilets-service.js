import { appConfig } from "../config/app-config.js";
import { parseCsv, rowsToObjects } from "../utils/csv.js";
import { mapRecordToToilet } from "../toilets/toilet-record-mapper.js";
import { fetchJson } from "./http-client.js";

export async function loadToiletsFromApi(cleanlinessRange = "3days", retryCount = 2, timeoutMs = 30000) {
  const url = `${appConfig.apiBasePath}/toilets?cleanlinessRange=${encodeURIComponent(cleanlinessRange)}`;

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

export async function submitComment(toiletId, commentText, media = [], commentVisibility = "real") {
  const payload = await fetchJson(`${appConfig.apiBasePath}/comments`, {
    method: "POST",
    body: JSON.stringify({ toiletId, commentText, media, commentVisibility })
  });
  return payload.comments || [];
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
