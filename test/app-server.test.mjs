import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAppServer } from "../server/app-server.mjs";
import { sampleToiletsCsv } from "../test-fixtures/seed-csv.mjs";

async function withAppServer(callback) {
  const rootDirectory = await mkdtemp(join(tmpdir(), "wheretoi-server-test-"));
  const dataDirectory = join(rootDirectory, "src", "data");
  let appServer;

  try {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(join(dataDirectory, "toilets.csv"), sampleToiletsCsv, "utf8");

    appServer = await createAppServer({ rootDirectory, port: 0 });
    const port = await appServer.listen("127.0.0.1");
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await appServer?.close?.();
    await rm(rootDirectory, { recursive: true, force: true });
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();

  assert.equal(response.ok, true, `Expected ${url} to return 2xx.`);
  return payload;
}

test("API exposes health and expanded toilet feature details", async () => {
  await withAppServer(async (baseUrl) => {
    const health = await fetchJson(`${baseUrl}/api/health`);
    const toiletsPayload = await fetchJson(`${baseUrl}/api/toilets`);
    const detailToilet = toiletsPayload.toilets.find((toilet) => toilet.id === "detail-test");

    assert.equal(health.status, "ok");
    assert.equal(detailToilet.features.children, "Y");
    assert.equal(detailToilet.features.babyChanging, "Y");
    assert.equal(detailToilet.features.bidet, "Y");
    assert.equal(detailToilet.features.free, "Y");
  });
});

test("API preserves accessible filtering and access-history write behavior", async () => {
  await withAppServer(async (baseUrl) => {
    const accessiblePayload = await fetchJson(`${baseUrl}/api/toilets?accessibleOnly=true`);
    assert.deepEqual(
      accessiblePayload.toilets.map((toilet) => toilet.id),
      ["detail-test"]
    );

    const posted = await fetchJson(`${baseUrl}/api/access-history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        toiletId: "detail-test",
        toiletName: "Prayer room washroom",
        eventType: "QR access",
        amountGbp: 0.5,
        useFreeTicket: true
      })
    });

    assert.equal(posted.history[0].toiletId, "detail-test");
    assert.equal(posted.history[0].eventType, "QR access");
    assert.equal(posted.account.monthlyFreeTicketsLeft, 2);
  });
});
