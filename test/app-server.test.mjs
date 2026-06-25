import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAppServer } from "../server/app-server.mjs";
import { sampleToiletsCsv } from "../test-fixtures/seed-csv.mjs";

const largeStaticScript = `export const payload = "${"x".repeat(4096)}";`;

async function withAppServer(callback, serverOptions = {}) {
  const rootDirectory = await mkdtemp(join(tmpdir(), "wheretoi-server-test-"));
  const dataDirectory = join(rootDirectory, "src", "data");
  const assetsDirectory = join(rootDirectory, "src", "assets");
  let appServer;

  try {
    await mkdir(dataDirectory, { recursive: true });
    await mkdir(assetsDirectory, { recursive: true });
    await writeFile(join(rootDirectory, "index.html"), "<!doctype html><title>WhereToI</title>", "utf8");
    await writeFile(join(rootDirectory, "app.webmanifest"), '{"name":"WhereToI"}', "utf8");
    await writeFile(join(rootDirectory, "src", "styles.css"), ".map { color: green; }", "utf8");
    await writeFile(join(rootDirectory, "src", "large.js"), largeStaticScript, "utf8");
    await writeFile(join(assetsDirectory, "signup-intro.mp4"), "fake mp4", "utf8");
    await writeFile(join(dataDirectory, "toilets.csv"), sampleToiletsCsv, "utf8");

    const { databaseOptions = {}, ...appServerOptions } = serverOptions;
    appServer = await createAppServer({
      rootDirectory,
      port: 0,
      ...appServerOptions,
      databaseOptions: {
        enableDemoAccount: true,
        ...databaseOptions
      }
    });
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

  assert.equal(response.ok, true, `Expected ${url} to return 2xx. Status: ${response.status}`);
  return { payload, response };
}

test("API exposes health and expanded toilet feature details", async () => {
  await withAppServer(async (baseUrl) => {
    const { payload: health } = await fetchJson(`${baseUrl}/api/health`);
    const { payload: toiletsPayload } = await fetchJson(`${baseUrl}/api/toilets`);
    const detailToilet = toiletsPayload.toilets.find((toilet) => toilet.id === "detail-test");

    assert.equal(health.status, "ok");
    assert.equal(health.database, "sqlite");
    assert.equal(detailToilet.features.children, "Y");
    assert.equal(detailToilet.features.babyChanging, "Y");
    assert.equal(detailToilet.features.bidet, "Y");
    assert.equal(detailToilet.features.free, "Y");
  });
});

test("API supports Capacitor iOS origins with credentialed CORS", async () => {
  await withAppServer(async (baseUrl) => {
    const origin = "capacitor://localhost";
    const preflightResponse = await fetch(`${baseUrl}/api/toilets`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Content-Type"
      }
    });

    assert.equal(preflightResponse.status, 204);
    assert.equal(preflightResponse.headers.get("access-control-allow-origin"), origin);
    assert.equal(preflightResponse.headers.get("access-control-allow-credentials"), "true");
    assert.match(preflightResponse.headers.get("access-control-allow-methods"), /GET/);

    const toiletsResponse = await fetch(`${baseUrl}/api/toilets`, {
      headers: { Origin: origin }
    });

    assert.equal(toiletsResponse.status, 200);
    assert.equal(toiletsResponse.headers.get("access-control-allow-origin"), origin);
    assert.equal(toiletsResponse.headers.get("access-control-allow-credentials"), "true");
    assert.match(toiletsResponse.headers.get("vary"), /Origin/);
  });
});

test("native-origin login cookies are compatible with cross-origin Capacitor requests", async () => {
  await withAppServer(async (baseUrl) => {
    const origin = "capacitor://localhost";
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin
      },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const setCookie = loginResponse.headers.get("set-cookie");

    assert.equal(loginResponse.status, 200);
    assert.equal(loginResponse.headers.get("access-control-allow-origin"), origin);
    assert.match(setCookie, /SameSite=None/);
    assert.match(setCookie, /Secure/);
  });
});

test("static app code revalidates and supports Last-Modified validation", async () => {
  await withAppServer(async (baseUrl) => {
    const firstResponse = await fetch(`${baseUrl}/src/styles.css`);
    const lastModified = firstResponse.headers.get("last-modified");
    const videoResponse = await fetch(`${baseUrl}/src/assets/signup-intro.mp4`);
    const manifestResponse = await fetch(`${baseUrl}/app.webmanifest`);

    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.headers.get("cache-control"), "no-cache, max-age=0, must-revalidate");
    assert.equal(videoResponse.status, 200);
    assert.equal(videoResponse.headers.get("content-type"), "video/mp4");
    assert.equal(manifestResponse.status, 200);
    assert.equal(manifestResponse.headers.get("content-type"), "application/manifest+json; charset=utf-8");
    assert.equal(manifestResponse.headers.get("cache-control"), "no-cache, max-age=0, must-revalidate");
    assert.ok(lastModified);
    assert.equal(await firstResponse.text(), ".map { color: green; }");

    const cachedResponse = await fetch(`${baseUrl}/src/styles.css`, {
      headers: {
        "If-Modified-Since": lastModified
      }
    });

    assert.equal(cachedResponse.status, 304);
    assert.equal(await cachedResponse.text(), "");
  });
});

