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

    const { payload: initialPayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`);
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
        commentVisibility: "real"
      })
    });

    assert.equal(postedPayload.comments.length, 1);
    assert.equal(postedPayload.comments[0].comment_text, "Great experience!");
    assert.equal(postedPayload.comments[0].author_name, "demo");
    assert.equal(postedPayload.comments[0].username, "demo");
    assert.equal(postedPayload.comments[0].comment_visibility, "real");
    assert.equal(postedPayload.comments[0].is_anonymous, false);
    assert.equal(postedPayload.comments[0].can_delete, true);
    assert.deepEqual(postedPayload.comments[0].media_attachments, []);

    const { payload: anonymousPostedPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        toiletId,
        commentText: "Posting without my username.",
        commentVisibility: "anonymous"
      })
    });

    assert.equal(anonymousPostedPayload.comments.length, 2);
    assert.equal(anonymousPostedPayload.comments[0].comment_text, "Posting without my username.");
    assert.equal(anonymousPostedPayload.comments[0].author_name, "Anonymous");
    assert.equal(anonymousPostedPayload.comments[0].username, "Anonymous");
    assert.equal(anonymousPostedPayload.comments[0].comment_visibility, "anonymous");
    assert.equal(anonymousPostedPayload.comments[0].is_anonymous, true);
    assert.equal(anonymousPostedPayload.comments[0].can_delete, true);
    assert.equal(anonymousPostedPayload.comments[0].user_id, null);

    const { payload: publicFetchedPayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`);
    assert.equal(publicFetchedPayload.comments[0].can_delete, false);
    assert.equal(publicFetchedPayload.comments[1].can_delete, false);

    const { payload: fetchedPayload } = await fetchJson(`${baseUrl}/api/comments?toiletId=${toiletId}`, {
      headers: { "Cookie": cookie }
    });
    assert.deepEqual(fetchedPayload, anonymousPostedPayload);

    const deleteWithoutLoginResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toiletId,
        commentId: anonymousPostedPayload.comments[0].id
      })
    });
    const deleteWithoutLoginPayload = await deleteWithoutLoginResponse.json();

    assert.equal(deleteWithoutLoginResponse.status, 401);
    assert.equal(deleteWithoutLoginPayload.error, "Log in to delete comments.");

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

    const deleteOtherUserResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Cookie": otherCookie
      },
      body: JSON.stringify({
        toiletId,
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
        "Cookie": cookie
      },
      body: JSON.stringify({
        toiletId,
        commentId: anonymousPostedPayload.comments[0].id
      })
    });

    assert.equal(deleteOwnerPayload.comments.length, 1);
    assert.equal(deleteOwnerPayload.comments[0].comment_text, "Great experience!");
    assert.equal(deleteOwnerPayload.comments[0].can_delete, true);
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
        commentText: "This deserves likes"
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
        commentVisibility: "anonymous"
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
        toiletId,
        commentText: "Real but private",
        commentVisibility: "real"
      })
    });

    const { payload: publicRealPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Real and public",
        commentVisibility: "real"
      })
    });
    const publicRealComment = publicRealPayload.comments.find((comment) => comment.comment_text === "Real and public");

    const { payload: anonymousPayload } = await fetchJson(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Anonymous but public",
        commentVisibility: "anonymous"
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
    assert.equal(publicProfilePayload.profile.comments[0].toilet_name, "Prayer room washroom");
  });
});

test("API supports multiple image and video comment attachments", async () => {
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
        type: "video",
        mimeType: "video/mp4",
        name: "queue.mp4",
        size: 5,
        dataUrl: "data:video/mp4;base64,dmlkZW8="
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
        media
      })
    });

    assert.equal(mediaPayload.comments.length, 1);
    assert.equal(mediaPayload.comments[0].media_type, "image");
    assert.equal(mediaPayload.comments[0].media_mime_type, "image/png");
    assert.equal(mediaPayload.comments[0].media_url, "data:image/png;base64,aW1hZ2U=");
    assert.deepEqual(mediaPayload.comments[0].media_attachments, media);

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

    const overVideoLimitResponse = await fetch(`${baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        toiletId,
        commentText: "Too many clips",
        media: Array.from({ length: 4 }, (_, index) => ({
          type: "video",
          mimeType: "video/mp4",
          name: `queue-${index}.mp4`,
          size: 5,
          dataUrl: "data:video/mp4;base64,dmlkZW8="
        }))
      })
    });
    const overVideoLimitPayload = await overVideoLimitResponse.json();

    assert.equal(overVideoLimitResponse.status, 400);
    assert.match(overVideoLimitPayload.error, /at most 3 videos/);
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
        rating: 5
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
        rating: 5
      })
    });

    assert.equal(payload.toilet.id, "detail-test");
    assert.equal(payload.toilet.cleanliness, 5);
    assert.equal(payload.toilet.cleanlinessSurvey.ratingTotal, 5);
    assert.equal(payload.toilet.cleanlinessSurvey.ratingCount, 1);

    const { payload: toiletsPayload } = await fetchJson(`${baseUrl}/api/toilets?cleanlinessRange=3days`);
    const refreshedToilet = toiletsPayload.toilets.find((toilet) => toilet.id === "detail-test");
    assert.equal(refreshedToilet.cleanlinessSurvey.ratingTotal, 5);
    assert.equal(refreshedToilet.cleanlinessSurvey.ratingCount, 1);
  }, { databaseOptions: { cleanlinessScoringModel: { type: "average" } } });
});
