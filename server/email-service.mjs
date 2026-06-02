const DEFAULT_RESEND_EMAIL_API_URL = "https://api.resend.com/emails";
const DEFAULT_APP_BASE_URL = "https://wheretoi-webapp.onrender.com";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normaliseEmail(email) {
  if (typeof email !== "string") return "";
  return email.trim();
}

function buildRegistrationEmail({ user, from, replyTo, appBaseUrl }) {
  const username = user?.username?.trim() || "there";
  const escapedUsername = escapeHtml(username);
  const safeAppBaseUrl = appBaseUrl || DEFAULT_APP_BASE_URL;

  const payload = {
    from,
    to: [normaliseEmail(user?.email)],
    subject: "Welcome to WhereToI",
    text: [
      `Hi ${username},`,
      "",
      "Your WhereToI account has been created.",
      "You can now use your account for wallet access, profile preferences, and access history.",
      "",
      `Open WhereToI: ${safeAppBaseUrl}`,
      "",
      "This message confirms account creation. It does not verify ownership of this email address."
    ].join("\n"),
    html: [
      `<p>Hi ${escapedUsername},</p>`,
      "<p>Your WhereToI account has been created.</p>",
      "<p>You can now use your account for wallet access, profile preferences, and access history.</p>",
      `<p><a href="${escapeHtml(safeAppBaseUrl)}">Open WhereToI</a></p>`,
      "<p>This message confirms account creation. It does not verify ownership of this email address.</p>"
    ].join("")
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  return payload;
}

export function createRegistrationEmailService({
  apiKey = process.env.WHERETOI_RESEND_API_KEY,
  apiUrl = process.env.WHERETOI_RESEND_API_URL ?? DEFAULT_RESEND_EMAIL_API_URL,
  from = process.env.WHERETOI_EMAIL_FROM,
  replyTo = process.env.WHERETOI_EMAIL_REPLY_TO,
  appBaseUrl = process.env.WHERETOI_PUBLIC_APP_URL ?? DEFAULT_APP_BASE_URL,
  fetchImpl = globalThis.fetch
} = {}) {
  const isConfigured = Boolean(apiKey && from && fetchImpl);

  return {
    isConfigured,
    async sendRegistrationSuccessEmail(user) {
      const recipient = normaliseEmail(user?.email);

      if (!recipient) {
        return { status: "skipped", reason: "missing_recipient" };
      }

      if (!isConfigured) {
        return { status: "skipped", reason: "email_service_not_configured" };
      }

      const response = await fetchImpl(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildRegistrationEmail({ user, from, replyTo, appBaseUrl }))
      });

      if (!response.ok) {
        const providerMessage = await response.text().catch(() => "");
        throw new Error(
          `Registration email provider failed with status ${response.status}${providerMessage ? `: ${providerMessage}` : ""}`
        );
      }

      const payload = await response.json().catch(() => ({}));
      return { status: "sent", provider: "resend", id: payload.id ?? null };
    }
  };
}
