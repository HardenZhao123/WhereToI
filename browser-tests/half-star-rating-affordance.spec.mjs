import { expect, test } from "@playwright/test";

test("unrated cleanliness stars advertise half-star choices", async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    window.L = {
      map: () => ({
        setView() { return this; },
        flyTo() { return this; },
        on() { return this; },
        getBounds() { return { contains: () => true }; },
        getCenter() { return { lat: 51.4974, lng: -0.1751 }; },
        getZoom() { return 15; },
        invalidateSize() { return this; }
      }),
      tileLayer: () => ({ addTo() {} }),
      layerGroup: () => ({ addTo() { return this; }, clearLayers() {} }),
      divIcon: (options) => options,
      marker: (latLng) => ({
        addTo() { return this; },
        on() { return this; },
        remove() {},
        setIcon() { return this; },
        getLatLng() { return { lat: latLng[0], lng: latLng[1] }; }
      })
    };
  });
  await page.route("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", (route) =>
    route.fulfill({ contentType: "text/css", body: "" })
  );
  await page.route("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", (route) => route.abort());
  await page.route("https://*.basemaps.cartocdn.com/**", (route) => route.fulfill({ status: 204, body: "" }));

  const loginResponse = await page.request.post("/api/login", {
    data: { username: "demo", password: "demo123" }
  });
  expect(loginResponse.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page).toHaveTitle("WhereToI");
  if (await page.locator("#search-card").evaluate((element) => element.classList.contains("is-collapsed"))) {
    await page.locator("#toggle-search").click();
  }
  await expect(page.locator("#toilet-results .toilet-result").first()).toBeVisible();
  await page.locator("#toilet-results .toilet-result").first().click();
  await page.locator("#details-comment-link").click();
  await page.locator("#comment-composer-toggle").click();

  const stars = page.locator("#visual-cleanliness-stars");
  await expect(stars).toHaveClass(/is-unrated/);
  await expect(stars).toHaveAttribute("aria-label", /half-star and full-star choices/);

  const unratedStyles = await stars.locator(".visual-star-button").evaluateAll((buttons) =>
    buttons.map((button) => ({
      fillAmount: button.style.getPropertyValue("--star-fill"),
      pressed: button.getAttribute("aria-pressed"),
      darkHalf: getComputedStyle(button.querySelector(".visual-star-fill")).fill,
      lightHalf: getComputedStyle(button.querySelector(".visual-star-outline")).fill
    }))
  );
  expect(unratedStyles).toEqual(
    Array.from({ length: 5 }, () => ({
      fillAmount: "50%",
      pressed: "false",
      darkHalf: "rgb(123, 131, 126)",
      lightHalf: "rgb(217, 222, 219)"
    }))
  );

  const screenshotPath = testInfo.outputPath("unrated-half-star-affordance.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach("unrated-half-star-affordance", { path: screenshotPath, contentType: "image/png" });

  await stars.locator('[data-visual-rating="2.5"]').click();
  await expect(stars).not.toHaveClass(/is-unrated/);
  await expect(page.locator("#map-survey-status")).toContainText("Selected 2.5/5 stars");
  await expect(stars.locator('[data-visual-star="3"]')).toHaveCSS("--star-fill", "50%");
  expect(pageErrors).toEqual([]);
});