test("development static assets disable browser caching", async () => {
  await withAppServer(async (baseUrl) => {
    const firstResponse = await fetch(`${baseUrl}/src/styles.css`);
    const lastModified = firstResponse.headers.get("last-modified");

    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.headers.get("cache-control"), "no-store");
    assert.ok(lastModified);

    const revalidatedResponse = await fetch(`${baseUrl}/src/styles.css`, {
      headers: {
        "If-Modified-Since": lastModified
      }
    });

    assert.equal(revalidatedResponse.status, 200);
    assert.equal(await revalidatedResponse.text(), ".map { color: green; }");
  }, { staticCacheMode: "development" });
});

test("static text assets are compressed when the browser supports gzip", async () => {
  await withAppServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/src/large.js`, {
      headers: {
        "Accept-Encoding": "gzip"
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.match(response.headers.get("vary"), /Accept-Encoding/);
    assert.equal(await response.text(), largeStaticScript);
  });
});

test("server can serve dist static files while keeping source data private", async () => {
  const appRoot = await mkdtemp(join(tmpdir(), "wheretoi-dist-server-test-"));
  const staticRoot = join(appRoot, "dist");
  const staticSrcDirectory = join(staticRoot, "src");
  const dataDirectory = join(appRoot, "src", "data");
  let appServer;

  try {
    await mkdir(staticSrcDirectory, { recursive: true });
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(join(staticRoot, "index.html"), "<!doctype html><title>WhereToI production</title>", "utf8");
    await writeFile(join(staticSrcDirectory, "styles.css"), ".production { color: green; }", "utf8");
    await writeFile(join(dataDirectory, "toilets.csv"), sampleToiletsCsv, "utf8");

    appServer = await createAppServer({
      rootDirectory: staticRoot,
      port: 0,
      databaseOptions: {
        rootDirectory: appRoot,
        enableDemoAccount: true
      }
    });
    const port = await appServer.listen("127.0.0.1");
    const baseUrl = `http://127.0.0.1:${port}`;

    const staticResponse = await fetch(`${baseUrl}/src/styles.css`);
    assert.equal(staticResponse.status, 200);
    assert.equal(await staticResponse.text(), ".production { color: green; }");

    const csvResponse = await fetch(`${baseUrl}/src/data/toilets.csv`);
    assert.equal(csvResponse.status, 404);

    const { payload: detailPayload } = await fetchJson(`${baseUrl}/api/toilets/detail?toiletId=detail-test`);
    assert.equal(detailPayload.toilet.id, "detail-test");
    assert.equal(detailPayload.toilet.name, "Prayer room washroom");
  } finally {
    await appServer?.close?.();
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("API cache headers briefly cache public toilets and keep account data private", async () => {
  await withAppServer(async (baseUrl) => {
    const toiletsResponse = await fetch(`${baseUrl}/api/toilets`);
    assert.equal(toiletsResponse.status, 200);
    assert.equal(toiletsResponse.headers.get("cache-control"), "public, max-age=10, stale-while-revalidate=20");

    const detailResponse = await fetch(`${baseUrl}/api/toilets/detail?toiletId=detail-test`);
    assert.equal(detailResponse.status, 200);
    assert.equal(detailResponse.headers.get("cache-control"), "public, max-age=10, stale-while-revalidate=20");

    const { response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginRes.headers.get("set-cookie");

    assert.equal(loginRes.headers.get("cache-control"), "no-store");

    const accountResponse = await fetch(`${baseUrl}/api/account`, {
      headers: { "Cookie": cookie }
    });

    assert.equal(accountResponse.status, 200);
    assert.equal(accountResponse.headers.get("cache-control"), "no-store");
  });
});

test("API exposes toilet details on demand", async () => {
  await withAppServer(async (baseUrl) => {
    const toiletId = "detail-test";
    const { payload: detailPayload } = await fetchJson(`${baseUrl}/api/toilets/detail?toiletId=${toiletId}`);

    assert.equal(detailPayload.toilet.id, toiletId);
    assert.equal(detailPayload.toilet.features.children, "Y");
    assert.equal(detailPayload.toilet.comment, "Comment: Muslim toilet available");
    assert.deepEqual(detailPayload.toilet.openingTimes, [["09:00", "17:00"], [], [], [], [], [], []]);

    const { payload: recentPayload } = await fetchJson(`${baseUrl}/api/toilets/detail?toiletId=${toiletId}&cleanlinessRange=1day`);
    assert.equal(recentPayload.toilet.id, toiletId);
    assert.equal(recentPayload.toilet.cleanliness, null);
    assert.equal(recentPayload.toilet.cleanlinessSurvey.ratingCount, 0);
  });
});

test("API accepts logged-in missing toilet submissions and rejects nearby duplicates", async () => {
  await withAppServer(async (baseUrl) => {
    const contribution = {
      name: "New station toilet",
      area: "Gloucester Road",
      lat: 51.512,
      lng: -0.188,
      comment: "Beside the ticket hall",
      features: {
        women: "Y",
        men: "Y",
        accessible: "Y",
        free: "Y"
      },
      openingTimes: [
        ["08:00", "20:00"],
        ["08:00", "20:00"],
        ["08:00", "20:00"],
        ["08:00", "20:00"],
        ["08:00", "20:00"],
        ["10:00", "18:00"],
        null
      ]
    };

    const anonymousResponse = await fetch(`${baseUrl}/api/toilets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contribution)
    });
    const anonymousPayload = await anonymousResponse.json();

    assert.equal(anonymousResponse.status, 401);
    assert.equal(anonymousPayload.error, "Log in to add a missing toilet.");

    const { response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginRes.headers.get("set-cookie");
    const authHeaders = {
      "Content-Type": "application/json",
      "Cookie": cookie
    };

    const { payload: createdPayload, response: createdResponse } = await fetchJson(`${baseUrl}/api/toilets`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(contribution)
    });

    assert.equal(createdResponse.status, 201);
    assert.match(createdPayload.toilet.id, /^user-/);
    assert.equal(createdPayload.toilet.submissionStatus, "pending");
    assert.equal(createdPayload.status, "pending");
    assert.equal(createdPayload.toilet.name, "New station toilet");
    assert.equal(createdPayload.toilet.features.accessible, "Y");
    assert.equal(createdPayload.toilet.features.free, "Y");

    const pendingDetailResponse = await fetch(`${baseUrl}/api/toilets/detail?toiletId=${createdPayload.toilet.id}`);
    const pendingDetailPayload = await pendingDetailResponse.json();
    assert.equal(pendingDetailResponse.status, 404);
    assert.equal(pendingDetailPayload.error, "Toilet not found.");

    const { payload: publicListBeforeApproval } = await fetchJson(`${baseUrl}/api/toilets?refresh=1`);
    assert.equal(
      publicListBeforeApproval.toilets.some((toilet) => toilet.id === createdPayload.toilet.id),
      false
    );

    const { payload: pendingSubmissionsPayload } = await fetchJson(`${baseUrl}/api/admin/toilet-submissions`, {
      headers: { "Cookie": cookie }
    });
    assert.equal(
      pendingSubmissionsPayload.submissions.some((submission) => submission.id === createdPayload.toilet.id),
      true
    );

    const { payload: approvedPayload } = await fetchJson(`${baseUrl}/api/admin/toilet-submissions/review`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId: createdPayload.toilet.id,
        status: "approved"
      })
    });
    assert.equal(approvedPayload.submission.submissionStatus, "approved");

    const { payload: detailPayload } = await fetchJson(
      `${baseUrl}/api/toilets/detail?toiletId=${createdPayload.toilet.id}&refresh=1`
    );
    assert.equal(detailPayload.toilet.comment, "Comment: Beside the ticket hall");
    assert.deepEqual(detailPayload.toilet.openingTimes[5], ["10:00", "18:00"]);
    assert.equal(detailPayload.toilet.openingTimes[6], null);
    assert.equal(detailPayload.toilet.hours.sun, "Sun Unknown");

    const { payload: publicListAfterApproval } = await fetchJson(`${baseUrl}/api/toilets?refresh=1`);
    assert.equal(
      publicListAfterApproval.toilets.some((toilet) => toilet.id === createdPayload.toilet.id),
      true
    );

    const duplicateResponse = await fetch(`${baseUrl}/api/toilets`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        ...contribution,
        name: "Duplicate station toilet",
        lat: contribution.lat + 0.00001,
        lng: contribution.lng + 0.00001
      })
    });
    const duplicatePayload = await duplicateResponse.json();

    assert.equal(duplicateResponse.status, 409);
    assert.match(duplicatePayload.error, /already on the map/);
  });
});

test("API accepts toilet reports and lets admins apply corrections", async () => {
  await withAppServer(async (baseUrl) => {
    const reportPayload = {
      toiletId: "detail-test",
      issueTypes: ["features", "hours"],
      toiletExists: "yes",
      details: "Accessible access is unavailable and Sunday hours are unknown.",
      proposedChanges: {
        features: {
          women: "Y",
          men: "Y",
          accessible: "N",
          neutral: "Y",
          children: "Y",
          babyChanging: "Y",
          bidet: "Y",
          automatic: "N",
          urinalOnly: "N",
          radarKey: "N",
          free: "Y"
        },
        openingTimes: [
          ["09:00", "17:00"],
          [],
          [],
          [],
          [],
          [],
          null
        ]
      }
    };

    const anonymousResponse = await fetch(`${baseUrl}/api/toilets/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportPayload)
    });
    assert.equal(anonymousResponse.status, 401);

    const { response: loginResponse } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginResponse.headers.get("set-cookie");
    const authHeaders = {
      "Content-Type": "application/json",
      "Cookie": cookie
    };

    const { payload: created, response: createResponse } = await fetchJson(
      `${baseUrl}/api/toilets/report`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(reportPayload)
      }
    );
    assert.equal(createResponse.status, 201);
    assert.equal(created.report.status, "pending");

    const { payload: pending } = await fetchJson(`${baseUrl}/api/admin/toilet-reports`, {
      headers: { "Cookie": cookie }
    });
    assert.equal(pending.reports.some((report) => report.id === created.report.id), true);

    const { payload: reviewed } = await fetchJson(`${baseUrl}/api/admin/toilet-reports/review`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        reportId: created.report.id,
        action: "apply"
      })
    });
    assert.equal(reviewed.report.status, "applied");

    const { payload: detail } = await fetchJson(
      `${baseUrl}/api/toilets/detail?toiletId=detail-test&refresh=1`
    );
    assert.equal(detail.toilet.features.accessible, "N");
    assert.equal(detail.toilet.features.radarKey, "N");
    assert.equal(detail.toilet.hours.sun, "Sun Unknown");
  });
});

