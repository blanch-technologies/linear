import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { workspaceRole } from "./schema";
import { authedAction, systemMutation, workspaceInternalMutation, workspaceQuery } from "./lib/functions";
import { fail } from "./lib/errors";
import { countActiveOwners, membershipInWorkspace, userSummary } from "./lib/members";
import { removeTeamMemberships } from "./lib/teams";
import type { Viewer } from "./lib/viewer";
import { workos, workosErrorMessage } from "./lib/workos";
import {
  canChangeMemberRole,
  canRemoveMember,
  canSuspendMember,
  canViewMemberDirectory,
  workspaceRoles,
  wouldRemoveLastOwner,
  type WorkspaceRole,
} from "../src/lib/permissions";

/*
 * Member administration. The mirror is changed first, in a mutation that
 * checks permissions and the last-owner rule atomically (D-16), then WorkOS is
 * updated. If WorkOS refuses, the mirror change is undone.
 */

const lastOwnerMessage = "A workspace needs at least one owner. Make someone else an owner first.";

/** Members settings. Guests see only themselves (D-18). */
export const list = workspaceQuery({
  args: {},
  handler: async ({ db, viewer }) => {
    const { actor, workspace } = viewer;
    const rows: Doc<"memberships">[] = canViewMemberDirectory(actor, workspace._id)
      ? (
          await Promise.all(
            (["active", "suspended"] as const).map((status) =>
              db
                .query("memberships")
                .withIndex("by_workspace_and_status_and_role", (q) =>
                  q.eq("workspaceId", workspace._id).eq("status", status),
                )
                .take(1000),
            ),
          )
        ).flat()
      : [viewer.membership];
    const ownerCount = await countActiveOwners(db, workspace._id);

    const members = await Promise.all(
      rows.map(async (membership) => {
        const user = await db.get(membership.userId);
        if (!user) return null;
        const target = { workspaceId: workspace._id, userId: user._id, role: membership.role };
        const lastOwner = membership.status === "active" && wouldRemoveLastOwner(ownerCount, membership.role, null);
        return {
          membershipId: membership._id,
          user: userSummary(user),
          role: membership.role,
          status: membership.status,
          isViewer: user._id === viewer.user._id,
          can: {
            changeRoleTo: lastOwner
              ? []
              : workspaceRoles.filter((role) => role !== membership.role && canChangeMemberRole(actor, target, role)),
            remove: !lastOwner && canRemoveMember(actor, target),
            suspend: !lastOwner && membership.status === "active" && canSuspendMember(actor, target),
            reactivate: membership.status === "suspended" && canSuspendMember(actor, target),
          },
        };
      }),
    );
    return members
      .filter((member) => member !== null)
      .sort((a, b) => a.user.name.localeCompare(b.user.name));
  },
});

async function targetFor(ctx: { db: import("./_generated/server").DatabaseReader; viewer: Viewer }, membershipId: Id<"memberships">) {
  const membership = await membershipInWorkspace(ctx.db, ctx.viewer.workspace._id, membershipId);
  if (!membership) fail("NOT_FOUND", "Member not found.");
  const user = await ctx.db.get(membership.userId);
  if (!user) fail("NOT_FOUND", "Member not found.");
  return {
    membership,
    user,
    target: { workspaceId: membership.workspaceId, userId: membership.userId, role: membership.role },
  };
}

async function assertKeepsOwner(
  ctx: { db: import("./_generated/server").DatabaseReader; viewer: Viewer },
  membership: Doc<"memberships">,
  nextRole: WorkspaceRole | null,
) {
  if (membership.status !== "active") return;
  const owners = await countActiveOwners(ctx.db, ctx.viewer.workspace._id);
  if (wouldRemoveLastOwner(owners, membership.role, nextRole)) fail("LAST_OWNER", lastOwnerMessage);
}

// --- Role changes -----------------------------------------------------------

