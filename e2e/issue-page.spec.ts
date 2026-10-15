import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createWorkspace, expect, signIn, test } from "./support";

const shown = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });

async function createIssues(page: Page, titles: string[]) {
  for (const title of titles) {
    await page.keyboard.press("c");
    const composer = page.getByRole("dialog", { name: "New issue" });
    await composer.getByLabel("Issue title").fill(title);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(composer).toBeHidden();
  }
}

test.describe("issue page (D-37)", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("edits title, description, and properties; sub-issues, relations, activity, prev/next", async ({ page }) => {
    await signIn(page, "pager", { displayName: "Pia Pager" });
    const { urlKey } = await createWorkspace(page, "Pages");
    await createIssues(page, ["Blocker issue", "Main issue"]);
    await page.getByRole("navigation", { name: "Main" }).locator("section", { hasText: "Your teams" }).getByRole("link", { name: "Issues" }).click();
    // Newest first: Main issue, then Blocker issue.
    await shown(page, "issue-row").filter({ hasText: "Main issue" }).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/${urlKey}/issue/[A-Z0-9]+-2$`));
    const identifier = page.url().split("/").pop()!;
    const title = page.getByLabel("Issue title");
    await expect(title).toHaveValue("Main issue");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(identifier);
    await expect(page.getByLabel("Issue 1 of 2")).toBeVisible();

    // Title saves on Enter.
    await title.fill("Main issue, renamed");
    await title.press("Enter");
    // Description saves as you type.
    await page.getByRole("textbox", { name: "Description" }).click();
    await page.keyboard.type("Steps to reproduce.");
    // P then 2 sets High from the keyboard.
    await page.getByLabel("Issue title").blur();
    await page.locator("body").click({ position: { x: 5, y: 500 } });
    await page.keyboard.press("p");
    await page.keyboard.press("2");
    const rail = page.getByRole("complementary", { name: "Properties" });
    await expect(rail.getByRole("button", { name: "Priority: High" })).toBeVisible();

    // Everything persisted on the server.
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(page.getByLabel("Issue title")).toHaveValue("Main issue, renamed");
    await expect(page.getByRole("textbox", { name: "Description" })).toContainText("Steps to reproduce.");
    await expect(rail.getByRole("button", { name: "Priority: High" })).toBeVisible();
    const activity = page.getByRole("region", { name: "Activity" }).or(page.locator("section[aria-label=Activity]"));
    await expect(activity).toContainText("changed the title to “Main issue, renamed”");
    await expect(activity).toContainText("set priority to High");
    await expect(activity).toContainText("updated the description");

    // A sub-issue from the section's + opens the composer with the parent set.
    await page.getByRole("button", { name: "Add sub-issue" }).click();
    const composer = page.getByRole("dialog", { name: "New issue" });
    await composer.getByLabel("Issue title").fill("Child task");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(composer).toBeHidden();
    const subIssues = page.locator("section[aria-label=Sub-issues]");
    await expect(subIssues).toContainText("Child task");
    await expect(subIssues).toContainText("0/1");

    // Relation: Blocked by the other issue, found by title.
    await page.getByRole("button", { name: "Add relation" }).click();
    await page.getByRole("option", { name: "Blocked by…" }).click();
    await page.getByRole("combobox", { name: "Blocked by…" }).fill("Blocker");
    await page.getByRole("option", { name: /Blocker issue/ }).click();
    const relations = page.locator("section[aria-label=Relations]");
    await expect(relations).toContainText("Blocked by");
    await expect(relations).toContainText("Blocker issue");

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // ⌘. copies the ID.
    await page.locator("body").click({ position: { x: 5, y: 500 } });
    await page.keyboard.press("ControlOrMeta+.");
    await expect(page.getByText(`Copied ${identifier}`)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(identifier);

    // J goes to the next issue in the list it was opened from; Esc goes back to that list.
    await page.keyboard.press("j");
    await expect(page.getByLabel("Issue title")).toHaveValue("Blocker issue");
    await expect(page.locator("section[aria-label=Relations]")).toContainText("Blocks");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/${urlKey}/team/[A-Z0-9]+/issues$`));
  });

  test("deletes with undo, shows deleted issues for restore, and 404s unknown IDs", async ({ page }) => {
    await signIn(page, "deleter", { displayName: "Dee Deleter" });
    const { urlKey } = await createWorkspace(page, "Delete");
    await createIssues(page, ["Short-lived"]);
    await page.getByRole("navigation", { name: "Main" }).locator("section", { hasText: "Your teams" }).getByRole("link", { name: "Issues" }).click();
    await shown(page, "issue-row").first().getByRole("link").click();
    await expect(page).toHaveURL(/\/issue\//);
    const url = page.url();

    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page).toHaveURL(new RegExp(`/${urlKey}/team/[A-Z0-9]+/issues$`));
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(shown(page, "issue-row")).toHaveCount(1);

    await page.goto(url);
    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.goto(url);
    await expect(page.getByRole("heading", { name: /was deleted/ })).toBeVisible();
    await page.getByRole("button", { name: "Restore issue" }).click();
    await expect(page.getByLabel("Issue title")).toHaveValue("Short-lived");

    await page.goto(`/${urlKey}/issue/NOPE-999`);
    await expect(page.getByRole("heading", { name: "Issue not found" })).toBeVisible();
  });
});