test("API restricts toilet submission review to admins", async () => {
  await withAppServer(async (baseUrl) => {
    const anonymousResponse = await fetch(`${baseUrl}/api/admin/toilet-submissions`);
    const anonymousPayload = await anonymousResponse.json();

    assert.equal(anonymousResponse.status, 401);
    assert.equal(anonymousPayload.error, "Not authenticated");

    const username = `review-non-admin-${Date.now()}`;
    const password = "demo123";
    await fetchJson(`${baseUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${username}@example.com`,
        username,
        password
      })
    });

    const { response: loginResponse } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const cookie = loginResponse.headers.get("set-cookie");

    const forbiddenResponse = await fetch(`${baseUrl}/api/admin/toilet-submissions`, {
      headers: { "Cookie": cookie }
    });
    const forbiddenPayload = await forbiddenResponse.json();

    assert.equal(forbiddenResponse.status, 403);
    assert.equal(forbiddenPayload.error, "Admin access required.");
  });
});

test("API preserves accessible filtering and access-history write behavior", async () => {
  await withAppServer(async (baseUrl) => {
    const { payload: accessiblePayload } = await fetchJson(`${baseUrl}/api/toilets?accessibleOnly=true`);
    assert.deepEqual(
      accessiblePayload.toilets.map((toilet) => toilet.id),
      ["detail-test", "extra-test-1", "extra-test-2", "extra-test-3", "extra-test-4", "extra-test-5"]
    );

    // Login first
    const { response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginRes.headers.get("set-cookie");

    const { payload: posted } = await fetchJson(`${baseUrl}/api/access-history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        toiletId: "detail-test",
        toiletName: "Prayer room washroom",
        eventType: "Paid access",
        amountGbp: 0.5,
        useFreeTicket: true
      })
    });

    assert.equal(posted.history[0].toiletId, "detail-test");
    assert.equal(posted.history[0].eventType, "Paid access");
    assert.equal(posted.account.monthlyFreeTicketsLeft, 2);
  });
});

test("API registers a new user with an account and allows login", async () => {
  await withAppServer(async (baseUrl) => {
    const username = `new-user-${Date.now()}`;
    const password = "demo123";

    const { payload: registered } = await fetchJson(`${baseUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${username}@example.com`,
        username,
        password
      })
    });

    assert.equal(registered.user.username, username);

    const { response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const cookie = loginRes.headers.get("set-cookie");

    const { payload: accountPayload } = await fetchJson(`${baseUrl}/api/account`, {
      headers: { "Cookie": cookie }
    });

    assert.equal(accountPayload.account.walletBalanceGbp, 5);
    assert.deepEqual(accountPayload.history, []);
  });
});

test("API queues a registration confirmation email after account creation", async () => {
  const sentUsers = [];
  const emailService = {
    sendRegistrationSuccessEmail(user) {
      sentUsers.push(user);
      return Promise.resolve({ status: "sent" });
    }
  };

  await withAppServer(async (baseUrl) => {
    const username = `email-user-${Date.now()}`;
    const email = `${username}@example.com`;

    const { payload: registered } = await fetchJson(`${baseUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        username,
        password: "demo123"
      })
    });

    assert.equal(registered.user.username, username);
    assert.equal(sentUsers.length, 1);
    assert.equal(sentUsers[0].username, username);
    assert.equal(sentUsers[0].email, email);
  }, { emailService });
});

