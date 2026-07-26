import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  // Ledgr's whole state lives in IndexedDB, so parallel workers sharing an
  // origin would fight over the same database.
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // CHROMIUM_PATH points at an already-installed Chromium when the
        // environment provides one whose build number does not match what this
        // Playwright release would download. Unset elsewhere, so a normal
        // `npx playwright install` still works.
        launchOptions: process.env.CHROMIUM_PATH
          ? { executablePath: process.env.CHROMIUM_PATH }
          : undefined,
        channel: process.env.CHROMIUM_PATH ? undefined : "chromium",
      },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
