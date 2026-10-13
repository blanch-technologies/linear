import { createWorkspace, signIn, test } from "../support";

/*
 * Not a test: captures screenshots of the main surfaces for PR descriptions.
 * Run with `SCREENSHOTS=1 pnpm exec playwright test e2e/tools`.
 */
test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to capture.");

const out = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";

test("capture", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "shots", { displayName: "Sam Shots" });
  await page.goto("/onboarding");
  await page.getByLabel("Workspace name").fill("Acme Labs");
  await page.screenshot({ path: `${out}/onboarding.png` });
  const { urlKey } = await createWorkspace(page, "Shots");
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.goto(`/${urlKey}/my-issues`);
    await page.getByTestId("workspace-menu").waitFor();
    await page.screenshot({ path: `${out}/shell-${theme}.png` });
  }
  await page.getByTestId("workspace-menu").click();
  await page.getByRole("menuitem", { name: "Log out" }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/workspace-menu.png` });
  await page.keyboard.press("Escape");
  await page.goto(`/${urlKey}/settings/workspace`);
  await page.getByLabel("Name").waitFor();
  await page.screenshot({ path: `${out}/settings-workspace.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${urlKey}/my-issues`);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Main" }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/mobile-drawer.png` });
});
