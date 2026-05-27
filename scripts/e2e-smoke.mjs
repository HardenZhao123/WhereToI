import { resolve } from "node:path";
import { createAppServer } from "../server/app-server.mjs";

const root = resolve(".");
const appServer = await createAppServer({ rootDirectory: root, port: 0 });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

let started = false;

try {
  const port = await appServer.listen("127.0.0.1");
  started = true;

  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await fetchJson(`${baseUrl}/api/health`);
  assert(health.status === "ok", "Health check must return status=ok.");

  const toiletsPayload = await fetchJson(`${baseUrl}/api/toilets`);
  assert(Array.isArray(toiletsPayload.toilets), "Toilets endpoint must return an array.");
  assert(toiletsPayload.toilets.length > 0, "Toilets endpoint must return at least one entry.");

  const accountBefore = await fetchJson(`${baseUrl}/api/account`);
  assert(typeof accountBefore.account?.walletBalanceGbp === "number", "Account endpoint must include wallet balance.");

  const eventType = `CI smoke ${Date.now()}`;
  const posted = await fetchJson(`${baseUrl}/api/access-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      toiletName: "CI Smoke Toilet",
      eventType,
      amountGbp: 0.0,
      useFreeTicket: false
    })
  });

  assert(Array.isArray(posted.history), "POST /api/access-history must return updated history array.");
  assert(posted.history.length > 0, "Updated history must not be empty.");
  assert(posted.history[0]?.eventType === eventType, "Latest history record should match the created test event.");

  const accountAfter = await fetchJson(`${baseUrl}/api/account`);
  assert(Array.isArray(accountAfter.history), "Account response must include history list.");
  assert(accountAfter.history.length > 0, "Account history should not be empty after write.");

  console.log("Local end-to-end smoke check passed.");
} finally {
  if (started) {
    await appServer.close();
  }
}
