import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAppServer } from "../server/app-server.mjs";
import { sampleToiletsCsv } from "../test-fixtures/seed-csv.mjs";

async function withAppServer(callback, serverOptions = {}) {
  const rootDirectory = await mkdtemp(join(tmpdir(), "wheretoi-server-test-"));
  const dataDirectory = join(rootDirectory, "src", "data");
  let appServer;

  try {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(join(dataDirectory, "toilets.csv"), sampleToiletsCsv, "utf8");

    appServer = await createAppServer({ rootDirectory, port: 0, ...serverOptions });
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
    assert.equal(detailToilet.features.children, "Y");
    assert.equal(detailToilet.features.babyChanging, "Y");
    assert.equal(detailToilet.features.bidet, "Y");
    assert.equal(detailToilet.features.free, "Y");
  });
});

test("API preserves accessible filtering and access-history write behavior", async () => {
  await withAppServer(async (baseUrl) => {
    const { payload: accessiblePayload } = await fetchJson(`${baseUrl}/api/toilets?accessibleOnly=true`);
    assert.deepEqual(
      accessiblePayload.toilets.map((toilet) => toilet.id),
      ["detail-test"]
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

    const { payload: initialPayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`);
    assert.equal(initialPayload.comments.length, 0);

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
        commentText: "Great experience!"
      })
    });

    assert.equal(postedPayload.comments.length, 1);
    assert.equal(postedPayload.comments[0].comment_text, "Great experience!");

    const { payload: fetchedPayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`);
    assert.deepEqual(fetchedPayload, postedPayload);
  });
});

test("API supports image and video comment attachments", async () => {
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

    const { payload: imagePayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Photo evidence",
        media: {
          type: "image",
          mimeType: "image/png",
          name: "door.png",
          size: 5,
          dataUrl: "data:image/png;base64,aW1hZ2U="
        }
      })
    });

    assert.equal(imagePayload.comments[0].media_type, "image");
    assert.equal(imagePayload.comments[0].media_mime_type, "image/png");

    const { payload: videoPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Queue clip",
        media: {
          type: "video",
          mimeType: "video/mp4",
          name: "queue.mp4",
          size: 5,
          dataUrl: "data:video/mp4;base64,dmlkZW8="
        }
      })
    });

    assert.equal(videoPayload.comments.length, 2);
    assert.equal(videoPayload.comments[0].media_type, "video");
    assert.equal(videoPayload.comments[0].media_mime_type, "video/mp4");
    assert.equal(videoPayload.comments[0].media_url, "data:video/mp4;base64,dmlkZW8=");

    const invalidResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Not media",
        media: {
          type: "file",
          mimeType: "application/pdf",
          name: "rules.pdf",
          size: 5,
          dataUrl: "data:application/pdf;base64,cGRm"
        }
      })
    });
    const invalidPayload = await invalidResponse.json();

    assert.equal(invalidResponse.status, 400);
    assert.match(invalidPayload.error, /Unsupported comment media type/);
  });
});

test("API records cleanliness survey as a star rating", async () => {
  await withAppServer(async (baseUrl) => {
    const { payload } = await fetchJson(`${baseUrl}/api/cleanliness-survey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toiletId: "detail-test",
        toiletName: "Prayer room washroom",
        rating: 5
      })
    });

    assert.equal(payload.toilet.id, "detail-test");
    assert.equal(payload.toilet.cleanliness, 5);
    assert.equal(payload.toilet.cleanlinessSurvey.ratingTotal, 5);
    assert.equal(payload.toilet.cleanlinessSurvey.ratingCount, 1);
  });
});
