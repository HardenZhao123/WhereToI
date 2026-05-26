# WHERE Toi Web App

Static, deployable web prototype for a toilet access product with three core tabs:

- Map: OpenStreetMap preview, nearby toilet markers, browser location, filters, toilet details and walking directions.
- Access QR: paid or partner toilet access pass.
- Account: wallet, subscription, monthly free tickets and history.

## Local development

Open `index.html` directly in a browser, or serve the project root.
For loading `src/data/toilets.csv` in the Map tab, use a local server (`localhost`) instead of `file://`.

The map uses an OpenStreetMap preview frame with fixed marker overlays, so the browser needs internet access. Browser location works on `localhost` during development and on HTTPS after deployment.

### Windows (PowerShell)

No Node.js required:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-server.ps1
```

### Linux / macOS

No Node.js required (using Python):

```bash
python3 -m http.server 4173
```

### Any platform (Node.js)

If Node.js is installed:

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

The production bundle is written to `dist/`.

## CI/CD

GitHub Actions builds the static app on every push and pull request. Pushes to `main` also publish `dist/` as a GitHub Pages artifact.
