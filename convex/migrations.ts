import { v } from "convex/values";
import { internal } from "./_generated/api";
import { systemMutation } from "./lib/functions";

/*
 * Data migrations, run with `pnpm exec convex run migrations:<name>`. Each is
 * idempotent and resumable (it schedules itself until done).
 *
 * backfillIssueFields (Phase 2): issues created by Phase 1 code lack
 * `stateCategory` and `labelIds`. Only local dev deployments hold such issues.
 */
export const backfillIssueFields = systemMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("issues").paginate({ cursor: cursor ?? null, numItems: 500 });
    let fixed = 0;
    for (const issue of page.page) {
      const raw = issue as typeof issue & { stateCategory?: string; labelIds?: unknown };
      if (raw.stateCategory && Array.isArray(raw.labelIds)) continue;
      const state = await ctx.db.get(issue.stateId);
      await ctx.db.patch(issue._id, { stateCategory: state?.category ?? "backlog", labelIds: raw.labelIds ?? [] });
      fixed += 1;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.backfillIssueFields, { cursor: page.continueCursor });
    return { fixed, done: page.isDone };
  },
});