test("API registration still succeeds when confirmation email sending fails", async () => {
  const loggedErrors = [];
  const emailService = {
    sendRegistrationSuccessEmail() {
      return Promise.reject(new Error("email provider unavailable"));
    }
  };
  const logger = {
    error(...args) {
      loggedErrors.push(args);
    }
  };

  await withAppServer(async (baseUrl) => {
    const username = `email-failure-user-${Date.now()}`;
    const password = "demo123";

    const { payload: registered } = await fetchJson(`${baseUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${username}@example.com`,
        username,
        password
      })
    });

    assert.equal(registered.user.username, username);

    const { response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    assert.match(loginRes.headers.get("set-cookie"), /session=/);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedErrors[0][0], "Registration confirmation email failed:");
  }, { emailService, logger });
});

test("API supports fetching and posting toilet comments", async () => {
  await withAppServer(async (baseUrl) => {
    const toiletId = "detail-test";

    const { payload: initialPayload, response: initialResponse } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`);
    assert.equal(initialResponse.headers.get("cache-control"), "no-store");
    assert.equal(initialPayload.comments.length, 0);

    const anonymousCommentResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toiletId,
        commentText: "Anonymous comment should not save."
      })
    });
    const anonymousCommentPayload = await anonymousCommentResponse.json();

    assert.equal(anonymousCommentResponse.status, 401);
    assert.equal(anonymousCommentPayload.error, "Log in to post comments.");

    const { payload: afterAnonymousPayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`);
    assert.equal(afterAnonymousPayload.comments.length, 0);

    // Login first
    const { response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginRes.headers.get("set-cookie");

    const { payload: postedPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        toiletId,
        commentText: "Great experience!",
        commentVisibility: "real",
        cleanlinessRating: 4
      })
    });

    assert.equal(postedPayload.comments.length, 1);
    assert.equal(postedPayload.comments[0].comment_text, "Great experience!");
    assert.equal(postedPayload.comments[0].cleanliness_rating, 4);
    assert.equal(postedPayload.comments[0].author_name, "demo");
    assert.equal(postedPayload.comments[0].username, "demo");
    assert.equal(postedPayload.comments[0].comment_visibility, "real");
    assert.equal(postedPayload.comments[0].is_anonymous, false);
    assert.equal(postedPayload.comments[0].can_delete, true);
    assert.deepEqual(postedPayload.comments[0].media_attachments, []);

    await fetchJson(`${baseUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "other-comment-user",
        password: "demo123",
        email: "other-comment-user@example.com"
      })
    });
    const { response: otherLoginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "other-comment-user", password: "demo123" })
    });
    const otherCookie = otherLoginRes.headers.get("set-cookie");
    const anonymousToiletId = "limited-test";

    const { payload: anonymousPostedPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": otherCookie
      },
      body: JSON.stringify({
        toiletId: anonymousToiletId,
        commentText: "Posting without my username.",
        commentVisibility: "anonymous",
        cleanlinessRating: 2
      })
    });

    assert.equal(anonymousPostedPayload.comments.length, 1);
    assert.equal(anonymousPostedPayload.comments[0].comment_text, "Posting without my username.");
    assert.equal(anonymousPostedPayload.comments[0].cleanliness_rating, 2);
    assert.equal(anonymousPostedPayload.comments[0].author_name, "Anonymous");
    assert.equal(anonymousPostedPayload.comments[0].username, "Anonymous");
    assert.equal(anonymousPostedPayload.comments[0].comment_visibility, "anonymous");
    assert.equal(anonymousPostedPayload.comments[0].is_anonymous, true);
    assert.equal(anonymousPostedPayload.comments[0].can_delete, true);
    assert.equal(anonymousPostedPayload.comments[0].user_id, null);

    const { payload: publicFetchedPayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`);
    assert.equal(publicFetchedPayload.comments[0].can_delete, false);

    const { payload: fetchedPayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`, {
      headers: { "Cookie": cookie }
    });
    assert.deepEqual(fetchedPayload.comments, postedPayload.comments);
    assert.equal(postedPayload.toilet.id, toiletId);
    assert.equal(postedPayload.toilet.cleanlinessSurvey.ratingCount, 1);

    const sceneSnapshot = {
      version: 2,
      toiletId,
      toiletName: "Detail test toilet",
      fixtures: {
        wall: [{ id: "wall-feces-1", dirtId: "feces", x: 260, y: 160 }],
        toilet: [
          { id: "toilet-stain-1", dirtId: "stain", x: 140, y: 230 },
          { id: "toilet-urine-2", dirtId: "urine", x: 185, y: 240 }
        ],
        urinal: [{ id: "urinal-hair-3", dirtId: "hair", x: 410, y: 252 }],
        sink: [],
        floor: [{ id: "floor-tissue-4", dirtId: "tissue", x: 690, y: 420 }]
      }
    };
    const { payload: scenePostedPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": otherCookie
      },
      body: JSON.stringify({
        toiletId,
        commentText: "",
        commentVisibility: "real",
        cleanlinessRating: 3.5,
        sceneSnapshot
      })
    });
    const sceneComment = scenePostedPayload.comments.find((comment) => comment.cleanliness_rating === 3.5);
    assert.ok(sceneComment);
    assert.equal(sceneComment.comment_text, "");
    assert.deepEqual(sceneComment.scene_snapshot.fixtures, sceneSnapshot.fixtures);

    const { payload: publicScenePayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`);
    assert.deepEqual(
      publicScenePayload.comments.find((comment) => comment.cleanliness_rating === 3.5).scene_snapshot.fixtures,
      sceneSnapshot.fixtures
    );

    const deleteWithoutLoginResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toiletId: anonymousToiletId,
        commentId: anonymousPostedPayload.comments[0].id
      })
    });
    const deleteWithoutLoginPayload = await deleteWithoutLoginResponse.json();

    assert.equal(deleteWithoutLoginResponse.status, 401);
    assert.equal(deleteWithoutLoginPayload.error, "Log in to delete comments.");

    const deleteOtherUserResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        toiletId: anonymousToiletId,
        commentId: anonymousPostedPayload.comments[0].id
      })
    });
    const deleteOtherUserPayload = await deleteOtherUserResponse.json();

    assert.equal(deleteOtherUserResponse.status, 404);
    assert.equal(deleteOtherUserPayload.error, "Comment not found.");

    const { payload: deleteOwnerPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Cookie": otherCookie
      },
      body: JSON.stringify({
        toiletId: anonymousToiletId,
        commentId: anonymousPostedPayload.comments[0].id
      })
    });

    assert.equal(deleteOwnerPayload.comments.length, 0);
  });
});

