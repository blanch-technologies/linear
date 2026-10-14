import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { systemMutation, workspaceMutation, workspaceQuery } from "./lib/functions";
import { fail } from "./lib/errors";
import { requireTeam, type Viewer } from "./lib/viewer";
import { canManageWorkspace } from "../src/lib/permissions";
import { validateDescription, validateName } from "../src/lib/validation";
import { isHexColor } from "../src/lib/workflow";

/*
 * Labels: workspace-wide (teamId null) or per team. A label with children is
 * a group; issues carry at most one label per group. Workspace labels are
 * created by any non-guest and edited by admins; team labels by anyone who can
 * write in the team and edited by its managers.
 */

function toLabel(label: Doc<"labels">) {
  return {
    id: label._id,
    name: label.name,
    color: label.color,
    description: label.description ?? "",
    teamId: label.teamId,
    parentId: label.parentId ?? null,
  };
}
export type LabelSummary = ReturnType<typeof toLabel>;

async function labelsIn(db: DatabaseReader, workspaceId: Id<"workspaces">, teamId: Id<"teams"> | null) {
  const rows = await db
    .query("labels")
    .withIndex("by_workspace_and_team", (q) => q.eq("workspaceId", workspaceId).eq("teamId", teamId))
    .take(1000);
  return rows.filter((label) => !label.archivedAt);
}

/** Labels usable in a team (workspace labels first), or only workspace labels. */
export const list = workspaceQuery({
  args: { teamId: v.optional(v.id("teams")) },
  handler: async ({ db, viewer }, { teamId }) => {
    const workspaceLabels = await labelsIn(db, viewer.workspace._id, null);
    const teamLabels = teamId ? await labelsIn(db, viewer.workspace._id, requireTeam(viewer, teamId, "read")._id) : [];
    const groupIds = new Set([...workspaceLabels, ...teamLabels].map((label) => label.parentId).filter(Boolean));
    return [...workspaceLabels, ...teamLabels]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((label) => ({ ...toLabel(label), isGroup: groupIds.has(label._id) }));
  },
});

/** Every label the viewer can see, for resolving labelIds in workspace-wide lists. */
export const all = workspaceQuery({
  args: {},
  handler: async ({ db, viewer }) => {
    const rows = await db.query("labels").withIndex("by_workspace_and_team", (q) => q.eq("workspaceId", viewer.workspace._id)).take(5000);
    return rows
      .filter((label) => label.teamId === null || viewer.teams.has(label.teamId))
      .map((label) => ({ ...toLabel(label), archived: !!label.archivedAt }));
  },
});

function canEdit(viewer: Viewer, label: Doc<"labels">) {
  if (label.teamId === null) return canManageWorkspace(viewer.actor, viewer.workspace._id);
  try {
    requireTeam(viewer, label.teamId, "manage");
    return true;
  } catch {
    return false;
  }
}

async function assertUniqueName(db: DatabaseReader, workspaceId: Id<"workspaces">, teamId: Id<"teams"> | null, name: string, except?: Id<"labels">) {
  const siblings = await labelsIn(db, workspaceId, teamId);
  if (siblings.some((label) => label._id !== except && label.name.toLowerCase() === name.toLowerCase())) {
    fail("CONFLICT", `A label named ${name} already exists.`);
  }
}

async function validParent(db: DatabaseReader, viewer: Viewer, teamId: Id<"teams"> | null, parentId: Id<"labels"> | undefined) {
  if (!parentId) return undefined;
  const parent = await db.get(parentId);
  if (!parent || parent.workspaceId !== viewer.workspace._id || parent.archivedAt) fail("INVALID", "Group not found.");
  if (parent.parentId) fail("INVALID", "Groups can't be nested.");
  if (parent.teamId !== teamId) fail("INVALID", "A label and its group must belong to the same team.");
  const applied = await db.query("issueLabels").withIndex("by_label", (q) => q.eq("labelId", parent._id)).first();
  if (applied) fail("INVALID", `${parent.name} is applied to issues, so it can't become a group.`);
  return parent._id;
}

