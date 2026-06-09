import assert from "node:assert/strict";
import test from "node:test";
import {
  clearToiletsApiCache,
  getCachedToiletsFromApi,
  loadToiletsFromApi
} from "../src/app/services/toilets-service.js";

function createApiToilet(id = "cached-toilet") {
  return {
    id,
    name: "Cached toilet",
    area: "Test area",
    lat: 51.5,
    lng: -0.17
  };
}

test("toilets service reuses short-lived API cache for matching range and bounds", async () => {
  const originalFetch = globalThis.fetch;
  clearToiletsApiCache();

  const bounds = {
    minLat: 51.4,
    maxLat: 51.6,
    minLng: -0.2,
    maxLng: 0
  };
  let fetchCount = 0;

  globalThis.fetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      json: async () => ({ toilets: [createApiToilet(`toilet-${fetchCount}`)] })
    };
  };

  try {
    const firstLoad = await loadToiletsFromApi("3days", 0, 1000, bounds);
    const secondLoad = await loadToiletsFromApi("3days", 0, 1000, bounds);

    assert.equal(fetchCount, 1);
    assert.equal(firstLoad[0].id, "toilet-1");
    assert.deepEqual(secondLoad, firstLoad);
    assert.deepEqual(getCachedToiletsFromApi("3days", bounds), firstLoad);
  } finally {
    clearToiletsApiCache();
    globalThis.fetch = originalFetch;
  }
});

test("toilets service keeps period and bounds cache entries separate and supports force refresh", async () => {
  const originalFetch = globalThis.fetch;
  clearToiletsApiCache();

  const southBounds = {
    minLat: 51.4,
    maxLat: 51.6,
    minLng: -0.2,
    maxLng: 0
  };
  const northBounds = {
    minLat: 52.4,
    maxLat: 52.6,
    minLng: -0.2,
    maxLng: 0
  };
  let fetchCount = 0;

  globalThis.fetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      json: async () => ({ toilets: [createApiToilet(`toilet-${fetchCount}`)] })
    };
  };

  try {
    const southThreeDays = await loadToiletsFromApi("3days", 0, 1000, southBounds);
    const southOneDay = await loadToiletsFromApi("1day", 0, 1000, southBounds);
    const northThreeDays = await loadToiletsFromApi("3days", 0, 1000, northBounds);
    const forcedSouthThreeDays = await loadToiletsFromApi("3days", 0, 1000, southBounds, { force: true });

    assert.equal(fetchCount, 4);
    assert.equal(southThreeDays[0].id, "toilet-1");
    assert.equal(southOneDay[0].id, "toilet-2");
    assert.equal(northThreeDays[0].id, "toilet-3");
    assert.equal(forcedSouthThreeDays[0].id, "toilet-4");
    assert.deepEqual(getCachedToiletsFromApi("3days", southBounds), forcedSouthThreeDays);
  } finally {
    clearToiletsApiCache();
    globalThis.fetch = originalFetch;
  }
});
