import { defineConfig, devices } from "@playwright/test";

// Locally: runs against `pnpm dev`. In CI: PLAYWRIGHT_BASE_URL is the Vercel
// preview URL, and VERCEL_AUTOMATION_BYPASS_SECRET gets past deployment protection.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
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
