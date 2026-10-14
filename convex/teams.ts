import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { teamRole, teamVisibility } from "./schema";
import { workspaceMutation, workspaceQuery } from "./lib/functions";
import { fail } from "./lib/errors";
import { userSummary } from "./lib/members";
import { assertTeamKeyFree, insertTeamWithDefaults, removeTeamMemberships } from "./lib/teams";
import { requireTeam, toTeam, type Viewer } from "./lib/viewer";
import {
  canAddTeamMember,
  canCreateSubTeam,
  canCreateTeam,
  canDeleteTeam,
  canJoinTeam,
  canManageTeam,
  canReadTeamContent,
  canRemoveTeamMember,
  canReparentTeam,
  canSeeTeam,
  canWriteTeamContent,
  descendants,
  placementErrorMessages,
  teamMembershipError,
  teamMembershipErrorMessages,
  validateTeamPlacement,
  type TeamRole,
  type TeamVisibility,
} from "../src/lib/permissions";
import { validateDescription, validateName, validateTeamKey } from "../src/lib/validation";

function summarize(viewer: Viewer, doc: Doc<"teams">) {
  const team = toTeam(doc);
  const { actor } = viewer;
  return {
    id: doc._id,
    name: doc.name,
    key: doc.key,
    description: doc.description ?? "",
    parentId: doc.parentId,
    visibility: doc.visibility,
    estimateScale: doc.estimateScale ?? null,
    teamRole: actor.teams.get(doc._id) ?? null,
    can: {
      read: canReadTeamContent(actor, team),
      write: canWriteTeamContent(actor, team),
      manage: canManageTeam(actor, team, viewer.graph),
      join: canJoinTeam(actor, team),
      leave: actor.teams.has(doc._id),
      reparent: canReparentTeam(actor, team),
      delete: canDeleteTeam(actor, team),
      createSubTeam: canCreateSubTeam(actor, team, viewer.graph),
    },
  };
}

export type TeamSummary = ReturnType<typeof summarize>;

/** Teams the viewer can see (sidebar, pickers, settings), in name order. */
export const list = workspaceQuery({
  args: {},
  handler: async ({ viewer }) =>
    [...viewer.teams.values()]
      .filter((doc) => canSeeTeam(viewer.actor, toTeam(doc)))
      .map((doc) => summarize(viewer, doc))
      .sort((a, b) => a.name.localeCompare(b.name)),
});

/** Team settings page. Members are listed to anyone who can see the team. */
export const byKey = workspaceQuery({
  args: { key: v.string() },
  handler: async ({ db, viewer }, { key }) => {
    const doc = await db
      .query("teams")
      .withIndex("by_workspace_and_key", (q) => q.eq("workspaceId", viewer.workspace._id).eq("key", key.toUpperCase()))
      .unique();
    if (!doc || !canSeeTeam(viewer.actor, toTeam(doc))) return null;
    const rows = await db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", doc._id)).take(1000);
    const members = (
      await Promise.all(
        rows.map(async (row) => {
          const user = await db.get(row.userId);
          return user && { user: userSummary(user), role: row.role, isViewer: user._id === viewer.user._id };
        }),
      )
    )
      .filter((member) => member !== null)
      .sort((a, b) => a.user.name.localeCompare(b.user.name));
    const parent = doc.parentId ? viewer.teams.get(doc.parentId) : undefined;
    return {
      ...summarize(viewer, doc),
      parent: parent && canSeeTeam(viewer.actor, toTeam(parent)) ? { id: parent._id, name: parent.name, key: parent.key } : null,
      hasIssues: doc.issueCounter > 0,
      members,
    };
  },
});

async function teamMembershipsOf(db: DatabaseReader, workspaceId: Id<"workspaces">, userId: Id<"users">) {
  const rows = await db
    .query("teamMembers")
    .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
    .take(1000);
  return new Map<string, TeamRole>(rows.map((row) => [row.teamId, row.role]));
}

function teamTarget(doc: Doc<"teams">) {
  return { type: "team", id: doc._id, name: `${doc.name} (${doc.key})` };
}

