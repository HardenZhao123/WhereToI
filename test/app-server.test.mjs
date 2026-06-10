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
  let appServer;

  try {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(join(rootDirectory, "index.html"), "<!doctype html><title>WhereToI</title>", "utf8");
    await writeFile(join(rootDirectory, "src", "styles.css"), ".map { color: green; }", "utf8");
    await writeFile(join(rootDirectory, "src", "large.js"), largeStaticScript, "utf8");
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

test("static assets use browser cache headers and Last-Modified validation", async () => {
  await withAppServer(async (baseUrl) => {
    const firstResponse = await fetch(`${baseUrl}/src/styles.css`);
    const lastModified = firstResponse.headers.get("last-modified");

    assert.equal(firstResponse.status, 200);
    assert.match(firstResponse.headers.get("cache-control"), /max-age=3600/);
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
        rootDirectory: appRoot
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

test("API cache headers keep mutable toilet and account data private", async () => {
  await withAppServer(async (baseUrl) => {
    const toiletsResponse = await fetch(`${baseUrl}/api/toilets`);
    assert.equal(toiletsResponse.status, 200);
    assert.equal(toiletsResponse.headers.get("cache-control"), "no-store");

    const detailResponse = await fetch(`${baseUrl}/api/toilets/detail?toiletId=detail-test`);
    assert.equal(detailResponse.status, 200);
    assert.equal(detailResponse.headers.get("cache-control"), "no-store");

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

test("API toggles one like per logged-in user for comments", async () => {
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

    const { payload: publicFetchedPayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`);
    assert.equal(publicFetchedPayload.comments[0].like_count, 1);
    assert.equal(publicFetchedPayload.comments[0].viewer_has_liked, false);

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
  });
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

test("API supports image comment attachments without returning base64 data", async () => {
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

    const media = [
      {
        type: "image",
        mimeType: "image/png",
        name: "door.png",
        size: 5,
        dataUrl: "data:image/png;base64,aW1hZ2U="
      },
      {
        type: "image",
        mimeType: "image/jpeg",
        name: "sink.jpg",
        size: 6,
        dataUrl: "data:image/jpeg;base64,aW1hZ2Uy"
      }
    ];

    const { payload: mediaPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Photo and queue evidence",
        cleanlinessRating: 4,
        media
      })
    });

    assert.equal(mediaPayload.comments.length, 1);
    assert.equal(mediaPayload.comments[0].media_type, "image");
    assert.equal(mediaPayload.comments[0].media_mime_type, "image/png");
    assert.equal(mediaPayload.comments[0].media_url, null);
    assert.deepEqual(mediaPayload.comments[0].media_attachments, [
      {
        type: "image",
        mimeType: "image/png",
        name: "door.png",
        size: 5,
        hasData: true
      },
      {
        type: "image",
        mimeType: "image/jpeg",
        name: "sink.jpg",
        size: 6,
        hasData: true
      }
    ]);
    assert.equal(JSON.stringify(mediaPayload).includes("data:image"), false);

    const { payload: mediaOnlyPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "  ",
        cleanlinessRating: 4.5,
        media: [media[0]]
      })
    });
    const mediaOnlyComment = mediaOnlyPayload.comments.find((comment) => comment.cleanliness_rating === 4.5);

    assert.ok(mediaOnlyComment);
    assert.equal(mediaOnlyComment.comment_text, "");
    assert.equal(mediaOnlyComment.media_type, "image");

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
    assert.match(emptyCommentPayload.error, /commentText or media is required/);

    const invalidResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Not media",
        cleanlinessRating: 4,
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

    const disabledVideoResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Video clip",
        cleanlinessRating: 4,
        media: {
          type: "video",
          mimeType: "video/mp4",
          name: "queue.mp4",
          size: 5,
          dataUrl: "data:video/mp4;base64,dmlkZW8="
        }
      })
    });
    const disabledVideoPayload = await disabledVideoResponse.json();

    assert.equal(disabledVideoResponse.status, 400);
    assert.match(disabledVideoPayload.error, /Unsupported comment media type/);

    const overImageLimitResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Too many images",
        cleanlinessRating: 4,
        media: Array.from({ length: 4 }, (_, index) => ({
          type: "image",
          mimeType: "image/png",
          name: `sink-${index}.png`,
          size: 5,
          dataUrl: "data:image/png;base64,aW1hZ2U="
        }))
      })
    });
    const overImageLimitPayload = await overImageLimitResponse.json();

    assert.equal(overImageLimitResponse.status, 400);
    assert.match(overImageLimitPayload.error, /at most 3 attachments/);
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

    const { payload: toiletsPayload } = await fetchJson(`${baseUrl}/api/toilets?cleanlinessRange=3days`);
    const refreshedToilet = toiletsPayload.toilets.find((toilet) => toilet.id === "detail-test");
    assert.equal(refreshedToilet.cleanlinessSurvey.ratingTotal, 4.5);
    assert.equal(refreshedToilet.cleanlinessSurvey.ratingCount, 1);
  }, { databaseOptions: { cleanlinessScoringModel: { type: "average" } } });
});
