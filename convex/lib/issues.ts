import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "../_generated/server";
import { canReadTeamContent } from "../../src/lib/permissions";
import { isCalendarDate, isPriority, isValidEstimate, priorityLabel, titleMaxLength } from "../../src/lib/issues";
import { mentions, parseDocument, toPlainText } from "../../src/lib/richtext";
import { fail } from "./errors";
import { actorFor, notify, subscribe, subscriberIds } from "./notify";
import { requireTeam, toTeam, type Viewer } from "./viewer";

/*
 * The one path for issue writes (D-19, D-21, D-22). Every create and update
 * validates fields against the issue's team, bumps `version`, appends
 * issueHistory, keeps subscriptions, and generates notifications, all in the
 * caller's transaction.
 */

export type IssueFields = {
  title?: string;
  /** ProseMirror JSON string; null clears. */
  description?: string | null;
  stateId?: Id<"workflowStates">;
  priority?: number;
  assigneeId?: Id<"users"> | null;
  labelIds?: Id<"labels">[];
  estimate?: number | null;
  dueDate?: string | null;
  parentId?: Id<"issues"> | null;
  sortOrder?: number;
};

/** An issue the viewer can access, or NOT_FOUND (deleted issues only with `includeDeleted`). */
export async function requireIssue(
  db: DatabaseReader,
  viewer: Viewer,
  issueId: Id<"issues">,
  access: "read" | "write",
  { includeDeleted = false } = {},
): Promise<{ issue: Doc<"issues">; team: Doc<"teams"> }> {
  const issue = await db.get(issueId);
  if (!issue || issue.workspaceId !== viewer.workspace._id || (issue.deletedAt !== undefined && !includeDeleted)) {
    fail("NOT_FOUND", "Issue not found.");
  }
  const seen = viewer.teams.get(issue.teamId);
  if (!seen || !canReadTeamContent(viewer.actor, toTeam(seen))) fail("NOT_FOUND", "Issue not found.");
  const team = requireTeam(viewer, issue.teamId, access);
  return { issue, team };
}

/** Resolves ENG-123, following aliases left by moves (D-24). */
export async function issueByIdentifier(db: DatabaseReader, workspaceId: Id<"workspaces">, identifier: string) {
  const key = identifier.toUpperCase();
  const direct = await db
    .query("issues")
    .withIndex("by_workspace_and_identifier", (q) => q.eq("workspaceId", workspaceId).eq("identifier", key))
    .unique();
  if (direct) return direct;
  const alias = await db
    .query("issueAliases")
    .withIndex("by_workspace_and_identifier", (q) => q.eq("workspaceId", workspaceId).eq("identifier", key))
    .first();
  return alias ? await db.get(alias.issueId) : null;
}

type Normalized = {
  patch: Partial<Doc<"issues">>;
  labelIds?: Id<"labels">[];
  mentionedUserIds: Id<"users">[];
  state?: Doc<"workflowStates">;
};

function validTitle(title: string) {
  const value = title.trim().replace(/\s+/g, " ");
  if (!value) fail("INVALID", "Title is required.");
  if (value.length > titleMaxLength) fail("INVALID", `Titles are at most ${titleMaxLength} characters.`);
  return value;
}

