import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import { systemMutation, workspaceMutation, workspaceQuery } from "./lib/functions";
import { fail } from "./lib/errors";
import { appendHistory, createIssue, issueByIdentifier, requireIssue, updateIssue, type IssueFields } from "./lib/issues";
import { userSummary } from "./lib/members";
import { subscribe, unsubscribe } from "./lib/notify";
import { requireTeam, toTeam, type Viewer } from "./lib/viewer";
import { canReadTeamContent } from "../src/lib/permissions";

/*
 * Issues. Writes go through convex/lib/issues.ts (validation, version,
 * history, subscriptions, notifications). Reads check team access per issue.
 */

export function toRow(issue: Doc<"issues">) {
  return {
    id: issue._id,
    identifier: issue.identifier,
    number: issue.number,
    teamId: issue.teamId,
    title: issue.title,
    stateId: issue.stateId,
    stateCategory: issue.stateCategory,
    priority: issue.priority,
    assigneeId: issue.assigneeId ?? null,
    creatorId: issue.creatorId,
    labelIds: issue.labelIds,
    estimate: issue.estimate ?? null,
    dueDate: issue.dueDate ?? null,
    parentId: issue.parentId ?? null,
    sortOrder: issue.sortOrder,
    version: issue.version,
    createdAt: issue._creationTime,
    updatedAt: issue.updatedAt,
    completedAt: issue.completedAt ?? issue.canceledAt ?? null,
  };
}
export type IssueRow = ReturnType<typeof toRow>;

const fieldArgs = {
  title: v.optional(v.string()),
  description: v.optional(v.union(v.string(), v.null())),
  stateId: v.optional(v.id("workflowStates")),
  priority: v.optional(v.number()),
  assigneeId: v.optional(v.union(v.id("users"), v.null())),
  labelIds: v.optional(v.array(v.id("labels"))),
  estimate: v.optional(v.union(v.number(), v.null())),
  dueDate: v.optional(v.union(v.string(), v.null())),
  parentId: v.optional(v.union(v.id("issues"), v.null())),
  sortOrder: v.optional(v.number()),
};

function readable(viewer: Viewer, issue: Doc<"issues"> | null): boolean {
  if (!issue || issue.workspaceId !== viewer.workspace._id || issue.deletedAt !== undefined) return false;
  const team = viewer.teams.get(issue.teamId);
  return !!team && canReadTeamContent(viewer.actor, toTeam(team));
}

function brief(issue: Doc<"issues">) {
  return { id: issue._id, identifier: issue.identifier, title: issue.title, stateId: issue.stateId, stateCategory: issue.stateCategory };
}

async function users(db: DatabaseReader, ids: Iterable<Id<"users"> | undefined>) {
  const out = new Map<string, ReturnType<typeof userSummary>>();
  for (const id of new Set(ids)) {
    if (!id) continue;
    const user = await db.get(id);
    if (user) out.set(id, userSummary(user));
  }
  return out;
}

// --- Reads ------------------------------------------------------------------

