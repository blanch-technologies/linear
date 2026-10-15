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

    // Dragging a card to another column changes its status, and it persists.
    const inProgress = shown(page, "board-column").and(page.locator('[aria-label^="In Progress,"]'));
    await shown(page, "board-card").filter({ hasText: "First issue" }).hover();
    await page.mouse.down();
    const box = (await inProgress.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 12 });
    await page.mouse.up();
    await expect(inProgress.getByTestId("board-card")).toHaveCount(1);
    await expect(inProgress).toContainText("First issue");
    // The layout persists, and the column comes from the server after a reload.
    await page.reload();
    await expect(inProgress).toContainText("First issue");

    // My issues > Created shows both.
    await page.goto(`/${urlKey}/my-issues/created`);
    await expect(shown(page, "issue-count")).toHaveText("2 issues");
  });

  test("shift-click selects a range, shift+J extends it, and edits apply to the selection", async ({ page }) => {
    await signIn(page, "picker", { displayName: "Pat Picker" });
    await createWorkspace(page, "Select");
    for (const title of ["One", "Two", "Three", "Four"]) {
      await page.keyboard.press("c");
      const composer = page.getByRole("dialog", { name: "New issue" });
      await composer.getByLabel("Issue title").fill(title);
      await page.keyboard.press("ControlOrMeta+Enter");
      await expect(composer).toBeHidden();
    }
    await page.getByRole("navigation", { name: "Main" }).locator("section", { hasText: "Your teams" }).getByRole("link", { name: "Issues" }).click();
    const rows = shown(page, "issue-row");
    await expect(rows).toHaveCount(4);

    // Click the first row's checkbox, then shift-click the third row's title.
    await rows.nth(0).getByRole("checkbox").check();
    await rows.nth(2).getByRole("link").click({ modifiers: ["Shift"] });
    await expect(page).toHaveURL(/\/team\/[A-Z0-9]+\/issues/);
    await expect(page.getByRole("status").filter({ hasText: "selected" })).toContainText("3 selected");
    for (const i of [0, 1, 2]) await expect(rows.nth(i)).toHaveAttribute("aria-selected", "true");
    await expect(rows.nth(3)).toHaveAttribute("aria-selected", "false");

    // Shift+J from the focused third row adds the fourth.
    await rows.nth(2).hover();
    await page.keyboard.press("Shift+J");
    await expect(page.getByRole("status").filter({ hasText: "selected" })).toContainText("4 selected");

    // P then 2 sets High on all four.
    await page.keyboard.press("p");
    await page.keyboard.press("2");
    await expect(page.getByRole("button", { name: "Priority: 2" }).filter({ visible: true })).toHaveCount(4);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("status").filter({ hasText: "selected" })).toHaveCount(0);
  });
});