/** Validates fields for an issue in `team` and turns them into a patch. */
async function normalize(
  ctx: Pick<MutationCtx, "db">,
  viewer: Viewer,
  team: Doc<"teams">,
  fields: IssueFields,
  issue?: Doc<"issues">,
): Promise<Normalized> {
  const patch: Partial<Doc<"issues">> = {};
  const out: Normalized = { patch, mentionedUserIds: [] };

  if (fields.title !== undefined) patch.title = validTitle(fields.title);

  if (fields.description !== undefined) {
    if (fields.description === null) {
      patch.description = undefined;
      patch.descriptionText = undefined;
    } else {
      const parsed = parseDocument(fields.description);
      if (!parsed.ok) fail("INVALID", "The description couldn't be saved: unsupported content.");
      patch.description = fields.description;
      patch.descriptionText = toPlainText(parsed.doc).slice(0, 50_000);
      out.mentionedUserIds = mentions(parsed.doc).userIds as Id<"users">[];
    }
  }

  if (fields.stateId !== undefined) {
    const state = await ctx.db.get(fields.stateId);
    if (!state || state.teamId !== team._id) fail("INVALID", "That status belongs to another team.");
    patch.stateId = state._id;
    patch.stateCategory = state.category;
    out.state = state;
    const now = Date.now();
    if (state.category === "started" && !issue?.startedAt) patch.startedAt = now;
    patch.completedAt = state.category === "completed" ? (issue?.completedAt ?? now) : undefined;
    patch.canceledAt = state.category === "canceled" ? (issue?.canceledAt ?? now) : undefined;
  }

  if (fields.priority !== undefined) {
    if (!isPriority(fields.priority)) fail("INVALID", "Unknown priority.");
    patch.priority = fields.priority;
  }

  if (fields.assigneeId !== undefined) {
    if (fields.assigneeId === null) patch.assigneeId = undefined;
    else {
      const actor = await actorFor(ctx.db, team.workspaceId, fields.assigneeId);
      if (!actor || !canReadTeamContent(actor, toTeam(team))) {
        fail("INVALID", `They can't be assigned: they don't have access to ${team.name}.`);
      }
      patch.assigneeId = fields.assigneeId;
    }
  }

  if (fields.labelIds !== undefined) {
    const ids = [...new Set(fields.labelIds)];
    const groups = new Set<string>();
    for (const labelId of ids) {
      const label = await ctx.db.get(labelId);
      if (!label || label.workspaceId !== team.workspaceId || label.archivedAt) fail("INVALID", "Label not found.");
      if (label.teamId !== null && label.teamId !== team._id) fail("INVALID", `${label.name} belongs to another team.`);
      const child = await ctx.db.query("labels").withIndex("by_parent", (q) => q.eq("parentId", label._id)).first();
      if (child) fail("INVALID", `${label.name} is a label group; pick one of its labels.`);
      if (label.parentId) {
        if (groups.has(label.parentId)) fail("INVALID", "Only one label from each group can be applied.");
        groups.add(label.parentId);
      }
    }
    patch.labelIds = ids;
    out.labelIds = ids;
  }

  if (fields.estimate !== undefined) {
    if (fields.estimate === null) patch.estimate = undefined;
    else if (!isValidEstimate(team.estimateScale, fields.estimate)) fail("INVALID", "That estimate isn't on this team's scale.");
    else patch.estimate = fields.estimate;
  }

  if (fields.dueDate !== undefined) {
    if (fields.dueDate === null) patch.dueDate = undefined;
    else if (!isCalendarDate(fields.dueDate)) fail("INVALID", "Due dates look like 2026-10-31.");
    else patch.dueDate = fields.dueDate;
  }

  if (fields.parentId !== undefined) {
    if (fields.parentId === null) patch.parentId = undefined;
    else {
      const { issue: parent } = await requireIssue(ctx.db, viewer, fields.parentId, "read");
      // No cycles: the new parent can't be this issue or one of its descendants.
      let cursor: Doc<"issues"> | null = parent;
      for (let depth = 0; cursor && depth < 50; depth++) {
        if (issue && cursor._id === issue._id) fail("INVALID", "An issue can't be a sub-issue of itself or its sub-issues.");
        cursor = cursor.parentId ? await ctx.db.get(cursor.parentId) : null;
      }
      patch.parentId = parent._id;
    }
  }

  if (fields.sortOrder !== undefined) {
    if (!Number.isFinite(fields.sortOrder)) fail("INVALID", "Invalid order.");
    patch.sortOrder = fields.sortOrder;
  }
  return out;
}

async function syncIssueLabels(ctx: Pick<MutationCtx, "db">, issue: Pick<Doc<"issues">, "_id" | "workspaceId">, labelIds: Id<"labels">[]) {
  const rows = await ctx.db.query("issueLabels").withIndex("by_issue", (q) => q.eq("issueId", issue._id)).take(200);
  const wanted = new Set<string>(labelIds);
  for (const row of rows) if (!wanted.has(row.labelId)) await ctx.db.delete(row._id);
  const have = new Set<string>(rows.map((row) => row.labelId));
  for (const labelId of labelIds) {
    if (!have.has(labelId)) await ctx.db.insert("issueLabels", { workspaceId: issue.workspaceId, issueId: issue._id, labelId });
  }
}

type Change = Doc<"issueHistory">["changes"][number];
const historyValue = (value: unknown): string | number | null =>
  value === undefined || value === null ? null : typeof value === "number" ? value : Array.isArray(value) ? value.join(",") : String(value);

export async function createIssue(
  ctx: MutationCtx,
  viewer: Viewer,
  input: IssueFields & { teamId: Id<"teams">; title: string },
): Promise<Doc<"issues">> {
  const team = requireTeam(viewer, input.teamId, "write");
  const fields: IssueFields = { ...input, stateId: input.stateId ?? team.defaultStateId };
  if (!fields.stateId) fail("INVALID", "This team has no default status.");
  const { patch, labelIds, mentionedUserIds } = await normalize(ctx, viewer, team, fields);
  const number = team.issueCounter + 1;
  await ctx.db.patch(team._id, { issueCounter: number });
  const now = Date.now();
  const id = await ctx.db.insert("issues", {
    workspaceId: team.workspaceId,
    teamId: team._id,
    number,
    identifier: `${team.key}-${number}`,
    title: patch.title!,
    stateId: patch.stateId!,
    stateCategory: patch.stateCategory!,
    priority: patch.priority ?? 0,
    creatorId: viewer.user._id,
    labelIds: patch.labelIds ?? [],
    sortOrder: patch.sortOrder ?? -now,
    version: 1,
    updatedAt: now,
    ...pick(patch, ["description", "descriptionText", "assigneeId", "estimate", "dueDate", "parentId", "startedAt", "completedAt", "canceledAt"]),
  });
  const issue = (await ctx.db.get(id))!;
  if (labelIds) await syncIssueLabels(ctx, issue, labelIds);
  await ctx.db.insert("issueHistory", { workspaceId: issue.workspaceId, issueId: id, actorId: viewer.user._id, kind: "created", changes: [] });

  await subscribe(ctx, issue, viewer.user._id, "creator");
  if (issue.assigneeId) {
    await subscribe(ctx, issue, issue.assigneeId, "assignee", { force: true });
    await notify(ctx, [issue.assigneeId], { issue, team, actorId: viewer.user._id, kind: "assigned", summary: "assigned the issue to you" });
  }
  await handleMentions(ctx, issue, team, viewer, mentionedUserIds, []);
  return issue;
}