/** The issue page: /<workspace>/issue/ENG-123 (aliases from moves resolve too). */
export const get = workspaceQuery({
  args: { identifier: v.string() },
  handler: async ({ db, viewer }, { identifier }) => {
    const issue = await issueByIdentifier(db, viewer.workspace._id, identifier);
    if (!issue) return null;
    if (!readable(viewer, issue)) {
      // Deleted issues stay reachable for restore, by people who can read the team.
      if (issue.deletedAt !== undefined && issue.workspaceId === viewer.workspace._id) {
        const team = viewer.teams.get(issue.teamId);
        if (team && canReadTeamContent(viewer.actor, toTeam(team))) return { deleted: true as const, identifier: issue.identifier, id: issue._id };
      }
      return null;
    }
    const team = viewer.teams.get(issue.teamId)!;
    const [labels, children, relationsOut, relationsIn, subs] = await Promise.all([
      Promise.all(issue.labelIds.map((id) => db.get(id))),
      db.query("issues").withIndex("by_parent", (q) => q.eq("parentId", issue._id)).take(200),
      db.query("issueRelations").withIndex("by_issue", (q) => q.eq("issueId", issue._id)).take(200),
      db.query("issueRelations").withIndex("by_related", (q) => q.eq("relatedIssueId", issue._id)).take(200),
      db.query("subscriptions").withIndex("by_issue", (q) => q.eq("issueId", issue._id)).take(500),
    ]);
    const parent = issue.parentId ? await db.get(issue.parentId) : null;
    const relations = [];
    for (const relation of relationsOut) {
      const other = await db.get(relation.relatedIssueId);
      if (other && readable(viewer, other)) relations.push({ id: relation._id, type: relation.type, direction: "outgoing" as const, issue: brief(other) });
    }
    for (const relation of relationsIn) {
      const other = await db.get(relation.issueId);
      if (other && readable(viewer, other)) relations.push({ id: relation._id, type: relation.type, direction: "incoming" as const, issue: brief(other) });
    }
    const subscribers = subs.filter((s) => s.subscribed).map((s) => s.userId);
    const people = await users(db, [issue.assigneeId, issue.creatorId, ...subscribers]);
    const write = requireTeamWrite(viewer, team);
    return {
      deleted: false as const,
      ...toRow(issue),
      description: issue.description ?? null,
      team: { id: team._id, key: team.key, name: team.name, estimateScale: team.estimateScale ?? null },
      labels: labels.filter((l) => l !== null).map((l) => ({ id: l._id, name: l.name, color: l.color })),
      assignee: issue.assigneeId ? (people.get(issue.assigneeId) ?? null) : null,
      creator: people.get(issue.creatorId) ?? null,
      parent: parent && readable(viewer, parent) ? brief(parent) : null,
      children: children.filter((child) => readable(viewer, child)).sort((a, b) => a.number - b.number).map((child) => ({ ...brief(child), assigneeId: child.assigneeId ?? null, priority: child.priority })),
      relations,
      subscribers: subscribers.map((id) => people.get(id)).filter((u) => u !== undefined),
      viewerSubscribed: subscribers.includes(viewer.user._id),
      can: { write },
    };
  },
});

function requireTeamWrite(viewer: Viewer, team: Doc<"teams">): boolean {
  try {
    requireTeam(viewer, team._id, "write");
    return true;
  } catch {
    return false;
  }
}

/** History for the activity timeline, with ids resolved to names. */
export const activity = workspaceQuery({
  args: { issueId: v.id("issues") },
  handler: async ({ db, viewer }, { issueId }) => {
    const { issue } = await requireIssue(db, viewer, issueId, "read", { includeDeleted: true });
    const entries = await db.query("issueHistory").withIndex("by_issue", (q) => q.eq("issueId", issue._id)).take(500);
    const people = await users(db, entries.map((e) => e.actorId));
    const names = new Map<string, string>();
    const resolve = async (field: string, value: string | number | null | undefined) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "number") return value;
      const key = `${field}:${value}`;
      if (names.has(key)) return names.get(key)!;
      let name = value;
      if (field === "stateId" || field === "assigneeId" || field === "parentId") {
        const doc = await db.get(value as Id<"workflowStates"> | Id<"users"> | Id<"issues">);
        if (doc) name = "name" in doc ? doc.name : "identifier" in doc ? doc.identifier : value;
      } else if (field === "labelIds") {
        const parts = await Promise.all(value.split(",").filter(Boolean).map((id) => db.get(id as Id<"labels">)));
        name = parts.map((label) => label?.name ?? "deleted label").join(", ");
      }
      names.set(key, name);
      return name;
    };
    return await Promise.all(
      entries.map(async (entry) => ({
        id: entry._id,
        at: entry._creationTime,
        kind: entry.kind,
        actor: people.get(entry.actorId) ?? null,
        changes: await Promise.all(
          entry.changes.map(async (change) => ({
            field: change.field,
            from: await resolve(change.field, change.from),
            to: await resolve(change.field, change.to),
          })),
        ),
      })),
    );
  },
});

/**
 * The issue picker (parent, relations, #mentions): an exact identifier first,
 * then title matches, readable issues only. The Search page has its own query.
 */
