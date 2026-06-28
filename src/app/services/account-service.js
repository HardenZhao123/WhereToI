import { appConfig } from "../config/app-config.js";
import { fetchJson } from "./http-client.js";

export function fetchAccountSnapshot() {
  return fetchJson(`${appConfig.apiBasePath}/account`);
}

export function fetchPublicProfile(userId) {
  return fetchJson(`${appConfig.apiBasePath}/public-profile?userId=${encodeURIComponent(userId)}`);
}

export function registerUser(payload) {
  return fetchJson(`${appConfig.apiBasePath}/register`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function loginUser(payload) {
  return fetchJson(`${appConfig.apiBasePath}/login`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function logoutUser() {
  return fetchJson(`${appConfig.apiBasePath}/logout`, {
    method: "POST"
  });
}

export function getCurrentUser() {
  return fetchJson(`${appConfig.apiBasePath}/me`);
}

export function updateUserProfile(payload) {
  return fetchJson(`${appConfig.apiBasePath}/me/profile`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateCommentProfileVisibility(commentId, profileVisibility) {
  return fetchJson(`${appConfig.apiBasePath}/account/comment-profile-visibility`, {
    method: "POST",
    body: JSON.stringify({ commentId, profileVisibility })
  });
}

export function recordAccessHistory(payload) {
  return fetchJson(`${appConfig.apiBasePath}/access-history`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function fetchToiletSubmissions(status = "pending") {
  return fetchJson(`${appConfig.apiBasePath}/admin/toilet-submissions?status=${encodeURIComponent(status)}`);
}

export function reviewToiletSubmission(payload) {
  return fetchJson(`${appConfig.apiBasePath}/admin/toilet-submissions/review`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function retryToiletSubmissionOcr(toiletId) {
  return fetchJson(`${appConfig.apiBasePath}/admin/toilet-submissions/ocr/retry`, {
    method: "POST",
    body: JSON.stringify({ toiletId })
  });
}

export function fetchToiletReports(status = "pending") {
  return fetchJson(`${appConfig.apiBasePath}/admin/toilet-reports?status=${encodeURIComponent(status)}`);
}

export function reviewToiletReport(payload) {
  return fetchJson(`${appConfig.apiBasePath}/admin/toilet-reports/review`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