export const create = workspaceMutation({
  args: {
    teamId: v.union(v.id("teams"), v.null()),
    name: v.string(),
    color: v.string(),
    description: v.optional(v.string()),
    parentId: v.optional(v.id("labels")),
  },
  handler: async ({ db, viewer }, args) => {
    if (args.teamId === null) {
      if (viewer.actor.role === "guest") fail("FORBIDDEN", "Guests can't create workspace labels.");
    } else {
      requireTeam(viewer, args.teamId, "write");
    }
    const name = validateName(args.name, "Label name");
    if (!name.ok) fail("INVALID", name.message);
    if (!isHexColor(args.color)) fail("INVALID", "Pick a color.");
    const description = validateDescription(args.description, 280);
    if (!description.ok) fail("INVALID", description.message);
    await assertUniqueName(db, viewer.workspace._id, args.teamId, name.value);
    const parentId = await validParent(db, viewer, args.teamId, args.parentId);
    const id = await db.insert("labels", {
      workspaceId: viewer.workspace._id,
      teamId: args.teamId,
      name: name.value,
      color: args.color.toLowerCase(),
      description: description.value || undefined,
      parentId,
    });
    return id;
  },
});

export const update = workspaceMutation({
  args: {
    labelId: v.id("labels"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    description: v.optional(v.string()),
    parentId: v.optional(v.union(v.id("labels"), v.null())),
  },
  handler: async ({ db, viewer }, args) => {
    const label = await db.get(args.labelId);
    if (!label || label.workspaceId !== viewer.workspace._id || label.archivedAt) fail("NOT_FOUND", "Label not found.");
    if (!canEdit(viewer, label)) fail("FORBIDDEN", label.teamId ? "Only team managers can edit team labels." : "Only admins can edit workspace labels.");
    const patch: Partial<Doc<"labels">> = {};
    if (args.name !== undefined) {
      const name = validateName(args.name, "Label name");
      if (!name.ok) fail("INVALID", name.message);
      await assertUniqueName(db, label.workspaceId, label.teamId, name.value, label._id);
      patch.name = name.value;
    }
    if (args.color !== undefined) {
      if (!isHexColor(args.color)) fail("INVALID", "Pick a color.");
      patch.color = args.color.toLowerCase();
    }
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.parentId !== undefined) {
      if (args.parentId === label._id) fail("INVALID", "A label can't be its own group.");
      const children = await db.query("labels").withIndex("by_parent", (q) => q.eq("parentId", label._id)).first();
      if (children && args.parentId) fail("INVALID", "Groups can't be nested.");
      patch.parentId = args.parentId === null ? undefined : await validParent(db, viewer, label.teamId, args.parentId);
    }
    await db.patch(label._id, patch);
    return null;
  },
});

/** Deletes a label (and its group's labels) and removes it from issues in batches. */
export const remove = workspaceMutation({
  args: { labelId: v.id("labels") },
  handler: async (ctx, { labelId }) => {
    const label = await ctx.db.get(labelId);
    if (!label || label.workspaceId !== ctx.viewer.workspace._id || label.archivedAt) fail("NOT_FOUND", "Label not found.");
    if (!canEdit(ctx.viewer, label)) fail("FORBIDDEN", "You can't delete this label.");
    const children = await ctx.db.query("labels").withIndex("by_parent", (q) => q.eq("parentId", label._id)).take(200);
    for (const target of [label, ...children]) {
      await ctx.db.patch(target._id, { archivedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.labels.detach, { labelId: target._id });
    }
    return null;
  },
});

export const detach = systemMutation({
  args: { labelId: v.id("labels") },
  handler: async (ctx, { labelId }) => {
    const rows = await ctx.db.query("issueLabels").withIndex("by_label", (q) => q.eq("labelId", labelId)).take(500);
    for (const row of rows) {
      const issue = await ctx.db.get(row.issueId);
      if (issue) await ctx.db.patch(issue._id, { labelIds: issue.labelIds.filter((id) => id !== labelId), version: issue.version + 1 });
      await ctx.db.delete(row._id);
    }
    if (rows.length === 500) await ctx.scheduler.runAfter(0, internal.labels.detach, { labelId });
  },
});