export const quickSearch = workspaceQuery({
  args: { query: v.string(), excludeId: v.optional(v.id("issues")) },
  handler: async ({ db, viewer }, { query, excludeId }) => {
    const text = query.trim().slice(0, 100);
    if (!text) return [];
    const found: Doc<"issues">[] = [];
    if (/^[a-z][a-z0-9]*-\d+$/i.test(text)) {
      const exact = await issueByIdentifier(db, viewer.workspace._id, text);
      if (exact) found.push(exact);
    }
    const matches = await db
      .query("issues")
      .withSearchIndex("search_title", (q) => q.search("title", text).eq("workspaceId", viewer.workspace._id).eq("deletedAt", undefined))
      .take(30);
    const seen = new Set<string>();
    return [...found, ...matches]
      .filter((issue) => issue._id !== excludeId && readable(viewer, issue) && !seen.has(issue._id) && seen.add(issue._id))
      .slice(0, 10)
      .map((issue) => ({ ...brief(issue), teamId: issue.teamId }));
  },
});

/** A team's issues, newest first, a page at a time (D-32). */
export const listForTeam = workspaceQuery({
  args: { teamId: v.id("teams"), paginationOpts: paginationOptsValidator },
  handler: async ({ db, viewer }, { teamId, paginationOpts }) => {
    const team = requireTeam(viewer, teamId, "read");
    const result = await db
      .query("issues")
      .withIndex("by_team_and_number", (q) => q.eq("teamId", team._id))
      .order("desc")
      .paginate(paginationOpts);
    return { ...result, page: result.page.filter((issue) => issue.deletedAt === undefined).map(toRow) };
  },
});

/** Recently deleted (D-26): readable issues deleted in the last 30 days. */
export const recentlyDeleted = workspaceQuery({
  args: {},
  handler: async ({ db, viewer }) => {
    const rows = await db
      .query("issues")
      .withIndex("by_workspace_and_deleted", (q) => q.eq("workspaceId", viewer.workspace._id).gt("deletedAt", 0))
      .order("desc")
      .take(500);
    const people = await users(db, rows.map((r) => r.deletedBy));
    return rows
      .filter((issue) => {
        const team = viewer.teams.get(issue.teamId);
        return team && canReadTeamContent(viewer.actor, toTeam(team));
      })
      .map((issue) => ({ ...toRow(issue), deletedAt: issue.deletedAt!, deletedBy: issue.deletedBy ? (people.get(issue.deletedBy) ?? null) : null }));
  },
});

// --- Writes -----------------------------------------------------------------

export const create = workspaceMutation({
  args: { ...fieldArgs, teamId: v.id("teams"), title: v.string() },
  handler: async (ctx, args) => {
    const { teamId, title, ...fields } = args;
    const issue = await createIssue(ctx, ctx.viewer, { ...(fields as IssueFields), teamId, title });
    return { issueId: issue._id, identifier: issue.identifier };
  },
});

/** Changes any properties; `expectedVersion` rejects stale writes (D-21). */
export const update = workspaceMutation({
  args: { issueId: v.id("issues"), expectedVersion: v.optional(v.number()), ...fieldArgs },
  handler: async (ctx, { issueId, expectedVersion, ...fields }) => {
    const { issue, team } = await requireIssue(ctx.db, ctx.viewer, issueId, "write");
    const updated = await updateIssue(ctx, ctx.viewer, issue, team, fields as IssueFields, expectedVersion);
    return { version: updated.version };
  },
});

/** Kept for the O-3 spike page. */
export const setPriority = workspaceMutation({
  args: { issueId: v.id("issues"), priority: v.number(), expectedVersion: v.optional(v.number()) },
  handler: async (ctx, { issueId, priority, expectedVersion }) => {
    const { issue, team } = await requireIssue(ctx.db, ctx.viewer, issueId, "write");
    const updated = await updateIssue(ctx, ctx.viewer, issue, team, { priority }, expectedVersion);
    return { version: updated.version };
  },
});

/**
 * Moves an issue to another team (D-24): new identifier, the old one kept as an
 * alias; status mapped by category; team-only labels dropped.
 */