function pick<T extends object, K extends keyof T>(source: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

export async function updateIssue(
  ctx: MutationCtx,
  viewer: Viewer,
  issue: Doc<"issues">,
  team: Doc<"teams">,
  fields: IssueFields,
  expectedVersion?: number,
): Promise<Doc<"issues">> {
  if (expectedVersion !== undefined && expectedVersion !== issue.version) {
    fail("CONFLICT", `${issue.identifier} was changed by someone else. Your view has been refreshed; try again.`);
  }
  const { patch, labelIds, mentionedUserIds, state } = await normalize(ctx, viewer, team, fields, issue);
  const changes: Change[] = [];
  for (const [field, next] of Object.entries(patch) as [keyof Doc<"issues">, unknown][]) {
    if (["descriptionText", "stateCategory", "startedAt", "completedAt", "canceledAt", "sortOrder"].includes(field)) continue;
    const before = issue[field];
    const same = Array.isArray(before) && Array.isArray(next) ? before.join() === next.join() : before === next;
    if (same) continue;
    // Description history records that it changed, not the whole document.
    changes.push(field === "description" ? { field } : { field, from: historyValue(before), to: historyValue(next) });
  }
  const orderOnly = changes.length === 0 && patch.sortOrder !== undefined && patch.sortOrder !== issue.sortOrder;
  if (changes.length === 0 && !orderOnly) return issue;

  const now = Date.now();
  await ctx.db.patch(issue._id, { ...patch, version: issue.version + 1, updatedAt: orderOnly ? issue.updatedAt : now });
  const updated = (await ctx.db.get(issue._id))!;
  if (labelIds) await syncIssueLabels(ctx, updated, labelIds);
  if (changes.length === 0) return updated;
  await ctx.db.insert("issueHistory", { workspaceId: issue.workspaceId, issueId: issue._id, actorId: viewer.user._id, kind: "updated", changes });

  const actorId = viewer.user._id;
  await subscribe(ctx, updated, actorId, "manual");
  const changed = new Set(changes.map((change) => change.field));
  const subscribers = await subscriberIds(ctx.db, issue._id);
  if (changed.has("assigneeId") && updated.assigneeId) {
    await subscribe(ctx, updated, updated.assigneeId, "assignee", { force: true });
    await notify(ctx, [updated.assigneeId], { issue: updated, team, actorId, kind: "assigned", summary: "assigned the issue to you" });
  }
  if (changed.has("stateId") && state) {
    await notify(ctx, subscribers, { issue: updated, team, actorId, kind: "status", summary: `changed the status to ${state.name}` });
  }
  if (changed.has("priority")) {
    await notify(ctx, subscribers, {
      issue: updated,
      team,
      actorId,
      kind: "priority",
      summary: `set the priority to ${priorityLabel(updated.priority)}`,
    });
  }
  if (changed.has("description")) {
    const previous = issue.description ? parseDocument(issue.description) : null;
    const before = previous && previous.ok ? (mentions(previous.doc).userIds as Id<"users">[]) : [];
    await handleMentions(ctx, updated, team, viewer, mentionedUserIds, before);
  }
  return updated;
}

/** Newly mentioned people are subscribed and notified, if they can read the issue. */
export async function handleMentions(
  ctx: Pick<MutationCtx, "db">,
  issue: Doc<"issues">,
  team: Doc<"teams">,
  viewer: Viewer,
  mentioned: Id<"users">[],
  alreadyMentioned: Id<"users">[],
  commentId?: Id<"comments">,
) {
  const fresh = mentioned.filter((id) => !alreadyMentioned.includes(id) && id !== viewer.user._id);
  for (const userId of fresh) {
    const user = await ctx.db.get(userId);
    if (!user) continue;
    const actor = await actorFor(ctx.db, team.workspaceId, userId);
    if (!actor || !canReadTeamContent(actor, toTeam(team))) continue;
    await subscribe(ctx, issue, userId, "mentioned", { force: true });
  }
  await notify(ctx, fresh, {
    issue,
    team,
    actorId: viewer.user._id,
    kind: "mentioned",
    summary: commentId ? "mentioned you in a comment" : "mentioned you in the description",
    commentId,
  });
}

export async function appendHistory(
  ctx: Pick<MutationCtx, "db">,
  issue: Pick<Doc<"issues">, "_id" | "workspaceId">,
  actorId: Id<"users">,
  kind: Doc<"issueHistory">["kind"],
  changes: Change[] = [],
) {
  await ctx.db.insert("issueHistory", { workspaceId: issue.workspaceId, issueId: issue._id, actorId, kind, changes });
}
