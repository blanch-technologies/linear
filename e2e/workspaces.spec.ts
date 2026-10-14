import AxeBuilder from "@axe-core/playwright";
import { createWorkspace, expect, signIn, test } from "./support";

test.describe("workspaces", () => {
  test("a new user creates a workspace and lands in its shell", async ({ page }) => {
    await signIn(page, "founder");
    await page.goto("/");
    await page.waitForURL("**/onboarding");
    const { name, urlKey } = await createWorkspace(page, "Acme");

    const sidebar = page.getByRole("navigation", { name: "Main" });
    await expect(sidebar.getByRole("link", { name: "Inbox" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "My issues" })).toHaveAttribute("aria-current", "page");
    // The default team is named after the workspace and listed under Your teams.
    const teams = sidebar.locator("section", { hasText: "Your teams" });
    await expect(teams.getByRole("button", { name })).toBeVisible();
    await expect(teams.getByRole("link", { name: "Issues" })).toHaveAttribute("href", /\/team\/[A-Z0-9]+\/issues$/);
    await expect(page).toHaveTitle(/./);

    // Reload keeps the session scoped to the workspace.
    await page.reload();
    await expect(page.getByTestId("workspace-menu")).toContainText(name);
    expect(new URL(page.url()).pathname).toBe(`/${urlKey}/my-issues`);
  });

  test("switches between workspaces from the workspace menu", async ({ page }) => {
    await signIn(page, "switcher");
    const first = await createWorkspace(page, "First");
    const second = await createWorkspace(page, "Second");
    await page.getByTestId("workspace-menu").click();
    await page.getByRole("menuitem", { name: first.name }).click();
    await page.waitForURL(`**/${first.urlKey}/my-issues`);
    await expect(page.getByTestId("workspace-menu")).toContainText(first.name);
    // Visiting the other workspace's URL rescopes the session too.
    await page.goto(`/${second.urlKey}/inbox`);
    await expect(page.getByTestId("workspace-menu")).toContainText(second.name);
    await expect(page).toHaveURL(new RegExp(`/${second.urlKey}/inbox$`));
  });

  test("another user can't open a workspace they don't belong to", async ({ browser }) => {
    const ownerPage = await browser.newPage();
    await signIn(ownerPage, "owner");
    const { name, urlKey } = await createWorkspace(ownerPage, "Private");

    const outsiderPage = await browser.newPage();
    await signIn(outsiderPage, "outsider");
    await createWorkspace(outsiderPage, "Elsewhere");
    await outsiderPage.goto(`/${urlKey}/my-issues`);
    await expect(outsiderPage.getByRole("heading", { name: "Workspace not found" })).toBeVisible();
    await expect(outsiderPage.getByText(name)).toHaveCount(0);
  });

  test("admins rename the workspace and change its URL", async ({ page }) => {
    await signIn(page, "renamer");
    const { name, urlKey } = await createWorkspace(page, "Rename");
    await page.goto(`/${urlKey}/settings/workspace`);
    const newKey = `${urlKey}-x`.slice(0, 32);
    // Keep the run prefix so global teardown still finds and deletes it.
    await page.getByLabel("Name").fill(`${name} renamed`);
    await page.getByLabel("URL").fill(newKey);
    await expect(page.getByText("Changing the URL breaks")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(`**/${newKey}/settings/workspace`);
    await page.getByRole("link", { name: "Back to app" }).click();
    await expect(page.getByTestId("workspace-menu")).toContainText("renamed");
  });

  test("the shell and onboarding have no accessibility violations", async ({ page }) => {
    await signIn(page, "a11y");
    await page.goto("/onboarding");
    await expect(page.getByLabel("Workspace name")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await createWorkspace(page, "Axe");
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => localStorage.setItem("theme", value), theme);
      await page.reload();
      await expect(page.getByTestId("workspace-menu")).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, `${theme} theme`).toEqual([]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});
