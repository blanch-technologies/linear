import AxeBuilder from "@axe-core/playwright";
import { createWorkspace, expect, signIn, test } from "./support";

test.describe("keyboard and command menu (D-35)", () => {
  test("⌘K opens the command menu, which navigates and switches theme", async ({ page }) => {
    await signIn(page, "keys");
    const { urlKey } = await createWorkspace(page, "Keys");

    await page.keyboard.press("ControlOrMeta+k");
    const menu = page.getByRole("dialog", { name: "Command menu" });
    await expect(menu).toBeVisible();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    await menu.getByRole("combobox", { name: "Command" }).fill("inbox");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${urlKey}/inbox$`));
    await expect(menu).toBeHidden();

    await page.keyboard.press("ControlOrMeta+k");
    await menu.getByRole("combobox", { name: "Command" }).fill("light");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveClass(/light/);

    // ⌘K toggles closed again, even from inside the input.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(menu).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(menu).toBeHidden();
  });

  test("go-to sequences, help overlay, and Esc out of settings", async ({ page }) => {
    await signIn(page, "nav");
    const { urlKey } = await createWorkspace(page, "Nav");

    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(page).toHaveURL(new RegExp(`/${urlKey}/inbox$`));
    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await expect(page).toHaveURL(new RegExp(`/${urlKey}/settings/preferences$`));

    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toContainText("Go to Inbox");
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
    // With nothing open, Esc leaves settings.
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/${urlKey}/my-issues$`));
  });

  test("shortcuts stay out of the way while typing; ⌘Enter submits forms", async ({ page }) => {
    await signIn(page, "typist");
    const { urlKey } = await createWorkspace(page, "Typist");
    await page.goto(`/${urlKey}/settings/members`);
    const search = page.getByLabel("Search members");
    await search.click();
    await page.keyboard.type("gi?");
    await expect(search).toHaveValue("gi?");
    await expect(page).toHaveURL(new RegExp(`/settings/members$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto(`/${urlKey}/settings/teams`);
    await page.getByRole("button", { name: "Create team" }).click();
    const dialog = page.getByRole("dialog", { name: "Create a team" });
    await dialog.getByLabel("Name").fill("Keyboard");
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForURL("**/settings/teams/KEY");
  });
});
