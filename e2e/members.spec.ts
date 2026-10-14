import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createWorkspace, expect, signIn, test, testEmail } from "./support";

async function invite(page: Page, urlKey: string, email: string, role = "Member") {
  await page.goto(`/${urlKey}/settings/members`);
  await page.getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite to workspace" });
  await dialog.getByLabel("Email addresses").fill(email);
  if (role !== "Member") {
    await dialog.getByLabel("Role").click();
    await page.getByRole("option", { name: new RegExp(`^${role}`) }).click();
  }
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible();
  await expect(page.getByRole("list", { name: "Pending invitations" })).toContainText(email);
}

function memberRow(page: Page, name: string) {
  return page.getByTestId("member-row").filter({ hasText: name });
}

test.describe("members and invitations", () => {
  test("invite, accept, change role, suspend, reactivate, remove", async ({ browser }) => {
    const owner = await browser.newPage();
    await signIn(owner, "boss", { displayName: "Bea Boss" });
    const { name, urlKey } = await createWorkspace(owner, "Team");
    const email = testEmail("newbie");
    await invite(owner, urlKey, email);

    // The invitee follows the link (accepted through WorkOS), signs in, and lands in the workspace.
    const invitee = await browser.newPage();
    await signIn(invitee, "newbie", { displayName: "Nia Newbie", acceptInvitations: true });
    await invitee.goto("/");
    await expect(invitee.getByTestId("workspace-menu")).toContainText(name, { timeout: 30_000 });

    await owner.reload();
    await expect(memberRow(owner, "Nia Newbie")).toContainText("Member");
    await expect(owner.getByRole("list", { name: "Pending invitations" })).toHaveCount(0);

    await memberRow(owner, "Nia Newbie").getByRole("button", { name: "Actions for Nia Newbie" }).click();
    await owner.getByRole("menuitemradio", { name: "Admin" }).click();
    await owner.getByRole("button", { name: "Change role" }).click();
    await expect(memberRow(owner, "Nia Newbie")).toContainText("Admin");

    await memberRow(owner, "Nia Newbie").getByRole("button", { name: "Actions for Nia Newbie" }).click();
    await owner.getByRole("menuitem", { name: "Suspend" }).click();
    await owner.getByRole("button", { name: "Suspend" }).click();
    await expect(memberRow(owner, "Nia Newbie")).toContainText("Suspended");
    // WorkOS stops refreshing a session scoped to a deactivated membership, so
    // the invitee is signed out or, with a fresh token, sees the suspension.
    await invitee.goto(`/${urlKey}/my-issues`);
    await expect(invitee.getByRole("heading", { name: /is suspended|signed out/ })).toBeVisible();
    await expect(invitee.getByTestId("workspace-menu")).toHaveCount(0);

    await memberRow(owner, "Nia Newbie").getByRole("button", { name: "Actions for Nia Newbie" }).click();
    await owner.getByRole("menuitem", { name: "Reactivate" }).click();
    await expect(memberRow(owner, "Nia Newbie")).not.toContainText("Suspended");

    await memberRow(owner, "Nia Newbie").getByRole("button", { name: "Actions for Nia Newbie" }).click();
    await owner.getByRole("menuitem", { name: "Remove from workspace" }).click();
    await owner.getByRole("button", { name: "Remove" }).click();
    await expect(memberRow(owner, "Nia Newbie")).toHaveCount(0);
    await invitee.goto(`/${urlKey}/my-issues`);
    await expect(invitee.getByRole("heading", { name: /Workspace not found|signed out/ })).toBeVisible();
    await expect(invitee.getByTestId("workspace-menu")).toHaveCount(0);
  });

  test("the last owner can't leave, demote, or remove themselves", async ({ page }) => {
    await signIn(page, "solo", { displayName: "Solo Owner" });
    const { urlKey } = await createWorkspace(page, "Solo");
    await page.goto(`/${urlKey}/settings/members`);
    await expect(memberRow(page, "Solo Owner")).toContainText("Owner");
    await expect(memberRow(page, "Solo Owner").getByRole("button")).toHaveCount(0);
  });

  test("revokes a pending invitation, and the page passes axe", async ({ page }) => {
    await signIn(page, "revoker", { displayName: "Rae Revoker" });
    const { urlKey } = await createWorkspace(page, "Revoke");
    const email = testEmail("never");
    await invite(page, urlKey, email, "Guest");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: `Actions for invitation to ${email}` }).click();
    await page.getByRole("menuitem", { name: "Revoke invitation" }).click();
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByRole("list", { name: "Pending invitations" })).toHaveCount(0);
  });
});
