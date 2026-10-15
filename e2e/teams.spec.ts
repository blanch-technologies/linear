import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createWorkspace, expect, signIn, test, testEmail } from "./support";

async function createTeam(page: Page, urlKey: string, { name, key, visibility = "Public", parent }: { name: string; key: string; visibility?: string; parent?: string }) {
  await page.goto(`/${urlKey}/settings/teams`);
  await page.getByRole("button", { name: "Create team" }).click();
  const dialog = page.getByRole("dialog", { name: "Create a team" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Identifier").fill(key);
  if (parent) {
    await dialog.getByLabel("Parent team").click();
    await page.getByRole("option", { name: new RegExp(`^${parent}`) }).click();
  }
  await dialog.getByRole("radio", { name: new RegExp(`^${visibility}`) }).click();
  await dialog.getByRole("button", { name: "Create team" }).click();
  await page.waitForURL(`**/settings/teams/${key}`);
}

test.describe("teams", () => {
  test("creates teams and sub-teams that nest in the sidebar", async ({ page }) => {
    await signIn(page, "lead", { displayName: "Lee Lead" });
    const { urlKey } = await createWorkspace(page, "Teams");
    await createTeam(page, urlKey, { name: "Platform", key: "PLAT", visibility: "Private" });
    await createTeam(page, urlKey, { name: "Infra", key: "INF", visibility: "Restricted", parent: "Platform" });

    const rows = page.getByTestId("team-row");
    await page.goto(`/${urlKey}/settings/teams`);
    await expect(rows.filter({ hasText: "Infra" })).toContainText("Restricted");

    await page.goto(`/${urlKey}/team/INF/issues`);
    const sidebar = page.getByRole("navigation", { name: "Main" });
    const platform = sidebar.getByRole("button", { name: "Platform" });
    await expect(platform).toBeVisible();
    // Infra is nested inside Platform's group.
    await expect(platform.locator("xpath=..").getByRole("button", { name: "Infra" })).toBeVisible();
    await expect(page.getByRole("banner")).toContainText("Infra › Issues");
  });

  test("admins see a private team but not its content until they join", async ({ browser }) => {
    const owner = await browser.newPage();
    await signIn(owner, "keeper", { displayName: "Kim Keeper" });
    const { name, urlKey } = await createWorkspace(owner, "Private");
    await createTeam(owner, urlKey, { name: "Security", key: "SEC", visibility: "Private" });
    await owner.goto(`/${urlKey}/settings/members`);
    await owner.getByRole("button", { name: "Invite" }).click();
    const dialog = owner.getByRole("dialog", { name: "Invite to workspace" });
    await dialog.getByLabel("Email addresses").fill(testEmail("auditor"));
    await dialog.getByLabel("Role").click();
    await owner.getByRole("option", { name: /^Admin/ }).click();
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(owner.getByRole("list", { name: "Pending invitations" })).toBeVisible();

    const admin = await browser.newPage();
    await signIn(admin, "auditor", { displayName: "Ada Auditor", acceptInvitations: true });
    await admin.goto("/");
    await expect(admin.getByTestId("workspace-menu")).toContainText(name, { timeout: 30_000 });

    await admin.goto(`/${urlKey}/team/SEC/issues`);
    await expect(admin.getByRole("heading", { name: "Security is private" })).toBeVisible();
    await admin.goto(`/${urlKey}/settings/teams`);
    await admin.getByRole("button", { name: "Join Security" }).click();
    await expect(admin.getByText("You joined Security")).toBeVisible();
    await admin.goto(`/${urlKey}/team/SEC/issues`);
    await expect(admin.getByRole("navigation", { name: "Views" })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Security is private" })).toHaveCount(0);
  });

  test("edits the workflow: add, recolor, default, delete", async ({ page }) => {
    await signIn(page, "flow", { displayName: "Flo Flow" });
    const { urlKey } = await createWorkspace(page, "Flow");
    await page.goto(`/${urlKey}/settings/teams`);
    await page.getByTestId("team-row").first().getByRole("link").click();
    await page.getByRole("link", { name: "Workflow" }).click();

    const states = page.getByTestId("state-row");
    await expect(states).toHaveCount(7);
    await expect(states.filter({ hasText: "Todo" })).toContainText("Default");

    await page.getByRole("button", { name: "Add a started status" }).click();
    const editor = page.getByRole("dialog");
    await editor.getByLabel("Name").fill("QA");
    await editor.getByRole("button", { name: "#8e7cf8" }).click();
    await editor.getByRole("button", { name: "Add status" }).click();
    await expect(page.getByRole("list", { name: "Started statuses", exact: true })).toContainText("QA");

    await states.filter({ hasText: "Backlog" }).getByRole("button", { name: "Actions for Backlog" }).click();
    await page.getByRole("menuitem", { name: "Make default" }).click();
    await expect(states.filter({ hasText: "Backlog" })).toContainText("Default");

    await states.filter({ hasText: "Duplicate" }).getByRole("button", { name: "Actions for Duplicate" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete status" }).click();
    await expect(states.filter({ hasText: "Duplicate" })).toHaveCount(0);

    // The last status of a required category can't be deleted.
    await states.filter({ hasText: "Done" }).getByRole("button", { name: "Actions for Done" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.locator("[data-state=open]")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});
