import { expect, test } from "@playwright/test";

test("health check responds", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ ok: true });
});

test("signed-out visitors are sent to AuthKit sign-in", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL((url) => !url.host.startsWith("localhost") && !url.host.endsWith("vercel.app"));
  expect(page.url()).toMatch(/authkit\.app|workos\.com/);
});

// Signed-in flows use the D-41 test-auth path: see e2e/support.ts.
