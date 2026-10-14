import { v } from "convex/values";
import { internal } from "./_generated/api";
import { workspaceRole } from "./schema";
import { authedAction, workspaceInternalMutation, workspaceInternalQuery, workspaceQuery } from "./lib/functions";
import { fail } from "./lib/errors";
import { workos, workosErrorMessage } from "./lib/workos";
import { canInvite, canManageInvitation, canManageWorkspace } from "../src/lib/permissions";
import { validateEmail } from "../src/lib/validation";

/*
 * Invitations are WorkOS invitations (D-9); this table mirrors them so the
 * members page can list them. WorkOS emails the invitee unless its email
 * delivery is switched off for the environment (see docs/runbook.md). When the
 * invitee signs in through the link, WorkOS creates the membership and the
 * session sync marks the invitation accepted.
 */

const invitationLifetimeDays = 7;

export const list = workspaceQuery({
  args: {},
  handler: async ({ db, viewer }) => {
    const { actor, workspace } = viewer;
    if (!canManageWorkspace(actor, workspace._id)) return [];
    const now = Date.now();
    const pending = await db
      .query("invitations")
      .withIndex("by_workspace_and_state", (q) => q.eq("workspaceId", workspace._id).eq("state", "pending"))
      .take(500);
    return pending
      .map((invitation) => ({
        id: invitation._id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        expired: invitation.expiresAt < now,
        acceptUrl: invitation.acceptUrl,
        can: { manage: canManageInvitation(actor, workspace._id, invitation.role) },
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  },
});

/** Checks before anything is sent to WorkOS. Rechecked when the mirror row is written. */
export const prepare = workspaceInternalQuery({
  args: { email: v.string(), role: workspaceRole },
  handler: async ({ db, viewer }, { email, role }) => {
    const { actor, workspace } = viewer;
    if (!canInvite(actor, workspace._id, role)) {
      fail("FORBIDDEN", role === "owner" ? "Only owners can invite owners." : "Only admins can invite people.");
    }
    const address = validateEmail(email);
    if (!address.ok) fail("INVALID", address.message);
    const user = await db.query("users").withIndex("by_email", (q) => q.eq("email", address.value)).first();
    if (user) {
      const membership = await db
        .query("memberships")
        .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspace._id).eq("userId", user._id))
        .unique();
      if (membership) fail("CONFLICT", `${address.value} is already a member.`);
    }
    const existing = await db
      .query("invitations")
      .withIndex("by_workspace_and_email", (q) => q.eq("workspaceId", workspace._id).eq("email", address.value))
      .take(20);
    if (existing.some((invitation) => invitation.state === "pending" && invitation.expiresAt > Date.now())) {
      fail("CONFLICT", `${address.value} already has a pending invitation.`);
    }
    return {
      email: address.value,
      organizationId: workspace.workosOrganizationId,
      inviterWorkosUserId: viewer.user.workosUserId,
    };
  },
});

export const send = authedAction({
  args: { email: v.string(), role: workspaceRole },
  handler: async (ctx, { email, role }): Promise<null> => {
    const prepared = await ctx.runQuery(internal.invitations.prepare, { email, role });
    let invitation;
    try {
      invitation = await workos().userManagement.sendInvitation({
        email: prepared.email,
        organizationId: prepared.organizationId,
        inviterUserId: prepared.inviterWorkosUserId,
        roleSlug: role,
        expiresInDays: invitationLifetimeDays,
      });
    } catch (error) {
      fail("UPSTREAM", `Couldn't send the invitation: ${workosErrorMessage(error)}`);
    }
    await ctx.runMutation(internal.invitations.insertSent, {
      email: prepared.email,
      role,
      workosInvitationId: invitation.id,
      expiresAt: Date.parse(invitation.expiresAt),
      acceptUrl: invitation.acceptInvitationUrl,
    });
    return null;
  },
});

export const insertSent = workspaceInternalMutation({
  args: {
    email: v.string(),
    role: workspaceRole,
    workosInvitationId: v.string(),
    expiresAt: v.number(),
    acceptUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspace, user } = ctx.viewer;
    // Expired rows for the same address are superseded by the new one.
    const previous = await ctx.db
      .query("invitations")
      .withIndex("by_workspace_and_email", (q) => q.eq("workspaceId", workspace._id).eq("email", args.email))
      .take(20);
    for (const row of previous) {
      if (row.state === "pending") await ctx.db.patch(row._id, { state: "expired" });
    }
    const invitationId = await ctx.db.insert("invitations", {
      workspaceId: workspace._id,
      invitedBy: user._id,
      state: "pending",
      ...args,
    });
    await ctx.audit({
      action: "invitation.sent",
      targets: [{ type: "invitation", id: args.workosInvitationId, name: args.email }],
      metadata: { email: args.email, role: args.role },
    });
    return invitationId;
  },
});

export const prepareChange = workspaceInternalQuery({
  args: { invitationId: v.id("invitations") },
  handler: async ({ db, viewer }, { invitationId }) => {
    const invitation = await db.get(invitationId);
    if (!invitation || invitation.workspaceId !== viewer.workspace._id) fail("NOT_FOUND", "Invitation not found.");
    if (!canManageInvitation(viewer.actor, viewer.workspace._id, invitation.role)) {
      fail("FORBIDDEN", "You can't change this invitation.");
    }
    if (invitation.state !== "pending") fail("CONFLICT", "This invitation is no longer pending.");
    return invitation;
  },
});

export const revoke = authedAction({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }): Promise<null> => {
    const invitation = await ctx.runQuery(internal.invitations.prepareChange, { invitationId });
    try {
      await workos().userManagement.revokeInvitation(invitation.workosInvitationId);
    } catch (error) {
      fail("UPSTREAM", `Couldn't revoke the invitation: ${workosErrorMessage(error)}`);
    }
    await ctx.runMutation(internal.invitations.markRevoked, { invitationId });
    return null;
  },
});

export const markRevoked = workspaceInternalMutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId);
    if (!invitation || invitation.workspaceId !== ctx.viewer.workspace._id) return;
    await ctx.db.patch(invitationId, { state: "revoked" });
    await ctx.audit({
      action: "invitation.revoked",
      targets: [{ type: "invitation", id: invitation.workosInvitationId, name: invitation.email }],
      metadata: { email: invitation.email },
    });
  },
});

/** Sends the email again and extends the expiry. */
export const resend = authedAction({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }): Promise<null> => {
    const invitation = await ctx.runQuery(internal.invitations.prepareChange, { invitationId });
    let updated;
    try {
      updated = await workos().userManagement.resendInvitation(invitation.workosInvitationId);
    } catch (error) {
      fail("UPSTREAM", `Couldn't resend the invitation: ${workosErrorMessage(error)}`);
    }
    await ctx.runMutation(internal.invitations.markResent, {
      invitationId,
      expiresAt: Date.parse(updated.expiresAt),
      acceptUrl: updated.acceptInvitationUrl,
    });
    return null;
  },
});

export const markResent = workspaceInternalMutation({
  args: { invitationId: v.id("invitations"), expiresAt: v.number(), acceptUrl: v.string() },
  handler: async (ctx, { invitationId, ...fields }) => {
    const invitation = await ctx.db.get(invitationId);
    if (invitation && invitation.workspaceId === ctx.viewer.workspace._id) await ctx.db.patch(invitationId, fields);
  },
});