export const create = workspaceMutation({
  args: {
    name: v.string(),
    key: v.string(),
    description: v.optional(v.string()),
    visibility: teamVisibility,
    parentId: v.optional(v.id("teams")),
  },
  handler: async (ctx, args) => {
    const { viewer } = ctx;
    const { actor, workspace, user } = viewer;
    if (!canCreateTeam(actor, workspace._id)) fail("FORBIDDEN", "Guests can't create teams.");
    const name = validateName(args.name, "Team name");
    if (!name.ok) fail("INVALID", name.message);
    const key = validateTeamKey(args.key);
    if (!key.ok) fail("INVALID", key.message);
    const description = validateDescription(args.description);
    if (!description.ok) fail("INVALID", description.message);
    const parentId = args.parentId ?? null;
    if (parentId) {
      const parent = requireTeam(viewer, parentId, "see");
      if (!canCreateSubTeam(actor, toTeam(parent), viewer.graph)) {
        fail("FORBIDDEN", "Only members of the parent team can add sub-teams.");
      }
    }
    const placement = validateTeamPlacement(viewer.graph, {
      workspaceId: workspace._id,
      parentId,
      visibility: args.visibility,
    });
    if (placement) fail("INVALID", placementErrorMessages[placement]);

    const teamId = await insertTeamWithDefaults(ctx, {
      workspaceId: workspace._id,
      name: name.value,
      key: key.value,
      description: description.value || undefined,
      parentId,
      visibility: args.visibility,
      createdBy: user._id,
    });
    const team = { id: teamId, workspaceId: workspace._id, parentId, visibility: args.visibility };
    // The creator joins as owner when the membership rules allow it; an admin
    // creating a sub-team of a team they aren't in manages it without joining.
    if (!teamMembershipError(team, { role: actor.role, teams: actor.teams })) {
      await ctx.db.insert("teamMembers", { workspaceId: workspace._id, teamId, userId: user._id, role: "owner" });
    }
    const doc = (await ctx.db.get(teamId))!;
    await ctx.audit({ action: "team.created", targets: [teamTarget(doc)], metadata: { visibility: args.visibility } });
    return { teamId, key: key.value };
  },
});

export const update = workspaceMutation({
  args: {
    teamId: v.id("teams"),
    name: v.optional(v.string()),
    key: v.optional(v.string()),
    description: v.optional(v.string()),
    visibility: v.optional(teamVisibility),
  },
  handler: async (ctx, args) => {
    const { viewer } = ctx;
    const doc = requireTeam(viewer, args.teamId, "manage");
    const patch: Partial<Pick<Doc<"teams">, "name" | "key" | "description" | "visibility">> = {};
    if (args.name !== undefined) {
      const name = validateName(args.name, "Team name");
      if (!name.ok) fail("INVALID", name.message);
      patch.name = name.value;
    }
    if (args.key !== undefined && args.key.toUpperCase() !== doc.key) {
      const key = validateTeamKey(args.key);
      if (!key.ok) fail("INVALID", key.message);
      // D-24: issue identifiers never change, so the key is fixed once issues exist.
      if (doc.issueCounter > 0) fail("INVALID", "The identifier can't change after issues have been created.");
      await assertTeamKeyFree(ctx, doc.workspaceId, key.value, doc._id);
      patch.key = key.value;
    }
    if (args.description !== undefined) {
      const description = validateDescription(args.description);
      if (!description.ok) fail("INVALID", description.message);
      patch.description = description.value;
    }
    if (args.visibility !== undefined && args.visibility !== doc.visibility) {
      await assertVisibilityChange(ctx.db, viewer, doc, args.visibility);
      patch.visibility = args.visibility;
    }
    if (Object.keys(patch).length === 0) return null;
    await ctx.db.patch(doc._id, patch);
    const updated = (await ctx.db.get(doc._id))!;
    if (patch.visibility) {
      await ctx.audit({
        action: "team.visibility_changed",
        targets: [teamTarget(updated)],
        metadata: { from: doc.visibility, to: patch.visibility },
      });
    }
    if (patch.name || patch.key || patch.description !== undefined) {
      await ctx.audit({ action: "team.updated", targets: [teamTarget(updated)] });
    }
    return null;
  },
});

async function assertVisibilityChange(db: DatabaseReader, viewer: Viewer, doc: Doc<"teams">, visibility: TeamVisibility) {
  const placement = validateTeamPlacement(viewer.graph, {
    id: doc._id,
    workspaceId: doc.workspaceId,
    parentId: doc.parentId,
    visibility,
  });
  if (placement) fail("INVALID", placementErrorMessages[placement]);
  if (visibility === "restricted") {
    const rows = await db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", doc._id)).take(1000);
    for (const row of rows) {
      const membership = await db
        .query("memberships")
        .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", doc.workspaceId).eq("userId", row.userId))
        .unique();
      if (membership?.role === "guest") fail("INVALID", "Remove guests from this team before making it restricted.");
    }
  }
}