export const move = workspaceMutation({
  args: { issueId: v.id("issues"), teamId: v.id("teams") },
  handler: async (ctx, { issueId, teamId }) => {
    const { issue, team: from } = await requireIssue(ctx.db, ctx.viewer, issueId, "write");
    if (from._id === teamId) return { identifier: issue.identifier };
    const to = requireTeam(ctx.viewer, teamId, "write");
    const states = await ctx.db.query("workflowStates").withIndex("by_team_and_position", (q) => q.eq("teamId", to._id)).take(200);
    const state =
      states.filter((s) => s.category === issue.stateCategory).sort((a, b) => a.position - b.position)[0] ??
      states.find((s) => s._id === to.defaultStateId);
    if (!state) fail("INVALID", `${to.name} has no matching status.`);
    const labels = await Promise.all(issue.labelIds.map((id) => ctx.db.get(id)));
    const keptLabels = labels.filter((l) => l && l.teamId === null).map((l) => l!._id);
    const number = to.issueCounter + 1;
    await ctx.db.patch(to._id, { issueCounter: number });
    const identifier = `${to.key}-${number}`;
    await ctx.db.insert("issueAliases", { workspaceId: issue.workspaceId, identifier: issue.identifier, issueId: issue._id });
    await ctx.db.patch(issue._id, {
      teamId: to._id,
      number,
      identifier,
      stateId: state._id,
      stateCategory: state.category,
      labelIds: keptLabels,
      estimate: undefined,
      version: issue.version + 1,
      updatedAt: Date.now(),
    });
    const rows = await ctx.db.query("issueLabels").withIndex("by_issue", (q) => q.eq("issueId", issue._id)).take(200);
    for (const row of rows) if (!keptLabels.includes(row.labelId)) await ctx.db.delete(row._id);
    await appendHistory(ctx, issue, ctx.viewer.user._id, "moved", [
      { field: "teamId", from: from.key, to: to.key },
      { field: "identifier", from: issue.identifier, to: identifier },
    ]);
    return { identifier };
  },
});

/** Soft delete (D-26): listed in Recently deleted, restorable for 30 days. */
export const remove = workspaceMutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, { issueId }) => {
    const { issue } = await requireIssue(ctx.db, ctx.viewer, issueId, "write");
    await ctx.db.patch(issue._id, { deletedAt: Date.now(), deletedBy: ctx.viewer.user._id, version: issue.version + 1 });
    await appendHistory(ctx, issue, ctx.viewer.user._id, "deleted");
    return null;
  },
});

export const restore = workspaceMutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, { issueId }) => {
    const { issue } = await requireIssue(ctx.db, ctx.viewer, issueId, "write", { includeDeleted: true });
    if (issue.deletedAt === undefined) return null;
    await ctx.db.patch(issue._id, { deletedAt: undefined, deletedBy: undefined, version: issue.version + 1, updatedAt: Date.now() });
    await appendHistory(ctx, issue, ctx.viewer.user._id, "restored");
    return null;
  },
});

export const setSubscribed = workspaceMutation({
  args: { issueId: v.id("issues"), subscribed: v.boolean() },
  handler: async (ctx, { issueId, subscribed }) => {
    const { issue } = await requireIssue(ctx.db, ctx.viewer, issueId, "read");
    if (subscribed) await subscribe(ctx, issue, ctx.viewer.user._id, "manual", { force: true });
    else await unsubscribe(ctx, issue._id, ctx.viewer.user._id);
    return null;
  },
});

export const addRelation = workspaceMutation({
  args: {
    issueId: v.id("issues"),
    relatedIssueId: v.id("issues"),
    type: v.union(v.literal("blocks"), v.literal("blocked_by"), v.literal("related"), v.literal("duplicate")),
  },
  handler: async (ctx, { issueId, relatedIssueId, type }) => {
    if (issueId === relatedIssueId) fail("INVALID", "An issue can't relate to itself.");
    const { issue } = await requireIssue(ctx.db, ctx.viewer, issueId, "write");
    const { issue: other } = await requireIssue(ctx.db, ctx.viewer, relatedIssueId, "read");
    // "A is blocked by B" is stored as "B blocks A".
    const [source, target, stored] = type === "blocked_by" ? [other, issue, "blocks" as const] : [issue, other, type];
    const existing = [
      ...(await ctx.db.query("issueRelations").withIndex("by_issue", (q) => q.eq("issueId", source._id)).take(200)),
      ...(await ctx.db.query("issueRelations").withIndex("by_issue", (q) => q.eq("issueId", target._id)).take(200)),
    ];
    if (existing.some((r) => (r.issueId === source._id && r.relatedIssueId === target._id) || (r.issueId === target._id && r.relatedIssueId === source._id))) {
      fail("CONFLICT", `${issue.identifier} and ${other.identifier} are already related.`);
    }
    await ctx.db.insert("issueRelations", { workspaceId: issue.workspaceId, issueId: source._id, relatedIssueId: target._id, type: stored, createdBy: ctx.viewer.user._id });
    await appendHistory(ctx, issue, ctx.viewer.user._id, "updated", [{ field: `relation:${type}`, from: null, to: other.identifier }]);
    return null;
  },
});

