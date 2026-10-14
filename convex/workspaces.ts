import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  authedAction,
  authedInternalMutation,
  authedQuery,
  recordAudit,
  systemQuery,
  workspaceInternalMutation,
  workspaceQuery,
} from "./lib/functions";
import { ensure, fail } from "./lib/errors";
import { userSummary } from "./lib/members";
import { insertTeamWithDefaults } from "./lib/teams";
import { organizationClaim } from "./lib/viewer";
import { workos, workosErrorMessage } from "./lib/workos";
import { fetchProfile } from "./session";
import {
  canCreateTeam,
  canInvite,
  canManageWorkspace,
  canViewMemberDirectory,
  canViewWorkspaceSurfaces,
  workspaceRoles,
} from "../src/lib/permissions";
import { suggestTeamKey, validateName, validateUrlKey } from "../src/lib/validation";

/** The signed-in user's workspaces, for the switcher and the root redirect. */
export const mine = authedQuery({
  args: {},
  handler: async (ctx) => {
    const activeOrganizationId = organizationClaim(ctx.identity);
    if (!ctx.user) return { synced: false as const, activeOrganizationId, user: null, workspaces: [] };
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user!._id))
      .take(200);
    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const workspace = await ctx.db.get(membership.workspaceId);
        return (
          workspace && {
            id: workspace._id,
            name: workspace.name,
            urlKey: workspace.urlKey,
            workosOrganizationId: workspace.workosOrganizationId,
            role: membership.role,
            suspended: membership.status !== "active",
          }
        );
      }),
    );
    return {
      synced: true as const,
      activeOrganizationId,
      user: userSummary(ctx.user),
      workspaces: rows.filter((row) => row !== null).sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

/** The current workspace and what the viewer may do in it. */
export const current = workspaceQuery({
  args: {},
  handler: async ({ viewer }) => {
    const { actor, workspace } = viewer;
    return {
      workspace: { id: workspace._id, name: workspace.name, urlKey: workspace.urlKey },
      viewer: { ...userSummary(viewer.user), role: actor.role },
      can: {
        manageWorkspace: canManageWorkspace(actor, workspace._id),
        viewMembers: canViewMemberDirectory(actor, workspace._id),
        viewWorkspaceSurfaces: canViewWorkspaceSurfaces(actor, workspace._id),
        createTeam: canCreateTeam(actor, workspace._id),
        inviteRoles: workspaceRoles.filter((role) => canInvite(actor, workspace._id, role)),
      },
    };
  },
});

export const isUrlKeyFree = systemQuery({
  args: { urlKey: v.string() },
  handler: async (ctx, { urlKey }) =>
    !(await ctx.db.query("workspaces").withIndex("by_url_key", (q) => q.eq("urlKey", urlKey)).first()),
});

/** Live availability for the URL field in create and rename forms. */
export const checkUrlKey = authedQuery({
  args: { urlKey: v.string() },
  handler: async (ctx, { urlKey }) => {
    const result = validateUrlKey(urlKey);
    if (!result.ok) return { ok: false as const, message: result.message };
    const taken = await ctx.db.query("workspaces").withIndex("by_url_key", (q) => q.eq("urlKey", result.value)).first();
    return taken ? { ok: false as const, message: "That URL is taken." } : { ok: true as const, message: null };
  },
});

/**
 * Creates a WorkOS organization with the caller as owner, then the workspace
 * mirror with a default team. If the mirror write fails, the organization is
 * deleted again so no orphan is left in WorkOS.
 */
export const create = authedAction({
  args: { name: v.string(), urlKey: v.string() },
  handler: async (ctx, args): Promise<{ urlKey: string; workosOrganizationId: string }> => {
    const name = validateName(args.name, "Workspace name");
    if (!name.ok) fail("INVALID", name.message);
    const urlKey = validateUrlKey(args.urlKey);
    if (!urlKey.ok) fail("INVALID", urlKey.message);
    if (!(await ctx.runQuery(internal.workspaces.isUrlKeyFree, { urlKey: urlKey.value }))) {
      fail("CONFLICT", "That URL is taken.");
    }
    await ctx.runMutation(internal.session.upsertUser, { profile: await fetchProfile(ctx.identity.subject) });

    let organizationId: string;
    try {
      const organization = await workos().organizations.createOrganization({
        name: name.value,
        metadata: { app: "blanch" },
      });
      organizationId = organization.id;
    } catch (error) {
      fail("UPSTREAM", `Couldn't create the workspace: ${workosErrorMessage(error)}`);
    }
    try {
      const membership = await workos().userManagement.createOrganizationMembership({
        organizationId,
        userId: ctx.identity.subject,
        roleSlug: "owner",
      });
      await ctx.runMutation(internal.workspaces.insertCreated, {
        name: name.value,
        urlKey: urlKey.value,
        workosOrganizationId: organizationId,
        workosMembershipId: membership.id,
      });
    } catch (error) {
      try {
        await workos().organizations.deleteOrganization(organizationId);
      } catch (cleanupError) {
        console.error("orphaned WorkOS organization after failed workspace creation", {
          organizationId,
          error: workosErrorMessage(cleanupError),
        });
      }
      if (error instanceof ConvexError) throw error;
      fail("UPSTREAM", `Couldn't create the workspace: ${workosErrorMessage(error)}`);
    }
    return { urlKey: urlKey.value, workosOrganizationId: organizationId };
  },
});

export const insertCreated = authedInternalMutation({
  args: {
    name: v.string(),
    urlKey: v.string(),
    workosOrganizationId: v.string(),
    workosMembershipId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"workspaces">> => {
    const user = ctx.user;
    ensure(user, "UNAUTHENTICATED", "Sign in to continue.");
    const taken = await ctx.db.query("workspaces").withIndex("by_url_key", (q) => q.eq("urlKey", args.urlKey)).first();
    if (taken) fail("CONFLICT", "That URL is taken.");

    const workspaceId = await ctx.db.insert("workspaces", {
      workosOrganizationId: args.workosOrganizationId,
      name: args.name,
      urlKey: args.urlKey,
      createdBy: user._id,
    });
    await ctx.db.insert("memberships", {
      workspaceId,
      userId: user._id,
      workosMembershipId: args.workosMembershipId,
      role: "owner",
      status: "active",
      updatedAt: Date.now(),
    });
    // Linear starts a workspace with one team named after it.
    const teamId = await insertTeamWithDefaults(ctx, {
      workspaceId,
      name: args.name,
      key: suggestTeamKey(args.name),
      parentId: null,
      visibility: "public",
      createdBy: user._id,
    });
    await ctx.db.insert("teamMembers", { workspaceId, teamId, userId: user._id, role: "owner" });

    const workspace = (await ctx.db.get(workspaceId))!;
    await recordAudit(ctx, { workspace, user }, {
      action: "workspace.created",
      targets: [{ type: "workspace", id: args.workosOrganizationId, name: args.name }],
    });
    return workspaceId;
  },
});

/** Renames the workspace or changes its URL; the name is mirrored to WorkOS. */
export const update = authedAction({
  args: { name: v.optional(v.string()), urlKey: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ urlKey: string }> => {
    const result = await ctx.runMutation(internal.workspaces.applyUpdate, args);
    if (result.previous.name !== result.next.name) {
      try {
        await workos().organizations.updateOrganization({
          organization: result.workosOrganizationId,
          name: result.next.name,
        });
      } catch (error) {
        await ctx.runMutation(internal.workspaces.applyUpdate, result.previous);
        fail("UPSTREAM", `Couldn't rename the workspace: ${workosErrorMessage(error)}`);
      }
    }
    if (result.changed) {
      await ctx.runMutation(internal.audit.record, {
        action: "workspace.updated",
        targets: [{ type: "workspace", id: result.workosOrganizationId, name: result.next.name }],
        metadata: result.next,
      });
    }
    return { urlKey: result.next.urlKey };
  },
});

export const applyUpdate = workspaceInternalMutation({
  args: { name: v.optional(v.string()), urlKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { workspace, actor } = ctx.viewer;
    if (!canManageWorkspace(actor, workspace._id)) fail("FORBIDDEN", "Only admins can change workspace settings.");
    const previous = { name: workspace.name, urlKey: workspace.urlKey };
    const next = { ...previous };
    if (args.name !== undefined) {
      const name = validateName(args.name, "Workspace name");
      if (!name.ok) fail("INVALID", name.message);
      next.name = name.value;
    }
    if (args.urlKey !== undefined) {
      const urlKey = validateUrlKey(args.urlKey);
      if (!urlKey.ok) fail("INVALID", urlKey.message);
      const taken = await ctx.db.query("workspaces").withIndex("by_url_key", (q) => q.eq("urlKey", urlKey.value)).first();
      if (taken && taken._id !== workspace._id) fail("CONFLICT", "That URL is taken.");
      next.urlKey = urlKey.value;
    }
    if (next.name !== previous.name || next.urlKey !== previous.urlKey) {
      await ctx.db.patch(workspace._id, next);
    }
    return {
      previous,
      next,
      workosOrganizationId: workspace.workosOrganizationId,
      changed: next.name !== previous.name || next.urlKey !== previous.urlKey,
    };
  },
});
