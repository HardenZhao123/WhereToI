# WHERE Toi Web App

Walking-skeleton web app for a toilet access product with three core tabs:

- Map: OpenStreetMap preview, nearby toilet markers, browser location, filters, toilet details and walking directions (loaded from API/database).
- Access QR: paid or partner toilet access pass with activation persisted to database.
- Account: wallet, subscription, monthly free tickets and history (loaded from database).

## Architecture

- Frontend: `index.html` + `src/main.js` + `src/styles.css`
- Backend API: `server/app-server.mjs`
- Database mode A (local default): SQLite (`data/wheretoi.sqlite`)
- Database mode B (deployment recommended): external PostgreSQL via `WHERETOI_DATABASE_URL`
- Seed data: `src/data/toilets.csv` (loaded when the database is empty)
- Public deployment template: `render.yaml` (Render free web service + external PostgreSQL)

## Web app structure

The frontend has been split into focused modules under `src/app/`:

- `src/main.js`: minimal entrypoint (`createApp().initialize()`).
- `src/app/app.js`: top-level wiring, startup flow, and fallbacks.
- `src/app/config/`: constants, DOM references, fallback sample data.
- `src/app/controllers/`: map, account, and tab interaction controllers.
- `src/app/services/`: API and data-loading services.
- `src/app/toilets/`: toilet record transformation/mapping.
- `src/app/utils/`: reusable helpers (csv/text/geo/formatting).
- `src/app/views/`: render-only functions for account/history UI.

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

## iOS distribution (IPA)

The iOS target is in `WhereToIApp/`.

Before exporting IPA:

1. Replace the placeholder Team ID `TEAMID1234` in the Xcode project with your real Apple Developer Team ID.
2. Confirm the bundle ID is unique for your Apple account (`com.hardenzhao.wheretoiapp` by default).

Export with one command:

```bash
scripts/ios-export-ipa.sh --team-id <TEAM_ID> --bundle-id <BUNDLE_ID> --method adhoc --profile-name "<ADHOC_PROFILE_NAME>"
```

Enterprise export:

```bash
scripts/ios-export-ipa.sh --team-id <TEAM_ID> --bundle-id <BUNDLE_ID> --method enterprise --profile-name "<ENTERPRISE_PROFILE_NAME>"
```

Outputs are generated under `dist/ios/`.

### GitHub Actions iOS CI/CD

Workflow file: `.github/workflows/ios-pipeline.yml`

- CI: auto build iOS app on push/PR when `WhereToIApp/**` changes.
- CD: manual trigger (`workflow_dispatch`) with `distribution_method`:
  - `adhoc`
  - `enterprise`

Required repository secrets for distribution:

- `IOS_TEAM_ID`
- `IOS_BUNDLE_ID`
- `IOS_DIST_CERT_P12_BASE64`
- `IOS_DIST_CERT_PASSWORD`
- `IOS_PROFILE_ADHOC_BASE64` (for `adhoc`)
- `IOS_PROFILE_ENTERPRISE_BASE64` (for `enterprise`)

Optional workflow inputs when manually running:

- `team_id` (override `IOS_TEAM_ID`)
- `bundle_id` (override `IOS_BUNDLE_ID`)
- `profile_name` (override provisioning profile name parsed from profile file)

## CI/CD

Workflow file: `.github/workflows/pipeline.yml`

- CI (all push/PR): install dependencies, run static checks, build, and execute a local end-to-end smoke check against real API endpoints.
- CD (push to `main`): automatically trigger Render backend deployment via deploy hook.
- Public verification (push to `main`): automatically verify `/api/health` and `/api/account` on the public URL (when configured).

## Public deployment (Render free + external PostgreSQL)

This repo includes a `render.yaml` that keeps backend hosting on Render while moving the database to an external PostgreSQL service.

### What is already configured

- `render.yaml` creates a Render web service (`type: web`) with `plan: free`.
- Render `autoDeployTrigger` is set to `off` so deployment is controlled by GitHub Actions after CI passes.
- Health check path is `/api/health`.
- Database connection is read from `WHERETOI_DATABASE_URL` (set in Render Dashboard as a secret env var).
- On startup, the backend auto-creates required tables and seeds initial data if tables are empty.

### Deploy steps

1. Create a hosted PostgreSQL database and copy its connection string (for example, Supabase or Neon).
2. Push your latest code to GitHub (`main` branch).
3. In Render Dashboard, choose **New +** -> **Blueprint**.
4. Connect your GitHub repo and select this repository.
5. Render reads `render.yaml`; enter `WHERETOI_DATABASE_URL` when prompted and create the service.
6. After first deploy, open your `onrender.com` URL and verify:
   - `/api/health` returns `{ "status": "ok" }`
   - App loads and map/account data come from API endpoints.

### GitHub Actions secrets for fully automated CD demo

Set these repository secrets in GitHub:

- `RENDER_DEPLOY_HOOK_URL`: Render deploy hook URL for the web service.
- `PUBLIC_APP_URL`: public app base URL (for example `https://wheretoi-webapp.onrender.com`) used for post-deploy verification.
- `WHERETOI_DATABASE_URL`: should be set in Render service environment (not GitHub Actions).

### Continuous deployment behavior

- Every new commit to `main` runs CI in GitHub Actions.
- After CI passes, GitHub Actions calls `RENDER_DEPLOY_HOOK_URL` to redeploy the public backend automatically.
- Database data persists across Render restarts/redeploys because it lives in the external PostgreSQL service, not Render local filesystem.
