import { createWorkspace, expect, signIn, test } from "./support";

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
    const rows = page.getByTestId("issue-row");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("issue-count")).toHaveText("2 issues");

    // j focuses the first row, p opens priority, 1 sets Urgent (optimistic).
    await page.keyboard.press("j");
    await page.keyboard.press("p");
    await page.keyboard.press("1");
    await expect(rows.first().getByRole("button", { name: "Priority: 1" })).toBeVisible();

    // Filter by priority via the filter menu.
    await page.getByTestId("filter-button").click();
    await page.getByRole("option", { name: "Priority" }).click();
    await page.getByRole("option", { name: /Urgent/ }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("issue-count")).toHaveText("1 issue");
    await expect(page).toHaveURL(/filter=/);
    await page.getByRole("button", { name: "Remove Priority filter" }).click();
    await expect(page.getByTestId("issue-count")).toHaveText("2 issues");

    // ⌘B switches to the board.
    await page.keyboard.press("ControlOrMeta+b");
    await expect(page.getByTestId("issue-board")).toBeVisible();
    await expect(page.getByTestId("board-card")).toHaveCount(2);

    // My issues > Created shows both.
    await page.goto(`/${urlKey}/my-issues/created`);
    await expect(page.getByTestId("issue-count")).toHaveText("2 issues");
  });
});
