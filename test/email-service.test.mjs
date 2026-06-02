import assert from "node:assert/strict";
import test from "node:test";
import { createRegistrationEmailService } from "../server/email-service.mjs";

test("registration email service skips network calls when not configured", async () => {
  let fetchCalled = false;
  const emailService = createRegistrationEmailService({
    apiKey: "",
    from: "",
    fetchImpl() {
      fetchCalled = true;
    }
  });

  const result = await emailService.sendRegistrationSuccessEmail({
    username: "test-user",
    email: "test-user@example.com"
  });

  assert.equal(fetchCalled, false);
  assert.deepEqual(result, { status: "skipped", reason: "email_service_not_configured" });
});

test("registration email service posts a welcome email through Resend", async () => {
  const calls = [];
  const emailService = createRegistrationEmailService({
    apiKey: "test-api-key",
    from: "WhereToI <hello@example.com>",
    appBaseUrl: "https://wheretoi.example.test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ id: "email-id-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const result = await emailService.sendRegistrationSuccessEmail({
    username: "Rui Jie",
    email: "ruijie@example.com"
  });

  assert.deepEqual(result, { status: "sent", provider: "resend", id: "email-id-123" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-api-key");

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.from, "WhereToI <hello@example.com>");
  assert.deepEqual(body.to, ["ruijie@example.com"]);
  assert.equal(body.subject, "Welcome to WhereToI");
  assert.match(body.text, /Your WhereToI account has been created/);
  assert.match(body.text, /wallet access, profile preferences, and access history/);
  assert.doesNotMatch(body.text, /QR access/);
  assert.doesNotMatch(body.html, /QR access/);
  assert.match(body.text, /does not verify ownership/);
  assert.match(body.html, /https:\/\/wheretoi\.example\.test/);
});
