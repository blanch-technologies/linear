import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "../_generated/server";
import { canReadTeamContent, type Actor, type TeamRole } from "../../src/lib/permissions";
import { toTeam } from "./viewer";

/*
 * Subscriptions and notifications (D-31, ADR 0007). Notifications are written
 * in the same transaction as the change that causes them, only to people who
 * can read the issue, never to the person who made the change. Repeated events
 * of one kind on one issue from one actor within a few minutes update the
 * existing unread entry instead of adding another.
 */

const coalesceWindowMs = 5 * 60 * 1000;

/** Another member's permission input; null when they aren't an active member. */
export async function actorFor(db: DatabaseReader, workspaceId: Id<"workspaces">, userId: Id<"users">): Promise<Actor | null> {
  const membership = await db
    .query("memberships")
    .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
    .unique();
  if (!membership || membership.status !== "active") return null;
  const rows = await db
    .query("teamMembers")
    .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
    .take(1000);
  return {
    workspaceId,
    userId,
    role: membership.role,
    teams: new Map<string, TeamRole>(rows.map((row) => [row.teamId, row.role])),
  };
}

export async function canUserReadIssue(db: DatabaseReader, team: Doc<"teams">, userId: Id<"users">): Promise<boolean> {
  const actor = await actorFor(db, team.workspaceId, userId);
  return actor !== null && canReadTeamContent(actor, toTeam(team));
}

export async function subscribe(
  ctx: Pick<MutationCtx, "db">,
  issue: Pick<Doc<"issues">, "_id" | "workspaceId">,
  userId: Id<"users">,
  reason: Doc<"subscriptions">["reason"],
  { force = false }: { force?: boolean } = {},
) {
  const existing = await ctx.db
    .query("subscriptions")
    .withIndex("by_issue_and_user", (q) => q.eq("issueId", issue._id).eq("userId", userId))
    .unique();
  const now = Date.now();
  if (!existing) {
    await ctx.db.insert("subscriptions", { workspaceId: issue.workspaceId, issueId: issue._id, userId, subscribed: true, reason, updatedAt: now });
  } else if (!existing.subscribed && force) {
    // Only explicit signals (assignment, a mention, a manual subscribe) override an unsubscribe.
    await ctx.db.patch(existing._id, { subscribed: true, reason, updatedAt: now });
  } else if (existing.subscribed) {
    await ctx.db.patch(existing._id, { updatedAt: now });
  }
}

export async function unsubscribe(ctx: Pick<MutationCtx, "db">, issueId: Id<"issues">, userId: Id<"users">) {
  const existing = await ctx.db
    .query("subscriptions")
    .withIndex("by_issue_and_user", (q) => q.eq("issueId", issueId).eq("userId", userId))
    .unique();
  if (existing) await ctx.db.patch(existing._id, { subscribed: false, updatedAt: Date.now() });
}

export async function subscriberIds(db: DatabaseReader, issueId: Id<"issues">): Promise<Id<"users">[]> {
  const rows = await db.query("subscriptions").withIndex("by_issue", (q) => q.eq("issueId", issueId)).take(500);
  return rows.filter((row) => row.subscribed).map((row) => row.userId);
}

export type NotifyEvent = {
  issue: Doc<"issues">;
  team: Doc<"teams">;
  actorId: Id<"users">;
  kind: Doc<"notifications">["kind"];
  summary: string;
  commentId?: Id<"comments">;
};

export async function notify(ctx: Pick<MutationCtx, "db">, recipients: Iterable<Id<"users">>, event: NotifyEvent) {
  const now = Date.now();
  for (const userId of new Set(recipients)) {
    if (userId === event.actorId) continue;
    if (!(await canUserReadIssue(ctx.db, event.team, userId))) continue;
    const recent = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) =>
        q.eq("workspaceId", event.issue.workspaceId).eq("userId", userId).eq("archived", false).gt("createdAt", now - coalesceWindowMs),
      )
      .take(50);
    const same = recent.find(
      (n) => n.issueId === event.issue._id && n.kind === event.kind && n.actorId === event.actorId && !n.readAt && !event.commentId,
    );
    if (same) {
      await ctx.db.patch(same._id, { summary: event.summary, createdAt: now });
      continue;
    }
    await ctx.db.insert("notifications", {
      workspaceId: event.issue.workspaceId,
      userId,
      actorId: event.actorId,
      issueId: event.issue._id,
      kind: event.kind,
      commentId: event.commentId,
      summary: event.summary,
      archived: false,
      createdAt: now,
    });
  }
}
