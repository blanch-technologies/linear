import { defineConfig, devices } from "@playwright/test";

// Locally: runs against `pnpm dev`. In CI: PLAYWRIGHT_BASE_URL is the Vercel
// preview URL, and VERCEL_AUTOMATION_BYPASS_SECRET gets past deployment protection.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
// Names this run's test users and workspaces (e2e/support.ts); workers inherit it.
process.env.E2E_RUN_ID ??= Date.now().toString(36);
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 60_000,
  // The local dev server compiles routes on first hit while tests run in parallel.
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    extraHTTPHeaders: bypass
      ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
      : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : { command: "pnpm dev", url: `${baseURL}/api/health`, reuseExistingServer: true, timeout: 120_000 },
});