/** D-17: admin-only. Every non-guest member must already be in the new parent. */
export const reparent = workspaceMutation({
  args: { teamId: v.id("teams"), parentId: v.union(v.id("teams"), v.null()) },
  handler: async (ctx, { teamId, parentId }) => {
    const { viewer } = ctx;
    const doc = requireTeam(viewer, teamId, "see");
    if (!canReparentTeam(viewer.actor, toTeam(doc))) fail("FORBIDDEN", "Only admins can move teams.");
    if (doc.parentId === parentId) return null;
    const parent = parentId ? requireTeam(viewer, parentId, "see") : null;
    const placement = validateTeamPlacement(viewer.graph, {
      id: doc._id,
      workspaceId: doc.workspaceId,
      parentId,
      visibility: doc.visibility,
    });
    if (placement) fail("INVALID", placementErrorMessages[placement]);
    if (parent) {
      const rows = await ctx.db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", doc._id)).take(1000);
      let missing = 0;
      for (const row of rows) {
        const memberships = await teamMembershipsOf(ctx.db, doc.workspaceId, row.userId);
        const role = (
          await ctx.db
            .query("memberships")
            .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", doc.workspaceId).eq("userId", row.userId))
            .unique()
        )?.role;
        if (role && role !== "guest" && !memberships.has(parent._id)) missing += 1;
      }
      if (missing > 0) {
        fail("INVALID", `${missing} member${missing === 1 ? " isn't" : "s aren't"} in ${parent.name}. Add them to it first.`);
      }
    }
    const previous = doc.parentId ? viewer.teams.get(doc.parentId) : undefined;
    await ctx.db.patch(doc._id, { parentId });
    await ctx.audit({
      action: "team.reparented",
      targets: [teamTarget(doc)],
      metadata: { from: previous?.key ?? "(top level)", to: parent?.key ?? "(top level)" },
    });
    return null;
  },
});

/** Deletes an empty team (no issues, no sub-teams). Archiving arrives with issues. */
export const remove = workspaceMutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const { viewer } = ctx;
    const doc = requireTeam(viewer, teamId, "see");
    if (!canDeleteTeam(viewer.actor, toTeam(doc))) fail("FORBIDDEN", "Only admins can delete teams.");
    if (descendants(viewer.graph, doc._id).length > 0) fail("INVALID", "Move or delete its sub-teams first.");
    const issue = await ctx.db.query("issues").withIndex("by_team_and_number", (q) => q.eq("teamId", doc._id)).first();
    if (issue || doc.issueCounter > 0) fail("INVALID", "Teams with issues can't be deleted yet.");
    const [members, states] = await Promise.all([
      ctx.db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", doc._id)).take(1000),
      ctx.db.query("workflowStates").withIndex("by_team_and_position", (q) => q.eq("teamId", doc._id)).take(200),
    ]);
    for (const row of [...members, ...states]) await ctx.db.delete(row._id);
    await ctx.db.delete(doc._id);
    await ctx.audit({ action: "team.deleted", targets: [teamTarget(doc)] });
    return null;
  },
});

// --- Membership -------------------------------------------------------------

export const addMember = workspaceMutation({
  args: { teamId: v.id("teams"), userId: v.id("users"), role: v.optional(teamRole) },
  handler: async (ctx, { teamId, userId, role = "member" }) => {
    const { viewer } = ctx;
    const doc = requireTeam(viewer, teamId, "see");
    const team = toTeam(doc);
    if (!canAddTeamMember(viewer.actor, team, viewer.graph, userId)) {
      fail("FORBIDDEN", userId === viewer.user._id ? "You can't join this team." : "Only team managers can add members.");
    }
    // Only managers choose roles; joining yourself makes you a member.
    if (role === "owner" && !canManageTeam(viewer.actor, team, viewer.graph)) fail("FORBIDDEN", "Only team managers can add owners.");
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", doc.workspaceId).eq("userId", userId))
      .unique();
    if (!membership || membership.status !== "active") fail("NOT_FOUND", "That person isn't an active member of this workspace.");
    const existing = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_and_user", (q) => q.eq("teamId", doc._id).eq("userId", userId))
      .unique();
    if (existing) return null;
    const error = teamMembershipError(team, {
      role: membership.role,
      teams: await teamMembershipsOf(ctx.db, doc.workspaceId, userId),
    });
    if (error) fail("INVALID", teamMembershipErrorMessages[error]);
    await ctx.db.insert("teamMembers", { workspaceId: doc.workspaceId, teamId: doc._id, userId, role });
    const user = await ctx.db.get(userId);
    await ctx.audit({
      action: "team.member_added",
      targets: [teamTarget(doc), { type: "user", id: user?.workosUserId ?? userId, name: user?.name }],
      metadata: { role },
    });
    return null;
  },
});

