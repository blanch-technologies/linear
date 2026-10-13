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

// The signed-in shell (sidebar, theme, a11y) is covered once the D-41 test-auth
// path lands in Phase 1; it needs a minted session that Convex accepts.
