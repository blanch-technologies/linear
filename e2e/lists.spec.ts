import type { Page } from "@playwright/test";
import { createWorkspace, expect, signIn, test } from "./support";

// Cache Components keeps the previous route mounted but hidden, so match visible elements only.
const shown = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });

test.describe("issue list and board", () => {
  test("lists team issues; keyboard edits, filters, and board toggle", async ({ page }) => {
    await signIn(page, "lister", { displayName: "Lee Lister" });
    const { urlKey } = await createWorkspace(page, "Lists");
    for (const title of ["First issue", "Second issue"]) {
      await page.keyboard.press("c");
      const composer = page.getByRole("dialog", { name: "New issue" });
      await composer.getByLabel("Issue title").fill(title);
      await page.keyboard.press("ControlOrMeta+Enter");
      await expect(composer).toBeHidden();
    }
    await page.getByRole("navigation", { name: "Main" }).locator("section", { hasText: "Your teams" }).getByRole("link", { name: "Issues" }).click();
    await expect(page).toHaveURL(new RegExp(`/${urlKey}/team/[A-Z0-9]+/issues`));
    const rows = shown(page, "issue-row");
    await expect(rows).toHaveCount(2);
    await expect(shown(page, "issue-count")).toHaveText("2 issues");

    // j focuses the first row, p opens priority, 1 sets Urgent (optimistic).
    await page.keyboard.press("j");
    await page.keyboard.press("p");
    await page.keyboard.press("1");
    await expect(rows.first().getByRole("button", { name: "Priority: 1" })).toBeVisible();

    // Filter by priority via the filter menu.
    await shown(page, "filter-button").click();
    await page.getByRole("option", { name: "Priority" }).click();
    await page.getByRole("option", { name: /Urgent/ }).click();
    await page.keyboard.press("Escape");
    await expect(shown(page, "issue-count")).toHaveText("1 issue");
    await expect(page).toHaveURL(/filter=/);
    await page.getByRole("button", { name: "Remove Priority filter" }).click();
    await expect(shown(page, "issue-count")).toHaveText("2 issues");

    // ⌘B switches to the board.
    await page.keyboard.press("ControlOrMeta+b");
    await expect(shown(page, "issue-board")).toBeVisible();
    await expect(shown(page, "board-card")).toHaveCount(2);

    // My issues > Created shows both.
    await page.goto(`/${urlKey}/my-issues/created`);
    await expect(shown(page, "issue-count")).toHaveText("2 issues");
  });
});
