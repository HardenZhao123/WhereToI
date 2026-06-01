import { appConfig } from "../config/app-config.js";
import { fetchJson } from "./http-client.js";

export function fetchAccountSnapshot() {
  return fetchJson(`${appConfig.apiBasePath}/account`);
}

export function saveAccessRecord(payload) {
  return fetchJson(`${appConfig.apiBasePath}/access-history`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
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