export const changeRole = authedAction({
  args: { membershipId: v.id("memberships"), role: workspaceRole },
  handler: async (ctx, args): Promise<null> => {
    const change = await ctx.runMutation(internal.members.applyRoleChange, args);
    if (!change) return null;
    try {
      await workos().userManagement.updateOrganizationMembership(change.workosMembershipId, { roleSlug: args.role });
    } catch (error) {
      await ctx.runMutation(internal.members.restoreMembership, { membershipId: args.membershipId, role: change.previousRole });
      fail("UPSTREAM", `Couldn't change the role: ${workosErrorMessage(error)}`);
    }
    await ctx.runMutation(internal.audit.record, change.audit);
    return null;
  },
});

export const applyRoleChange = workspaceInternalMutation({
  args: { membershipId: v.id("memberships"), role: workspaceRole },
  handler: async (ctx, { membershipId, role }) => {
    const { membership, user, target } = await targetFor(ctx, membershipId);
    if (membership.role === role) return null;
    if (!canChangeMemberRole(ctx.viewer.actor, target, role)) {
      fail("FORBIDDEN", role === "owner" || membership.role === "owner" ? "Only owners can change ownership." : "Only admins can change roles.");
    }
    await assertKeepsOwner(ctx, membership, role);
    if (role === "guest") await assertNoRestrictedTeams(ctx, membership);
    await ctx.db.patch(membership._id, { role, updatedAt: Date.now() });
    return {
      workosMembershipId: membership.workosMembershipId,
      previousRole: membership.role,
      audit: {
        action: "member.role_changed" as const,
        targets: [{ type: "user", id: user.workosUserId, name: user.name }],
        metadata: { from: membership.role, to: role },
      },
    };
  },
});

async function assertNoRestrictedTeams(
  ctx: { db: import("./_generated/server").DatabaseReader; viewer: Viewer },
  membership: Doc<"memberships">,
) {
  const rows = await ctx.db
    .query("teamMembers")
    .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", membership.workspaceId).eq("userId", membership.userId))
    .take(1000);
  const restricted = rows.filter((row) => ctx.viewer.teams.get(row.teamId)?.visibility === "restricted");
  if (restricted.length > 0) {
    fail("INVALID", "Guests can't be in restricted teams. Remove them from those teams first.");
  }
}

/** Undo for a mirror change WorkOS rejected. Internal only; no permission check. */
export const restoreMembership = systemMutation({
  args: {
    membershipId: v.id("memberships"),
    role: v.optional(workspaceRole),
    status: v.optional(v.union(v.literal("active"), v.literal("suspended"))),
  },
  handler: async (ctx, { membershipId, ...fields }) => {
    const membership = await ctx.db.get(membershipId);
    if (membership) await ctx.db.patch(membershipId, { ...fields, updatedAt: Date.now() });
  },
});

// --- Suspension -------------------------------------------------------------

export const setSuspended = authedAction({
  args: { membershipId: v.id("memberships"), suspended: v.boolean() },
  handler: async (ctx, args): Promise<null> => {
    const change = await ctx.runMutation(internal.members.applySuspension, args);
    if (!change) return null;
    try {
      const memberships = workos().userManagement;
      if (args.suspended) await memberships.deactivateOrganizationMembership(change.workosMembershipId);
      else await memberships.reactivateOrganizationMembership(change.workosMembershipId);
    } catch (error) {
      await ctx.runMutation(internal.members.restoreMembership, {
        membershipId: args.membershipId,
        status: change.previousStatus,
      });
      fail("UPSTREAM", `Couldn't update the member: ${workosErrorMessage(error)}`);
    }
    await ctx.runMutation(internal.audit.record, change.audit);
    return null;
  },
});

export const applySuspension = workspaceInternalMutation({
  args: { membershipId: v.id("memberships"), suspended: v.boolean() },
  handler: async (ctx, { membershipId, suspended }) => {
    const { membership, user, target } = await targetFor(ctx, membershipId);
    const status = suspended ? "suspended" : "active";
    if (membership.status === status) return null;
    if (!canSuspendMember(ctx.viewer.actor, target)) fail("FORBIDDEN", "You can't suspend this member.");
    if (suspended) await assertKeepsOwner(ctx, membership, null);
    await ctx.db.patch(membership._id, { status, updatedAt: Date.now() });
    return {
      workosMembershipId: membership.workosMembershipId,
      previousStatus: membership.status,
      audit: {
        action: suspended ? ("member.suspended" as const) : ("member.reactivated" as const),
        targets: [{ type: "user", id: user.workosUserId, name: user.name }],
      },
    };
  },
});

