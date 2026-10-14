import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { toRow } from "./issues";
import { workspaceMutation, workspaceQuery } from "./lib/functions";
import { fail } from "./lib/errors";
import { requireTeam, toTeam, type Viewer } from "./lib/viewer";
import { canManageWorkspace, canReadTeamContent, canViewWorkspaceSurfaces } from "../src/lib/permissions";
import { parseFilter } from "../src/lib/filters";
import { displaySchema } from "../src/lib/filters/views";
import { validateDescription, validateName } from "../src/lib/validation";

/*
 * Issue sources for views (ADR 0008). Each query walks one index a page at a
 * time (D-32) and drops issues the viewer can't read; filters, ordering, and
 * grouping run on the client over the loaded rows (ADR 0005).
 */

function canRead(viewer: Viewer, issue: Doc<"issues"> | null): issue is Doc<"issues"> {
  if (!issue || issue.deletedAt !== undefined || issue.workspaceId !== viewer.workspace._id) return false;
  const team = viewer.teams.get(issue.teamId);
  return !!team && canReadTeamContent(viewer.actor, toTeam(team));
}

/** My issues: Assigned, Created, Subscribed, Activity (D-31: from relations, not heuristics). */
export const myIssues = workspaceQuery({
  args: {
    tab: v.union(v.literal("assigned"), v.literal("created"), v.literal("subscribed"), v.literal("activity")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async ({ db, viewer }, { tab, paginationOpts }) => {
    const workspaceId = viewer.workspace._id;
    const me = viewer.user._id;
    if (tab === "assigned" || tab === "created") {
      const result =
        tab === "assigned"
          ? await db.query("issues").withIndex("by_assignee_and_category", (q) => q.eq("workspaceId", workspaceId).eq("assigneeId", me)).order("desc").paginate(paginationOpts)
          : await db.query("issues").withIndex("by_creator", (q) => q.eq("workspaceId", workspaceId).eq("creatorId", me)).order("desc").paginate(paginationOpts);
      return { ...result, page: result.page.filter((issue) => canRead(viewer, issue)).map(toRow) };
    }
    if (tab === "subscribed") {
      const result = await db
        .query("subscriptions")
        .withIndex("by_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", me).eq("subscribed", true))
        .order("desc")
        .paginate(paginationOpts);
      const issues = await Promise.all(result.page.map((row) => db.get(row.issueId)));
      return { ...result, page: issues.filter((issue) => canRead(viewer, issue)).map(toRow) };
    }
    const result = await db.query("issueHistory").withIndex("by_actor", (q) => q.eq("workspaceId", workspaceId).eq("actorId", me)).order("desc").paginate(paginationOpts);
    const seen = new Set<string>();
    const rows = [];
    for (const entry of result.page) {
      if (seen.has(entry.issueId)) continue;
      seen.add(entry.issueId);
      const issue = await db.get(entry.issueId);
      if (canRead(viewer, issue)) rows.push(toRow(issue));
    }
    return { ...result, page: rows };
  },
});

/** Every readable issue in the workspace, for workspace views. */
export const workspaceIssues = workspaceQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async ({ db, viewer }, { paginationOpts }) => {
    const result = await db
      .query("issues")
      .withIndex("by_workspace_and_deleted", (q) => q.eq("workspaceId", viewer.workspace._id).eq("deletedAt", undefined))
      .order("desc")
      .paginate(paginationOpts);
    return { ...result, page: result.page.filter((issue) => canRead(viewer, issue)).map(toRow) };
  },
});

// --- Saved views --------------------------------------------------------------

function canSee(viewer: Viewer, view: Doc<"savedViews">): boolean {
  if (view.workspaceId !== viewer.workspace._id) return false;
  if (view.ownerId === viewer.user._id) return true;
  if (view.scope === "personal") return false;
  if (view.teamId === null) return canViewWorkspaceSurfaces(viewer.actor, viewer.workspace._id);
  const team = viewer.teams.get(view.teamId);
  return !!team && canReadTeamContent(viewer.actor, toTeam(team));
}

function canEdit(viewer: Viewer, view: Doc<"savedViews">): boolean {
  if (view.ownerId === viewer.user._id) return true;
  if (view.scope === "personal") return false;
  if (view.teamId === null) return canManageWorkspace(viewer.actor, viewer.workspace._id);
  try {
    requireTeam(viewer, view.teamId, "manage");
    return true;
  } catch {
    return false;
  }
}

function summarize(viewer: Viewer, view: Doc<"savedViews">) {
  return {
    id: view._id,
    name: view.name,
    description: view.description ?? "",
    teamId: view.teamId,
    scope: view.scope,
    filter: view.filter,
    display: view.display,
    isOwner: view.ownerId === viewer.user._id,
    can: { edit: canEdit(viewer, view) },
    updatedAt: view.updatedAt,
  };
}

