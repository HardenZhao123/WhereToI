# WhereToI Web App

Walking-skeleton web app for a toilet access product with three core tabs:

- Map: OpenStreetMap preview, nearby toilet markers, browser location, filters, toilet details and walking directions (loaded from API/database).
- Access QR: paid or partner toilet access pass with activation persisted to database.
- Account: wallet, subscription, monthly free tickets and history (loaded from database).

## Local development

Use the Node.js app server to run frontend + API + SQLite together:

```bash
npm run dev
```

Without npm but with Node.js:

```bash
node scripts/dev-server.mjs
```

Then open:

```text
http://localhost:4173
```

On first startup, `data/wheretoi.sqlite` is created automatically and seeded (if `WHERETOI_DATABASE_URL` is not set).

The map uses OpenStreetMap tiles, so the browser needs internet access. Browser location works on `localhost` during development and on HTTPS after deployment.

## Cleanliness survey API

Submit a cleanliness survey result and update the toilet's `cleanliness` score:

```http
POST /api/cleanliness-survey
Content-Type: application/json

{
  "toiletId": "1b8da78b0811f8692823b6a0",
  "answer": "yes"
}
```

The scoring model is configured server-side. By default, the API uses cumulative average scoring. To use exponential moving average scoring, set:

```bash
WHERETOI_CLEANLINESS_SCORING_MODEL=ema
WHERETOI_CLEANLINESS_EMA_ALPHA=0.35
```

Supported server-side models are `average` and `ema`.

## Registration confirmation email

After `POST /api/register` creates an account, the server queues a short registration confirmation email. This is non-blocking: if the email provider is unavailable, registration still succeeds and the failure is logged server-side.

Email sending is disabled unless these environment variables are configured:

```bash
WHERETOI_RESEND_API_KEY=...
WHERETOI_EMAIL_FROM="WhereToI <hello@example.com>"
WHERETOI_PUBLIC_APP_URL=https://wheretoi-webapp.onrender.com
```

Optional:

```bash
WHERETOI_EMAIL_REPLY_TO=hello@example.com
WHERETOI_RESEND_API_URL=https://api.resend.com/emails
```

This message confirms account creation only. It does not verify ownership of the email address; a future email-verification flow would need separate verification tokens or codes.

### Windows (PowerShell)

Static-only fallback (no API/database persistence):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-server.ps1
```

### Linux / macOS

Static-only fallback (no API/database persistence):

```bash
python3 -m http.server 4173
```

## Build

### Windows (PowerShell)

No Node.js required:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check.ps1
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
```

### Linux / macOS

No Node.js required:

```bash
rm -rf dist && mkdir -p dist && cp index.html dist/ && cp -r src dist/
```

### Any platform (Node.js)

If Node.js is installed:

```bash
npm run build
```

Without npm but with Node.js:

```bash
node scripts/build.mjs
```

The production static bundle is written to `dist/`.
