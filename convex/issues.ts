import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { workspaceMutation, workspaceQuery } from "./lib/functions";
import { fail } from "./lib/errors";
import { requireTeam } from "./lib/viewer";
import { validateName } from "../src/lib/validation";

/*
 * Issues, Phase 1 shape: enough for permission tests and the large-list spike
 * (O-3). Phase 2 replaces the list with the real views and adds the remaining
 * properties. Every read goes through requireTeam(..., "read"); every write
 * through requireTeam(..., "write").
 */

export type IssueChange = Doc<"issueHistory">["changes"][number];

export async function recordHistory(
  ctx: Pick<MutationCtx, "db">,
  issue: Pick<Doc<"issues">, "_id" | "workspaceId">,
  actorId: Id<"users">,
  kind: Doc<"issueHistory">["kind"],
  changes: IssueChange[],
) {
  await ctx.db.insert("issueHistory", { workspaceId: issue.workspaceId, issueId: issue._id, actorId, kind, changes });
}

function toRow(issue: Doc<"issues">) {
  return {
    id: issue._id,
    identifier: issue.identifier,
    number: issue.number,
    title: issue.title,
    stateId: issue.stateId,
    priority: issue.priority,
    assigneeId: issue.assigneeId ?? null,
    sortOrder: issue.sortOrder,
    version: issue.version,
    updatedAt: issue.updatedAt,
  };
}
export type IssueRow = ReturnType<typeof toRow>;

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

export const create = workspaceMutation({
  args: { teamId: v.id("teams"), title: v.string(), priority: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const team = requireTeam(ctx.viewer, args.teamId, "write");
    const title = validateName(args.title, "Title");
    if (!title.ok) fail("INVALID", title.message);
    if (!team.defaultStateId) fail("INVALID", "This team has no default status.");
    const priority = args.priority ?? 0;
    if (!Number.isInteger(priority) || priority < 0 || priority > 4) fail("INVALID", "Unknown priority.");
    // The counter lives on the team row, so concurrent creates serialize (D-24).
    const number = team.issueCounter + 1;
    await ctx.db.patch(team._id, { issueCounter: number });
    const now = Date.now();
    const issueId = await ctx.db.insert("issues", {
      workspaceId: team.workspaceId,
      teamId: team._id,
      number,
      identifier: `${team.key}-${number}`,
      title: title.value,
      stateId: team.defaultStateId,
      priority,
      creatorId: ctx.viewer.user._id,
      sortOrder: -now,
      version: 1,
      updatedAt: now,
    });
    await recordHistory(ctx, { _id: issueId, workspaceId: team.workspaceId }, ctx.viewer.user._id, "created", []);
    return { issueId, identifier: `${team.key}-${number}` };
  },
});

/** D-21: `expectedVersion` rejects writes based on a stale copy. */
export const setPriority = workspaceMutation({
  args: { issueId: v.id("issues"), priority: v.number(), expectedVersion: v.optional(v.number()) },
  handler: async (ctx, { issueId, priority, expectedVersion }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue || issue.workspaceId !== ctx.viewer.workspace._id || issue.deletedAt !== undefined) {
      fail("NOT_FOUND", "Issue not found.");
    }
    requireTeam(ctx.viewer, issue.teamId, "write");
    if (!Number.isInteger(priority) || priority < 0 || priority > 4) fail("INVALID", "Unknown priority.");
    if (expectedVersion !== undefined && expectedVersion !== issue.version) {
      fail("CONFLICT", `${issue.identifier} was changed by someone else. Reload and try again.`);
    }
    if (issue.priority === priority) return { version: issue.version };
    const version = issue.version + 1;
    await ctx.db.patch(issue._id, { priority, version, updatedAt: Date.now() });
    await recordHistory(ctx, issue, ctx.viewer.user._id, "updated", [{ field: "priority", from: issue.priority, to: priority }]);
    return { version };
  },
});
