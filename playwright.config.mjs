import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  reporter: [["list"]],
  outputDir: "test-results/playwright",
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      WHERETOI_DB_FILE: "data/playwright.sqlite",
      WHERETOI_ENABLE_DEMO_ACCOUNT: "true"
    }
  }
});