/** Removes a member (or leaves) and, with them, their sub-team memberships. */
export const removeMember = workspaceMutation({
  args: { teamId: v.id("teams"), userId: v.id("users") },
  handler: async (ctx, { teamId, userId }) => {
    const { viewer } = ctx;
    const doc = requireTeam(viewer, teamId, "see");
    if (!canRemoveTeamMember(viewer.actor, toTeam(doc), viewer.graph, userId)) {
      fail("FORBIDDEN", "Only team managers can remove members.");
    }
    const existing = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_and_user", (q) => q.eq("teamId", doc._id).eq("userId", userId))
      .unique();
    if (!existing) return null;
    await removeTeamMemberships(ctx, userId, [doc._id, ...descendants(viewer.graph, doc._id).map((t) => t.id as Id<"teams">)]);
    const user = await ctx.db.get(userId);
    await ctx.audit({
      action: "team.member_removed",
      targets: [teamTarget(doc), { type: "user", id: user?.workosUserId ?? userId, name: user?.name }],
    });
    return null;
  },
});

export const setMemberRole = workspaceMutation({
  args: { teamId: v.id("teams"), userId: v.id("users"), role: teamRole },
  handler: async (ctx, { teamId, userId, role }) => {
    const doc = requireTeam(ctx.viewer, teamId, "manage");
    const existing = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_and_user", (q) => q.eq("teamId", doc._id).eq("userId", userId))
      .unique();
    if (!existing) fail("NOT_FOUND", "They aren't a member of this team.");
    if (existing.role === role) return null;
    await ctx.db.patch(existing._id, { role });
    const user = await ctx.db.get(userId);
    await ctx.audit({
      action: "team.member_role_changed",
      targets: [teamTarget(doc), { type: "user", id: user?.workosUserId ?? userId, name: user?.name }],
      metadata: { from: existing.role, to: role },
    });
    return null;
  },
});

/**
 * People who can read a team's issues: assignee and @-mention candidates.
 * Readability depends only on membership in this team and its parent, so
 * that's all each candidate's actor carries.
 */
export const assignable = workspaceQuery({
  args: { teamId: v.id("teams") },
  handler: async ({ db, viewer }, { teamId }) => {
    const doc = requireTeam(viewer, teamId, "read");
    const team = toTeam(doc);
    const [members, teamRows, parentRows] = await Promise.all([
      db
        .query("memberships")
        .withIndex("by_workspace_and_status_and_role", (q) => q.eq("workspaceId", doc.workspaceId).eq("status", "active"))
        .take(5000),
      db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", doc._id)).take(5000),
      doc.parentId ? db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", doc.parentId!)).take(5000) : Promise.resolve([]),
    ]);
    const inTeam = new Map(teamRows.map((row) => [row.userId as string, row.role]));
    const inParent = new Map(parentRows.map((row) => [row.userId as string, row.role]));
    const people = [];
    for (const membership of members) {
      const teams = new Map<string, TeamRole>();
      const own = inTeam.get(membership.userId);
      if (own) teams.set(doc._id, own);
      const parent = inParent.get(membership.userId);
      if (parent && doc.parentId) teams.set(doc.parentId, parent);
      const actor = { workspaceId: doc.workspaceId, userId: membership.userId, role: membership.role, teams };
      if (!canReadTeamContent(actor, team)) continue;
      const user = await db.get(membership.userId);
      if (user) people.push({ ...userSummary(user), inTeam: inTeam.has(membership.userId) });
    }
    return people.sort((a, b) => Number(b.inTeam) - Number(a.inTeam) || a.name.localeCompare(b.name));
  },
});