export const list = workspaceQuery({
  args: { teamId: v.optional(v.union(v.id("teams"), v.null())) },
  handler: async ({ db, viewer }, { teamId }) => {
    const rows =
      teamId === undefined
        ? await db.query("savedViews").withIndex("by_workspace_and_team", (q) => q.eq("workspaceId", viewer.workspace._id)).take(1000)
        : await db.query("savedViews").withIndex("by_workspace_and_team", (q) => q.eq("workspaceId", viewer.workspace._id).eq("teamId", teamId)).take(500);
    return rows.filter((view) => canSee(viewer, view)).sort((a, b) => a.name.localeCompare(b.name)).map((view) => summarize(viewer, view));
  },
});

export const get = workspaceQuery({
  args: { viewId: v.id("savedViews") },
  handler: async ({ db, viewer }, { viewId }) => {
    const view = await db.get(viewId);
    return view && canSee(viewer, view) ? summarize(viewer, view) : null;
  },
});

function validated(args: { name?: string; description?: string; filter?: string; display?: string }) {
  const out: Partial<Pick<Doc<"savedViews">, "name" | "description" | "filter" | "display">> = {};
  if (args.name !== undefined) {
    const name = validateName(args.name, "View name");
    if (!name.ok) fail("INVALID", name.message);
    out.name = name.value;
  }
  if (args.description !== undefined) {
    const description = validateDescription(args.description, 280);
    if (!description.ok) fail("INVALID", description.message);
    out.description = description.value || undefined;
  }
  if (args.filter !== undefined) {
    if (!parseFilter(args.filter)) fail("INVALID", "That filter isn't valid.");
    out.filter = args.filter;
  }
  if (args.display !== undefined) {
    let parsed;
    try {
      parsed = displaySchema.safeParse(JSON.parse(args.display));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) fail("INVALID", "Those display options aren't valid.");
    out.display = JSON.stringify(parsed.data);
  }
  return out;
}

export const create = workspaceMutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    teamId: v.union(v.id("teams"), v.null()),
    scope: v.union(v.literal("personal"), v.literal("shared")),
    filter: v.string(),
    display: v.string(),
  },
  handler: async ({ db, viewer }, args) => {
    if (args.teamId) requireTeam(viewer, args.teamId, "read");
    // D-18: guests have no workspace-wide views, and share nothing.
    else if (!canViewWorkspaceSurfaces(viewer.actor, viewer.workspace._id)) fail("FORBIDDEN", "Guests can't create workspace views.");
    if (args.scope === "shared" && viewer.actor.role === "guest") fail("FORBIDDEN", "Guests can only create personal views.");
    const fields = validated(args);
    const id: Id<"savedViews"> = await db.insert("savedViews", {
      workspaceId: viewer.workspace._id,
      ownerId: viewer.user._id,
      teamId: args.teamId,
      scope: args.scope,
      name: fields.name!,
      description: fields.description,
      filter: fields.filter!,
      display: fields.display!,
      updatedAt: Date.now(),
    });
    return id;
  },
});

export const update = workspaceMutation({
  args: {
    viewId: v.id("savedViews"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    scope: v.optional(v.union(v.literal("personal"), v.literal("shared"))),
    filter: v.optional(v.string()),
    display: v.optional(v.string()),
  },
  handler: async ({ db, viewer }, { viewId, scope, ...args }) => {
    const view = await db.get(viewId);
    if (!view || !canSee(viewer, view)) fail("NOT_FOUND", "View not found.");
    if (!canEdit(viewer, view)) fail("FORBIDDEN", "Only the owner or an admin can change this view.");
    if (scope && scope !== view.scope && view.ownerId !== viewer.user._id) fail("FORBIDDEN", "Only the owner can change who sees a view.");
    if (scope === "shared" && viewer.actor.role === "guest") fail("FORBIDDEN", "Guests can only create personal views.");
    await db.patch(view._id, { ...validated(args), ...(scope ? { scope } : {}), updatedAt: Date.now() });
    return null;
  },
});

export const remove = workspaceMutation({
  args: { viewId: v.id("savedViews") },
  handler: async ({ db, viewer }, { viewId }) => {
    const view = await db.get(viewId);
    if (!view || !canSee(viewer, view)) fail("NOT_FOUND", "View not found.");
    if (!canEdit(viewer, view)) fail("FORBIDDEN", "Only the owner or an admin can delete this view.");
    const favorites = await db.query("favorites").withIndex("by_user", (q) => q.eq("workspaceId", view.workspaceId)).take(5000);
    for (const favorite of favorites) if (favorite.kind === "view" && favorite.targetId === view._id) await db.delete(favorite._id);
    await db.delete(view._id);
    return null;
  },
});
