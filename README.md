# WHERE Toi Web App

Static, deployable web prototype for a toilet access product with three core tabs:

- Map: nearby toilets, filters, toilet details and directions.
- Access QR: paid or partner toilet access pass.
- Account: wallet, subscription, monthly free tickets and history.

## Local development

Open `index.html` directly in a browser, or serve the project root with the built-in PowerShell server.

Windows PowerShell, no Node.js required:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-server.ps1
```

Then open:

```text
http://localhost:4173
```

If Node.js is installed:

```bash
npm run dev
```

Without npm but with Node.js:

```bash
node scripts/dev-server.mjs
```

## Build

Windows PowerShell, no Node.js required:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check.ps1
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
```

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
