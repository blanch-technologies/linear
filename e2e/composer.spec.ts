import AxeBuilder from "@axe-core/playwright";
import { createWorkspace, expect, signIn, test } from "./support";

test.describe("issue composer (D-37)", () => {
  test("C opens a writing-first composer; properties, create more, and drafts work", async ({ page }) => {
    await signIn(page, "writer", { displayName: "Wren Writer" });
    await createWorkspace(page, "Compose");

    await page.keyboard.press("c");
    const composer = page.getByRole("dialog", { name: "New issue" });
    await expect(composer).toBeVisible();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);

    await composer.getByLabel("Issue title").fill("Sidebar collapses on reload");
    await composer.getByRole("textbox", { name: "Description" }).click();
    await page.keyboard.type("Steps: open the app, then reload.");
    await composer.getByRole("button", { name: /^Priority:/ }).click();
    await page.keyboard.press("2");
    await expect(composer.getByRole("button", { name: "Priority: High" })).toBeVisible();
    await composer.getByRole("button", { name: /^Assignee:/ }).click();
    await page.getByRole("option", { name: /Wren Writer/ }).click();
    await composer.getByRole("button", { name: /^Status:/ }).click();
    await page.getByRole("option", { name: /In Progress/ }).click();

    await composer.getByRole("switch", { name: "Create more" }).click();
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByText(/^Created [A-Z0-9]+-1$/)).toBeVisible();
    // Create more keeps the composer open with properties, clearing the text.
    await expect(composer.getByLabel("Issue title")).toHaveValue("");
    await expect(composer.getByRole("button", { name: "Priority: High" })).toBeVisible();
    await composer.getByLabel("Issue title").fill("Second one");
    await composer.getByRole("button", { name: "Create issue" }).click();
    await expect(page.getByText(/^Created [A-Z0-9]+-2$/)).toBeVisible();

    // Drafts survive closing the composer.
    await composer.getByRole("switch", { name: "Create more" }).click();
    await composer.getByLabel("Issue title").fill("Half-written thought");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await expect(composer).toBeHidden();
    await page.getByRole("button", { name: "New issue" }).click();
    await expect(page.getByRole("dialog", { name: "New issue" }).getByLabel("Issue title")).toHaveValue("Half-written thought");
  });
});
