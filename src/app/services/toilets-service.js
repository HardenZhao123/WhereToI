import { appConfig } from "../config/app-config.js";
import { parseCsv, rowsToObjects } from "../utils/csv.js";
import { mapRecordToToilet } from "../toilets/toilet-record-mapper.js";
import { fetchJson } from "./http-client.js";

export async function loadToiletsFromApi() {
  const payload = await fetchJson(`${appConfig.apiBasePath}/toilets`);
  if (!Array.isArray(payload.toilets)) {
    throw new Error("Invalid toilets API response.");
  }

  return payload.toilets;
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

export async function submitComment(toiletId, commentText) {
  const payload = await fetchJson(`${appConfig.apiBasePath}/comments`, {
    method: "POST",
    body: JSON.stringify({ toiletId, commentText })
  });
  return payload.comments || [];
}
