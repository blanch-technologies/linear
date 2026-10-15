import { expect, test as base, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/*
 * Signed-in e2e support (D-41). Each run uses its own `@blanch.test` users and
 * workspace names, derived from E2E_RUN_ID (set in playwright.config.ts), so
 * runs never share WorkOS state; global teardown deletes them.
 */

export const runId = process.env.E2E_RUN_ID!;
export const workspacePrefix = `E2E ${runId}`;
export const emailPrefix = `e2e-${runId}`;

export function testEmail(name: string) {
  return `${emailPrefix}-${name}@blanch.test`;
}

/** True when the deployment exposes test auth (local with BLANCH_TEST_AUTH=1, previews). */
export async function testAuthAvailable(request: APIRequestContext): Promise<boolean> {
  const response = await request.post("/api/test-auth", { data: {} });
  return response.status() === 400;
}

export async function signIn(
  page: Page,
  name: string,
  { displayName = `${name[0]!.toUpperCase()}${name.slice(1)} Tester`, acceptInvitations = false } = {},
) {
  const response = await page.request.post("/api/test-auth", {
    data: { email: testEmail(name), name: displayName, acceptInvitations },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** Creates a workspace through onboarding and waits for its shell. Returns its URL key. */
export async function createWorkspace(page: Page, label: string): Promise<{ name: string; urlKey: string }> {
  const name = `${workspacePrefix} ${label}`;
  // A random part keeps keys unique across workers and retries, which share the run ID.
  const unique = Math.random().toString(36).slice(2, 6);
  const urlKey = `e2e-${runId}-${unique}-${label.toLowerCase()}`.slice(0, 28).replace(/-+$/, "");
  await page.goto("/onboarding");
  await page.getByLabel("Workspace name").fill(name);
  await page.getByLabel("Workspace URL").fill(urlKey);
  await expect(page.getByText("Available")).toBeVisible();
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(`**/${urlKey}/my-issues/assigned`, { timeout: 30_000 });
  await expect(page.getByTestId("workspace-menu")).toContainText(name);
  return { name, urlKey };
}

/** Waits for an element's enter animations, so axe doesn't sample mid-fade colors. */
export async function settled(locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
}

export const test = base.extend<{ requireTestAuth: void }>({
  requireTestAuth: [
    async ({ request }, use) => {
      test.skip(!(await testAuthAvailable(request)), "Test auth is not enabled on this deployment.");
      await use();
    },
    { auto: true },
  ],
});

export { expect };
