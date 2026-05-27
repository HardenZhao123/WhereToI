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