test("API toggles mutually exclusive likes and dislikes for comments", async () => {
  await withAppServer(async (baseUrl) => {
    const toiletId = "detail-test";

    const { response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginRes.headers.get("set-cookie");

    const { payload: postedPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        toiletId,
        commentText: "This deserves likes",
        cleanlinessRating: 4
      })
    });
    const commentId = postedPayload.comments[0].id;

    const likeWithoutLoginResponse = await fetch(`${baseUrl}/api/comment-likes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toiletId, commentId })
    });
    const likeWithoutLoginPayload = await likeWithoutLoginResponse.json();

    assert.equal(likeWithoutLoginResponse.status, 401);
    assert.equal(likeWithoutLoginPayload.error, "Log in to like comments.");

    const dislikeWithoutLoginResponse = await fetch(`${baseUrl}/api/comment-dislikes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toiletId, commentId })
    });
    const dislikeWithoutLoginPayload = await dislikeWithoutLoginResponse.json();

    assert.equal(dislikeWithoutLoginResponse.status, 401);
    assert.equal(dislikeWithoutLoginPayload.error, "Log in to dislike comments.");

    const { payload: likedPayload } = await fetchJson(`${baseUrl}/api/comment-likes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({ toiletId, commentId })
    });

    assert.equal(likedPayload.liked, true);
    assert.equal(likedPayload.comments[0].like_count, 1);
    assert.equal(likedPayload.comments[0].viewer_has_liked, true);
    assert.equal(likedPayload.comments[0].dislike_count, 0);
    assert.equal(likedPayload.comments[0].viewer_has_disliked, false);

    const { payload: publicFetchedPayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`);
    assert.equal(publicFetchedPayload.comments[0].like_count, 1);
    assert.equal(publicFetchedPayload.comments[0].viewer_has_liked, false);

    const { payload: dislikedPayload } = await fetchJson(`${baseUrl}/api/comment-dislikes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({ toiletId, commentId })
    });

    assert.equal(dislikedPayload.disliked, true);
    assert.equal(dislikedPayload.comments[0].like_count, 0);
    assert.equal(dislikedPayload.comments[0].viewer_has_liked, false);
    assert.equal(dislikedPayload.comments[0].dislike_count, 1);
    assert.equal(dislikedPayload.comments[0].viewer_has_disliked, true);

    const { payload: undislikedPayload } = await fetchJson(`${baseUrl}/api/comment-dislikes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({ toiletId, commentId })
    });

    assert.equal(undislikedPayload.disliked, false);
    assert.equal(undislikedPayload.comments[0].dislike_count, 0);
    assert.equal(undislikedPayload.comments[0].viewer_has_disliked, false);

    await fetchJson(`${baseUrl}/api/comment-likes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({ toiletId, commentId })
    });

    const { payload: unlikedPayload } = await fetchJson(`${baseUrl}/api/comment-likes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({ toiletId, commentId })
    });

    assert.equal(unlikedPayload.liked, false);
    assert.equal(unlikedPayload.comments[0].like_count, 0);
    assert.equal(unlikedPayload.comments[0].viewer_has_liked, false);

    const missingCommentResponse = await fetch(`${baseUrl}/api/comment-likes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({ toiletId, commentId: 99999 })
    });
    const missingCommentPayload = await missingCommentResponse.json();

    assert.equal(missingCommentResponse.status, 404);
    assert.equal(missingCommentPayload.error, "Comment not found.");

    const missingDislikeResponse = await fetch(`${baseUrl}/api/comment-dislikes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({ toiletId, commentId: 99999 })
    });
    const missingDislikePayload = await missingDislikeResponse.json();

    assert.equal(missingDislikeResponse.status, 404);
    assert.equal(missingDislikePayload.error, "Comment not found.");
  });
});

