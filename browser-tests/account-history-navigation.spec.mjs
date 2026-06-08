import { expect, test } from "@playwright/test";

const leafletStub = `
(() => {
  const callbacks = new Map();
  function createMap() {
    let center = { lat: 51.4974, lng: -0.1751 };
    let zoom = 15;
    return {
      setView(nextCenter, nextZoom) {
        center = { lat: nextCenter[0], lng: nextCenter[1] };
        zoom = nextZoom ?? zoom;
        return this;
      },
      on(eventNames, callback) {
        String(eventNames).split(/\\s+/).forEach((eventName) => {
          callbacks.set(eventName, callback);
        });
        return this;
      },
      flyTo(nextCenter, nextZoom) {
        center = Array.isArray(nextCenter)
          ? { lat: nextCenter[0], lng: nextCenter[1] }
          : { lat: nextCenter.lat, lng: nextCenter.lng };
        zoom = nextZoom ?? zoom;
        callbacks.get("moveend")?.();
        return this;
      },
      getCenter() {
        return center;
      },
      getBounds() {
        return {
          contains() {
            return true;
          }
        };
      },
      getZoom() {
        return zoom;
      },
      invalidateSize() {
        return this;
      }
    };
  }

  window.L = {
    map: createMap,
    tileLayer: () => ({ addTo: () => ({}) }),
    layerGroup: () => ({
      addTo() { return this; },
      clearLayers() {}
    }),
    divIcon: (options) => options,
    marker: (latLng) => {
      const marker = {
        latLng: { lat: latLng[0], lng: latLng[1] },
        addTo() { return marker; },
        on() { return marker; },
        remove() {},
        setIcon() { return marker; },
        setLatLng(nextLatLng) {
          marker.latLng = { lat: nextLatLng[0], lng: nextLatLng[1] };
          return marker;
        },
        getLatLng() {
          return marker.latLng;
        }
      };
      return marker;
    }
  };
})();
`;

function isExpectedLeafletStubResourceError(message) {
  return (
    message.includes("leaflet@1.9.4/dist/leaflet") ||
    message.includes("Failed to load resource: net::ERR_FAILED")
  );
}

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4173" });
  await context.setGeolocation({ latitude: 51.4974, longitude: -0.1751 });
  await page.addInitScript(leafletStub);

  await page.route("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", (route) =>
    route.fulfill({ contentType: "text/css", body: "" })
  );
  await page.route("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", (route) => route.abort());
  await page.route("https://*.basemaps.cartocdn.com/**", (route) =>
    route.fulfill({ status: 204, body: "" })
  );
});

test("clicking a visit history row opens the matching toilet detail card", async ({ page }, testInfo) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const toiletsResponse = await page.request.get("/api/toilets");
  expect(toiletsResponse.ok()).toBeTruthy();
  const { toilets } = await toiletsResponse.json();
  const targetToilet =
    toilets.find((toilet) => toilet?.id && /city\s*&?\s*guilds/i.test(toilet?.name ?? "")) ??
    toilets.find((toilet) => toilet?.id && toilet?.name && toilet.name !== "Unnamed toilet");
  expect(targetToilet).toBeTruthy();

  const loginResponse = await page.request.post("/api/login", {
    data: { username: "demo", password: "demo123" }
  });
  expect(loginResponse.ok()).toBeTruthy();

  const eventType = `Browser check ${Date.now()}`;
  const historyResponse = await page.request.post("/api/access-history", {
    data: {
      toiletId: targetToilet.id,
      toiletName: targetToilet.name,
      eventType,
      amountGbp: 0,
      useFreeTicket: false
    }
  });
  expect(historyResponse.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page).toHaveTitle("WhereToI");
  await expect(page.locator("#view-title")).toHaveText("Map");
  await page.waitForFunction(() => document.querySelectorAll("#toilet-results .toilet-result").length > 0);

  await page.locator("#account-tab").click();
  await expect(page.locator("#view-title")).toHaveText("Account");
  await expect(page.locator("#account-welcome")).toContainText("Welcome back, demo");

  await page.locator("#activity-history-tab").click();
  const historyItem = page.locator("#access-history-list .history-item", { hasText: targetToilet.name }).first();
  await expect(historyItem).toBeVisible();
  await expect(historyItem).toContainText(eventType);

  const beforeScreenshotPath = testInfo.outputPath("visit-history-before-click.png");
  await page.screenshot({ path: beforeScreenshotPath, fullPage: false });
  await testInfo.attach("visit-history-before-click", {
    path: beforeScreenshotPath,
    contentType: "image/png"
  });

  await historyItem.click();
  await expect(page.locator("#view-title")).toHaveText("Map");
  await expect(page.locator("#details-card")).toBeVisible();
  await expect(page.locator("#toilet-name")).toHaveText(targetToilet.name);

  const afterScreenshotPath = testInfo.outputPath("toilet-detail-after-history-click.png");
  await page.screenshot({ path: afterScreenshotPath, fullPage: false });
  await testInfo.attach("toilet-detail-after-history-click", {
    path: afterScreenshotPath,
    contentType: "image/png"
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !isExpectedLeafletStubResourceError(message))).toEqual([]);
});