// --- Removal and leaving ----------------------------------------------------

/** Removes a member, or the caller themselves (leave). */
export const remove = authedAction({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, args): Promise<null> => {
    const removed = await ctx.runMutation(internal.members.applyRemoval, args);
    try {
      await workos().userManagement.deleteOrganizationMembership(removed.membership.workosMembershipId);
    } catch (error) {
      await ctx.runMutation(internal.members.restoreRemoval, { membership: removed.membership, teams: removed.teams });
      fail("UPSTREAM", `Couldn't remove the member: ${workosErrorMessage(error)}`);
    }
    // Leaving drops the caller's own access, so the event is recorded by the system.
    await ctx.runMutation(internal.audit.recordAs, { ...removed.audit, actorId: removed.actorId, workspaceId: removed.membership.workspaceId });
    return null;
  },
});

const membershipSnapshot = v.object({
  workspaceId: v.id("workspaces"),
  userId: v.id("users"),
  workosMembershipId: v.string(),
  role: workspaceRole,
  status: v.union(v.literal("active"), v.literal("suspended")),
});
const teamMemberSnapshot = v.object({
  teamId: v.id("teams"),
  role: v.union(v.literal("owner"), v.literal("member")),
});

export const applyRemoval = workspaceInternalMutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, { membershipId }) => {
    const { membership, user, target } = await targetFor(ctx, membershipId);
    if (!canRemoveMember(ctx.viewer.actor, target)) fail("FORBIDDEN", "Only admins can remove members.");
    await assertKeepsOwner(ctx, membership, null);
    const teamRows = await ctx.db
      .query("teamMembers")
      .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", membership.workspaceId).eq("userId", membership.userId))
      .take(1000);
    await removeTeamMemberships(ctx, membership.userId, teamRows.map((row) => row.teamId));
    await ctx.db.delete(membership._id);
    return {
      audit: {
        action: "member.removed" as const,
        targets: [{ type: "user", id: user.workosUserId, name: user.name }],
      },
      membership: {
        workspaceId: membership.workspaceId,
        userId: membership.userId,
        workosMembershipId: membership.workosMembershipId,
        role: membership.role,
        status: membership.status,
      },
      teams: teamRows.map((row) => ({ teamId: row.teamId, role: row.role })),
      actorId: ctx.viewer.user._id,
    };
  },
});

export const restoreRemoval = systemMutation({
  args: { membership: membershipSnapshot, teams: v.array(teamMemberSnapshot) },
  handler: async (ctx, { membership, teams }) => {
    await ctx.db.insert("memberships", { ...membership, updatedAt: Date.now() });
    for (const team of teams) {
      if (await ctx.db.get(team.teamId)) {
        await ctx.db.insert("teamMembers", { workspaceId: membership.workspaceId, userId: membership.userId, ...team });
      }
    }
  },
});

/**
 * People the viewer may see by name: everyone active for non-guests; for guests
 * only themselves and members of their teams (D-18). Used to show assignees.
 */
export const directory = workspaceQuery({
  args: {},
  handler: async ({ db, viewer }) => {
    const { actor, workspace } = viewer;
    const memberships = await db
      .query("memberships")
      .withIndex("by_workspace_and_status_and_role", (q) => q.eq("workspaceId", workspace._id).eq("status", "active"))
      .take(5000);
    let allowed: Set<string> | null = null;
    if (!canViewMemberDirectory(actor, workspace._id)) {
      allowed = new Set([viewer.user._id as string]);
      for (const teamId of actor.teams.keys()) {
        const rows = await db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", teamId as Id<"teams">)).take(1000);
        for (const row of rows) allowed.add(row.userId);
      }
    }
    const people = [];
    for (const membership of memberships) {
      if (allowed && !allowed.has(membership.userId)) continue;
      const user = await db.get(membership.userId);
      if (user) people.push(userSummary(user));
    }
    return people.sort((a, b) => a.name.localeCompare(b.name));
  },
});
