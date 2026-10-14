import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { authedAction, authedInternalMutation, recordAudit } from "./lib/functions";
import { fail } from "./lib/errors";
import { removeTeamMemberships } from "./lib/teams";
import { roleFromSlug, workos } from "./lib/workos";

/*
 * Session sync. Pulls the signed-in user's profile and organization
 * memberships from WorkOS into the mirror. The client runs it once per page
 * load, which picks up accepted invitations and changes made outside the app
 * (WorkOS dashboard, Admin Portal). Webhooks are deliberately not used yet:
 * they can't reach per-PR preview or local Convex deployments (ADR 0004).
 */

const profileValidator = v.object({
  workosUserId: v.string(),
  email: v.string(),
  name: v.string(),
  avatarUrl: v.optional(v.string()),
});

export function displayName(user: { firstName: string | null; lastName: string | null; email: string }): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email.split("@")[0]!;
}

/** Fetches the WorkOS profile for the caller, for actions that need a user row first. */
export async function fetchProfile(workosUserId: string) {
  const user = await workos().userManagement.getUser(workosUserId);
  return {
    workosUserId: user.id,
    email: user.email.toLowerCase(),
    name: displayName(user),
    avatarUrl: user.profilePictureUrl ?? undefined,
  };
}

export const sync = authedAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const listedAt = Date.now();
    const profile = await fetchProfile(ctx.identity.subject);
    const memberships = await workos()
      .userManagement.listOrganizationMemberships({
        userId: ctx.identity.subject,
        statuses: ["active", "inactive"],
        limit: 100,
      })
      .then((page) => page.autoPagination());
    await ctx.runMutation(internal.session.apply, {
      profile,
      listedAt,
      memberships: memberships.map((m) => ({
        workosMembershipId: m.id,
        workosOrganizationId: m.organizationId,
        role: roleFromSlug(m.role?.slug),
        status: m.status === "active" ? ("active" as const) : ("suspended" as const),
      })),
    });
    return null;
  },
});

/** Upserts the caller's user row only. Used before creating a workspace. */
export const upsertUser = authedInternalMutation({
  args: { profile: profileValidator },
  handler: async (ctx, { profile }): Promise<Id<"users">> => {
    if (profile.workosUserId !== ctx.identity.subject) fail("FORBIDDEN", "Profile does not match the session.");
    const fields = { ...profile, syncedAt: Date.now() };
    if (ctx.user) {
      await ctx.db.patch(ctx.user._id, fields);
      return ctx.user._id;
    }
    return await ctx.db.insert("users", fields);
  },
});

export const apply = authedInternalMutation({
  args: {
    profile: profileValidator,
    listedAt: v.number(),
    memberships: v.array(
      v.object({
        workosMembershipId: v.string(),
        workosOrganizationId: v.string(),
        role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("guest")),
        status: v.union(v.literal("active"), v.literal("suspended")),
      }),
    ),
  },
  handler: async (ctx, { profile, listedAt, memberships }) => {
    if (profile.workosUserId !== ctx.identity.subject) fail("FORBIDDEN", "Profile does not match the session.");
    const now = Date.now();
    let userId = ctx.user?._id;
    if (userId) await ctx.db.patch(userId, { ...profile, syncedAt: now });
    else userId = await ctx.db.insert("users", { ...profile, syncedAt: now });
    const user = (await ctx.db.get(userId))!;

    const seen = new Set<Id<"workspaces">>();
    for (const remote of memberships) {
      // Only organizations this deployment knows. A WorkOS environment can be
      // shared by several deployments (local, previews, staging).
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_workos_organization_id", (q) => q.eq("workosOrganizationId", remote.workosOrganizationId))
        .unique();
      if (!workspace) continue;
      seen.add(workspace._id);

      const local = await ctx.db
        .query("memberships")
        .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspace._id).eq("userId", userId))
        .unique();
      if (!local) {
        await ctx.db.insert("memberships", {
          workspaceId: workspace._id,
          userId,
          workosMembershipId: remote.workosMembershipId,
          role: remote.role,
          status: remote.status,
          updatedAt: now,
        });
        await markInvitationAccepted(ctx.db, workspace._id, profile.email);
        await recordAudit(ctx, { workspace, user }, {
          action: "member.joined",
          targets: [{ type: "user", id: profile.workosUserId, name: profile.name }],
          metadata: { role: remote.role },
        });
        continue;
      }
      // A change made in this app after WorkOS was listed wins; WorkOS catches
      // up through the action that made it.
      if (local.updatedAt > listedAt) continue;
      if (
        local.role !== remote.role ||
        local.status !== remote.status ||
        local.workosMembershipId !== remote.workosMembershipId
      ) {
        await ctx.db.patch(local._id, {
          role: remote.role,
          status: remote.status,
          workosMembershipId: remote.workosMembershipId,
          updatedAt: now,
        });
      }
    }

    // Memberships deleted in WorkOS since the last sync.
    const localMemberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(200);
    for (const local of localMemberships) {
      if (seen.has(local.workspaceId) || local.updatedAt > listedAt) continue;
      const teamRows = await ctx.db
        .query("teamMembers")
        .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", local.workspaceId).eq("userId", userId))
        .take(1000);
      await removeTeamMemberships(ctx, userId, teamRows.map((row) => row.teamId));
      await ctx.db.delete(local._id);
    }
    return null;
  },
});

async function markInvitationAccepted(
  db: import("./_generated/server").DatabaseWriter,
  workspaceId: Id<"workspaces">,
  email: string,
) {
  const pending = await db
    .query("invitations")
    .withIndex("by_workspace_and_email", (q) => q.eq("workspaceId", workspaceId).eq("email", email))
    .take(20);
  for (const invitation of pending) {
    if (invitation.state === "pending") await db.patch(invitation._id, { state: "accepted" });
  }
}