export const removeRelation = workspaceMutation({
  args: { relationId: v.id("issueRelations") },
  handler: async (ctx, { relationId }) => {
    const relation = await ctx.db.get(relationId);
    if (!relation || relation.workspaceId !== ctx.viewer.workspace._id) fail("NOT_FOUND", "Relation not found.");
    // Either side's writers may remove it.
    const sides = await Promise.all([ctx.db.get(relation.issueId), ctx.db.get(relation.relatedIssueId)]);
    const writable = sides.find((issue) => issue && requireTeamWriteSafe(ctx.viewer, issue.teamId));
    if (!writable) fail("FORBIDDEN", "You can't change these issues.");
    await ctx.db.delete(relationId);
    const other = sides.find((s) => s && s._id !== writable._id);
    await appendHistory(ctx, writable, ctx.viewer.user._id, "updated", [{ field: `relation:${relation.type}`, from: other?.identifier ?? null, to: null }]);
    return null;
  },
});

function requireTeamWriteSafe(viewer: Viewer, teamId: Id<"teams">): boolean {
  const team = viewer.teams.get(teamId);
  return !!team && requireTeamWrite(viewer, team);
}

// --- Purge (D-26) -----------------------------------------------------------

const purgeAfterMs = 30 * 24 * 60 * 60 * 1000;

/** Cron: permanently removes issues deleted more than 30 days ago, a few at a time. */
export const purgeDeleted = systemMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - purgeAfterMs;
    const expired = await ctx.db.query("issues").withIndex("by_deleted", (q) => q.gt("deletedAt", 0).lt("deletedAt", cutoff)).take(20);
    for (const issue of expired) await purgeIssue(ctx.db, ctx.storage, issue._id);
    if (expired.length === 20) await ctx.scheduler.runAfter(0, internal.issues.purgeDeleted, {});
    return { purged: expired.length };
  },
});

async function purgeIssue(db: MutationCtx["db"], storage: MutationCtx["storage"], issueId: Id<"issues">) {
  for (const attachment of await db.query("attachments").withIndex("by_issue", (q) => q.eq("issueId", issueId)).collect()) {
    await storage.delete(attachment.storageId);
    await db.delete(attachment._id);
  }
  const rows = [
    ...(await db.query("issueLabels").withIndex("by_issue", (q) => q.eq("issueId", issueId)).collect()),
    ...(await db.query("comments").withIndex("by_issue", (q) => q.eq("issueId", issueId)).collect()),
    ...(await db.query("commentReactions").withIndex("by_issue", (q) => q.eq("issueId", issueId)).collect()),
    ...(await db.query("subscriptions").withIndex("by_issue", (q) => q.eq("issueId", issueId)).collect()),
    ...(await db.query("notifications").withIndex("by_issue", (q) => q.eq("issueId", issueId)).collect()),
    ...(await db.query("issueHistory").withIndex("by_issue", (q) => q.eq("issueId", issueId)).collect()),
  ];
  for (const row of rows) await db.delete(row._id);
  for (const row of await db.query("issueRelations").withIndex("by_issue", (q) => q.eq("issueId", issueId)).collect()) await db.delete(row._id);
  for (const row of await db.query("issueRelations").withIndex("by_related", (q) => q.eq("relatedIssueId", issueId)).collect()) await db.delete(row._id);
  const aliases = await db.query("issueAliases").withIndex("by_issue", (q) => q.eq("issueId", issueId)).collect();
  for (const alias of aliases) await db.delete(alias._id);
  for (const child of await db.query("issues").withIndex("by_parent", (q) => q.eq("parentId", issueId)).collect()) {
    await db.patch(child._id, { parentId: undefined });
  }
  await db.delete(issueId);
}
