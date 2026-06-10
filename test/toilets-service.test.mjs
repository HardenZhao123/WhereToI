import assert from "node:assert/strict";
import test from "node:test";
import {
  clearToiletDetailCache,
  clearToiletsApiCache,
  fetchToiletDetail,
  getCachedToiletDetail,
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

test("toilets service defaults list requests to all-time cleanliness", async () => {
  const originalFetch = globalThis.fetch;
  clearToiletsApiCache();
  let requestedUrl = "";

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({ toilets: [createApiToilet("all-time-toilet")] })
    };
  };

  try {
    const toilets = await loadToiletsFromApi(undefined, 0, 1000);

    assert.equal(requestedUrl, "/api/toilets?cleanlinessRange=all");
    assert.equal(toilets[0].id, "all-time-toilet");
    assert.deepEqual(getCachedToiletsFromApi(), toilets);
  } finally {
    clearToiletsApiCache();
    globalThis.fetch = originalFetch;
  }
});

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

test("toilets service reuses cached toilet detail requests and supports force refresh", async () => {
  const originalFetch = globalThis.fetch;
  clearToiletDetailCache();
  let fetchCount = 0;

  globalThis.fetch = async (url) => {
    fetchCount += 1;
    assert.equal(String(url), "/api/toilets/detail?toiletId=detail-test");
    return {
      ok: true,
      json: async () => ({
        toilet: {
          id: "detail-test",
          name: `Detail load ${fetchCount}`,
          features: { accessible: "Y" },
          hours: { today: "Closed" },
          cleanlinessSurvey: { ratingTotal: fetchCount, ratingCount: 1 },
          openingTimes: [["09:00", "17:00"]]
        }
      })
    };
  };

  try {
    const firstDetail = await fetchToiletDetail("detail-test");
    const secondDetail = await fetchToiletDetail("detail-test");
    const forcedDetail = await fetchToiletDetail("detail-test", { force: true });

    assert.equal(fetchCount, 2);
    assert.equal(firstDetail.name, "Detail load 1");
    assert.equal(secondDetail.name, "Detail load 1");
    assert.equal(forcedDetail.name, "Detail load 2");
    assert.deepEqual(getCachedToiletDetail("detail-test"), forcedDetail);
  } finally {
    clearToiletDetailCache();
    globalThis.fetch = originalFetch;
  }
});

test("toilets service can invalidate cached detail entries for one toilet", async () => {
  const originalFetch = globalThis.fetch;
  clearToiletDetailCache();
  let fetchCount = 0;

  globalThis.fetch = async (url) => {
    fetchCount += 1;
    const searchParams = new URL(`http://localhost${String(url)}`).searchParams;
    const toiletId = searchParams.get("toiletId");
    const cleanlinessRange = searchParams.get("cleanlinessRange") ?? "all";

    return {
      ok: true,
      json: async () => ({
        toilet: {
          id: toiletId,
          name: `${toiletId} ${cleanlinessRange} load ${fetchCount}`,
          cleanlinessSurvey: { ratingTotal: fetchCount, ratingCount: 1 }
        }
      })
    };
  };

  try {
    await fetchToiletDetail("detail-test", { cleanlinessRange: "1day" });
    await fetchToiletDetail("detail-test", { cleanlinessRange: "3days" });
    const otherDetail = await fetchToiletDetail("other-test", { cleanlinessRange: "3days" });

    clearToiletDetailCache("detail-test");

    assert.equal(getCachedToiletDetail("detail-test", "1day"), null);
    assert.equal(getCachedToiletDetail("detail-test", "3days"), null);
    assert.deepEqual(getCachedToiletDetail("other-test", "3days"), otherDetail);
  } finally {
    clearToiletDetailCache();
    globalThis.fetch = originalFetch;
  }
});
