import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { defaultWorkflowStates } from "../../src/lib/workflow";
import type { TeamVisibility } from "../../src/lib/permissions";
import { fail } from "./errors";

/** Positions are spaced so a state can be inserted between two without renumbering. */
export const positionStep = 1000;

export async function assertTeamKeyFree(
  ctx: Pick<MutationCtx, "db">,
  workspaceId: Id<"workspaces">,
  key: string,
  exceptTeamId?: Id<"teams">,
) {
  const existing = await ctx.db
    .query("teams")
    .withIndex("by_workspace_and_key", (q) => q.eq("workspaceId", workspaceId).eq("key", key))
    .first();
  if (existing && existing._id !== exceptTeamId) fail("CONFLICT", `Another team already uses the identifier ${key}.`);
}

/** Inserts a team with the D-27 default workflow states and its default state set. */
export async function insertTeamWithDefaults(
  ctx: Pick<MutationCtx, "db">,
  team: {
    workspaceId: Id<"workspaces">;
    name: string;
    key: string;
    description?: string;
    parentId: Id<"teams"> | null;
    visibility: TeamVisibility;
    createdBy: Id<"users">;
  },
): Promise<Id<"teams">> {
  await assertTeamKeyFree(ctx, team.workspaceId, team.key);
  const teamId = await ctx.db.insert("teams", { ...team, issueCounter: 0 });
  let defaultStateId: Id<"workflowStates"> | undefined;
  for (const [index, state] of defaultWorkflowStates.entries()) {
    const stateId = await ctx.db.insert("workflowStates", {
      workspaceId: team.workspaceId,
      teamId,
      name: state.name,
      category: state.category,
      color: state.color,
      position: (index + 1) * positionStep,
    });
    if (state.isDefault) defaultStateId = stateId;
  }
  await ctx.db.patch(teamId, { defaultStateId });
  return teamId;
}

/** Removes every membership of `userId` in the given teams. */
export async function removeTeamMemberships(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  teamIds: Iterable<Id<"teams">>,
) {
  for (const teamId of teamIds) {
    const row = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_and_user", (q) => q.eq("teamId", teamId).eq("userId", userId))
      .unique();
    if (row) await ctx.db.delete(row._id);
  }
}