test("AI summary receives comment dislike counts from the database", async () => {
  const summarizedCommentSets = [];
  const aiService = {
    summarizeComments(comments) {
      summarizedCommentSets.push(comments);
      return Promise.resolve("Community-weighted summary");
    }
  };

  await withAppServer(async (baseUrl) => {
    const toiletId = "detail-test";
    const { response: loginResponse } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginResponse.headers.get("set-cookie");

    const { payload: postedPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        toiletId,
        commentText: "This claim should be marked as disputed.",
        cleanlinessRating: 4
      })
    });
    const commentId = postedPayload.comments[0].id;

    await fetchJson(`${baseUrl}/api/comment-dislikes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({ toiletId, commentId })
    });

    const { payload: summaryPayload } = await fetchJson(
      `${baseUrl}/api/toilets/summary?toiletId=${toiletId}`
    );

    assert.equal(summaryPayload.summary, "Community-weighted summary");
    assert.equal(summarizedCommentSets.length, 1);
    assert.equal(summarizedCommentSets[0][0].like_count, 0);
    assert.equal(summarizedCommentSets[0][0].dislike_count, 1);
  }, { aiService });
});

test("API exposes own comments in account and updates profile visibility", async () => {
  await withAppServer(async (baseUrl) => {
    const toiletId = "detail-test";

    const { response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginRes.headers.get("set-cookie");

    const { payload: postedPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        toiletId,
        commentText: "Account should show this comment",
        commentVisibility: "anonymous",
        cleanlinessRating: 3
      })
    });
    const commentId = postedPayload.comments[0].id;

    const { payload: accountPayload } = await fetchJson(`${baseUrl}/api/account`, {
      headers: { "Cookie": cookie }
    });

    assert.equal(accountPayload.comments.length, 1);
    assert.equal(accountPayload.comments[0].id, commentId);
    assert.equal(accountPayload.comments[0].toilet_name, "Prayer room washroom");
    assert.equal(accountPayload.comments[0].author_name, "Anonymous");
    assert.equal(accountPayload.comments[0].profile_visibility, "private");

    const anonymousUpdateResponse = await fetch(`${baseUrl}/api/account/comment-profile-visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId, profileVisibility: "public" })
    });
    const anonymousUpdatePayload = await anonymousUpdateResponse.json();

    assert.equal(anonymousUpdateResponse.status, 401);
    assert.equal(anonymousUpdatePayload.error, "Not authenticated");

    await fetchJson(`${baseUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "other-profile-user",
        password: "demo123",
        email: "other-profile-user@example.com"
      })
    });
    const { response: otherLoginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "other-profile-user", password: "demo123" })
    });
    const otherCookie = otherLoginRes.headers.get("set-cookie");

    const otherUpdateResponse = await fetch(`${baseUrl}/api/account/comment-profile-visibility`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": otherCookie
      },
      body: JSON.stringify({ commentId, profileVisibility: "public" })
    });
    const otherUpdatePayload = await otherUpdateResponse.json();

    assert.equal(otherUpdateResponse.status, 404);
    assert.equal(otherUpdatePayload.error, "Comment not found.");

    const { payload: updatedPayload } = await fetchJson(`${baseUrl}/api/account/comment-profile-visibility`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({ commentId, profileVisibility: "public" })
    });

    assert.equal(updatedPayload.comments.length, 1);
    assert.equal(updatedPayload.comments[0].profile_visibility, "public");
  });
});

test("API exposes public profiles without leaking anonymous or private comments", async () => {
  await withAppServer(async (baseUrl) => {
    const toiletId = "detail-test";
    const { payload: loginPayload, response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginRes.headers.get("set-cookie");
    const authHeaders = {
      "Content-Type": "application/json",
      "Cookie": cookie
    };

    await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId: "limited-test",
        commentText: "Real but private",
        commentVisibility: "real",
        cleanlinessRating: 3
      })
    });

    const { payload: publicRealPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Real and public",
        commentVisibility: "real",
        cleanlinessRating: 5
      })
    });
    const publicRealComment = publicRealPayload.comments.find((comment) => comment.comment_text === "Real and public");

    const { payload: anonymousPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId: "extra-test-1",
        commentText: "Anonymous but public",
        commentVisibility: "anonymous",
        cleanlinessRating: 2
      })
    });
    const anonymousComment = anonymousPayload.comments.find((comment) => comment.comment_text === "Anonymous but public");

    await fetchJson(`${baseUrl}/api/account/comment-profile-visibility`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ commentId: publicRealComment.id, profileVisibility: "public" })
    });
    await fetchJson(`${baseUrl}/api/account/comment-profile-visibility`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ commentId: anonymousComment.id, profileVisibility: "public" })
    });

    const { payload: publicProfilePayload } = await fetchJson(`${baseUrl}/api/public-profile?userId=${loginPayload.user.id}`);

    assert.deepEqual(Object.keys(publicProfilePayload.profile.user), ["id", "username"]);
    assert.equal(publicProfilePayload.profile.user.username, "demo");
    assert.equal(publicProfilePayload.profile.comments.length, 1);
    assert.equal(publicProfilePayload.profile.comments[0].comment_text, "Real and public");
    assert.equal(publicProfilePayload.profile.comments[0].comment_visibility, "real");
    assert.equal(publicProfilePayload.profile.comments[0].profile_visibility, "public");
    assert.equal(publicProfilePayload.profile.comments[0].is_anonymous, false);
    assert.equal(publicProfilePayload.profile.comments[0].can_delete, false);
    assert.equal(publicProfilePayload.profile.comments[0].cleanliness_rating, 5);
    assert.equal(publicProfilePayload.profile.comments[0].toilet_name, "Prayer room washroom");
  });
});

test("API rejects photo attachments on comment feedback", async () => {
  await withAppServer(async (baseUrl) => {
    const toiletId = "detail-test";

    const { response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginRes.headers.get("set-cookie");

    const authHeaders = {
      "Content-Type": "application/json",
      "Cookie": cookie
    };

    const mediaResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Photo evidence",
        cleanlinessRating: 4,
        media: [
          {
            type: "image",
            mimeType: "image/png",
            name: "door.png",
            size: 5,
            dataUrl: "data:image/png;base64,aW1hZ2U="
          }
        ]
      })
    });
    const mediaPayload = await mediaResponse.json();

    assert.equal(mediaResponse.status, 400);
    assert.match(mediaPayload.error, /Photo attachments are no longer supported/);

    const emptyCommentResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: " ",
        cleanlinessRating: 4
      })
    });
    const emptyCommentPayload = await emptyCommentResponse.json();

    assert.equal(emptyCommentResponse.status, 400);
    assert.match(emptyCommentPayload.error, /commentText or interactive scene is required/);
  });
});

test("API records cleanliness survey as a star rating", async () => {
  await withAppServer(async (baseUrl) => {
    const anonymousResponse = await fetch(`${baseUrl}/api/cleanliness-survey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toiletId: "detail-test",
        toiletName: "Prayer room washroom",
        rating: 4.5
      })
    });
    const anonymousPayload = await anonymousResponse.json();

    assert.equal(anonymousResponse.status, 401);
    assert.equal(anonymousPayload.error, "Log in to rate cleanliness.");

    const { response: loginRes } = await fetchJson(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "demo123" })
    });
    const cookie = loginRes.headers.get("set-cookie");

    const { payload } = await fetchJson(`${baseUrl}/api/cleanliness-survey`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        toiletId: "detail-test",
        toiletName: "Prayer room washroom",
        rating: 4.5
      })
    });

    assert.equal(payload.toilet.id, "detail-test");
    assert.equal(payload.toilet.cleanliness, 4.5);
    assert.equal(payload.toilet.cleanlinessSurvey.ratingTotal, 4.5);
    assert.equal(payload.toilet.cleanlinessSurvey.ratingCount, 1);

    const duplicateResponse = await fetch(`${baseUrl}/api/cleanliness-survey`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        toiletId: "detail-test",
        toiletName: "Prayer room washroom",
        rating: 2
      })
    });
    const duplicatePayload = await duplicateResponse.json();

    assert.equal(duplicateResponse.status, 429);
    assert.match(duplicatePayload.error, /rate this toilet again in 30 minutes/);
    assert.ok(Number(duplicateResponse.headers.get("retry-after")) > 0);

    const { payload: toiletsPayload } = await fetchJson(`${baseUrl}/api/toilets?cleanlinessRange=3days`);
    const refreshedToilet = toiletsPayload.toilets.find((toilet) => toilet.id === "detail-test");
    assert.equal(refreshedToilet.cleanlinessSurvey.ratingTotal, 4.5);
    assert.equal(refreshedToilet.cleanlinessSurvey.ratingCount, 1);
  }, { databaseOptions: { cleanlinessScoringModel: { type: "average" } } });
});
