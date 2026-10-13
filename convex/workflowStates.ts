import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { stateCategory } from "./schema";
import { systemMutation, workspaceMutation, workspaceQuery } from "./lib/functions";
import { fail } from "./lib/errors";
import { positionStep } from "./lib/teams";
import { requireTeam, toTeam } from "./lib/viewer";
import { canManageTeam, canReadTeamContent } from "../src/lib/permissions";
import { validateDescription, validateName } from "../src/lib/validation";
import { defaultableCategories, isHexColor, requiredCategories, stateCategories } from "../src/lib/workflow";

/** Issues moved per transaction when a state is deleted. */
const reassignBatch = 500;

async function statesOf(db: DatabaseReader, teamId: Id<"teams">) {
  return await db.query("workflowStates").withIndex("by_team_and_position", (q) => q.eq("teamId", teamId)).take(200);
}

/** A team's states in category order, then position. Needs read or manage access. */
export const list = workspaceQuery({
  args: { teamId: v.id("teams") },
  handler: async ({ db, viewer }, { teamId }) => {
    const doc = requireTeam(viewer, teamId, "see");
    const team = toTeam(doc);
    const canManage = canManageTeam(viewer.actor, team, viewer.graph);
    if (!canReadTeamContent(viewer.actor, team) && !canManage) fail("FORBIDDEN", "You don't have access to this team.");
    const states = await statesOf(db, doc._id);
    // One indexed read per state: enough to ask for a replacement before deleting.
    const used = await Promise.all(
      states.map(async (s) => !!(await db.query("issues").withIndex("by_state", (q) => q.eq("stateId", s._id)).first())),
    );
    return {
      canManage,
      defaultStateId: doc.defaultStateId ?? null,
      states: states
        .map((s, index) => ({
          id: s._id,
          name: s.name,
          category: s.category,
          color: s.color,
          description: s.description ?? "",
          position: s.position,
          hasIssues: used[index]!,
        }))
        .sort((a, b) => stateCategories.indexOf(a.category) - stateCategories.indexOf(b.category) || a.position - b.position),
    };
  },
});

function requireState(state: Doc<"workflowStates"> | null, workspaceId: Id<"workspaces">) {
  if (!state || state.workspaceId !== workspaceId) fail("NOT_FOUND", "Status not found.");
  return state;
}

function validColor(color: string) {
  if (!isHexColor(color)) fail("INVALID", "Pick a color.");
  return color.toLowerCase();
}

export const create = workspaceMutation({
  args: {
    teamId: v.id("teams"),
    name: v.string(),
    category: stateCategory,
    color: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const team = requireTeam(ctx.viewer, args.teamId, "manage");
    if (args.category === "triage") fail("INVALID", "Triage is turned on in team settings, not added as a status.");
    const name = validateName(args.name, "Status name");
    if (!name.ok) fail("INVALID", name.message);
    const description = validateDescription(args.description, 280);
    if (!description.ok) fail("INVALID", description.message);
    const states = await statesOf(ctx.db, team._id);
    if (states.some((s) => s.name.toLowerCase() === name.value.toLowerCase())) {
      fail("CONFLICT", `This team already has a status named ${name.value}.`);
    }
    const last = Math.max(0, ...states.filter((s) => s.category === args.category).map((s) => s.position));
    const anyLast = Math.max(0, ...states.map((s) => s.position));
    return await ctx.db.insert("workflowStates", {
      workspaceId: team.workspaceId,
      teamId: team._id,
      name: name.value,
      category: args.category,
      color: validColor(args.color),
      description: description.value || undefined,
      position: (last || anyLast) + positionStep,
    });
  },
});

export const update = workspaceMutation({
  args: {
    stateId: v.id("workflowStates"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const state = requireState(await ctx.db.get(args.stateId), ctx.viewer.workspace._id);
    requireTeam(ctx.viewer, state.teamId, "manage");
    const patch: Partial<Doc<"workflowStates">> = {};
    if (args.name !== undefined) {
      const name = validateName(args.name, "Status name");
      if (!name.ok) fail("INVALID", name.message);
      const states = await statesOf(ctx.db, state.teamId);
      if (states.some((s) => s._id !== state._id && s.name.toLowerCase() === name.value.toLowerCase())) {
        fail("CONFLICT", `This team already has a status named ${name.value}.`);
      }
      patch.name = name.value;
    }
    if (args.color !== undefined) patch.color = validColor(args.color);
    if (args.description !== undefined) {
      const description = validateDescription(args.description, 280);
      if (!description.ok) fail("INVALID", description.message);
      patch.description = description.value || undefined;
    }
    await ctx.db.patch(state._id, patch);
    return null;
  },
});

/** Moves a state before `beforeStateId` (or to the end) within its category. */
export const move = workspaceMutation({
  args: { stateId: v.id("workflowStates"), beforeStateId: v.optional(v.id("workflowStates")) },
  handler: async (ctx, { stateId, beforeStateId }) => {
    const state = requireState(await ctx.db.get(stateId), ctx.viewer.workspace._id);
    requireTeam(ctx.viewer, state.teamId, "manage");
    const siblings = (await statesOf(ctx.db, state.teamId))
      .filter((s) => s.category === state.category && s._id !== state._id)
      .sort((a, b) => a.position - b.position);
    let position: number;
    if (beforeStateId) {
      const index = siblings.findIndex((s) => s._id === beforeStateId);
      if (index < 0) fail("INVALID", "Statuses can only be reordered within their category.");
      const after = siblings[index]!.position;
      const before = index > 0 ? siblings[index - 1]!.position : after - 2 * positionStep;
      position = (before + after) / 2;
    } else {
      position = (siblings.at(-1)?.position ?? state.position) + positionStep;
    }
    await ctx.db.patch(state._id, { position });
    return null;
  },
});

export const setDefault = workspaceMutation({
  args: { stateId: v.id("workflowStates") },
  handler: async (ctx, { stateId }) => {
    const state = requireState(await ctx.db.get(stateId), ctx.viewer.workspace._id);
    const team = requireTeam(ctx.viewer, state.teamId, "manage");
    if (!defaultableCategories.includes(state.category)) {
      fail("INVALID", "The default status must be a Backlog or Unstarted status.");
    }
    await ctx.db.patch(team._id, { defaultStateId: state._id });
    return null;
  },
});

/**
 * Deletes a state. Its issues move to `replacementStateId` first, in batches;
 * the state disappears once it's empty. The default state and the last state
 * of a required category can't be deleted.
 */
export const remove = workspaceMutation({
  args: { stateId: v.id("workflowStates"), replacementStateId: v.optional(v.id("workflowStates")) },
  handler: async (ctx, { stateId, replacementStateId }) => {
    const state = requireState(await ctx.db.get(stateId), ctx.viewer.workspace._id);
    const team = requireTeam(ctx.viewer, state.teamId, "manage");
    if (team.defaultStateId === state._id) fail("INVALID", "Choose another default status before deleting this one.");
    const states = await statesOf(ctx.db, team._id);
    if (requiredCategories.includes(state.category) && states.filter((s) => s.category === state.category).length === 1) {
      fail("INVALID", "Each category needs at least one status.");
    }
    const hasIssues = await ctx.db.query("issues").withIndex("by_state", (q) => q.eq("stateId", state._id)).first();
    if (hasIssues) {
      const replacement = replacementStateId ? await ctx.db.get(replacementStateId) : null;
      if (!replacement || replacement.teamId !== team._id || replacement._id === state._id) {
        fail("INVALID", "Choose a status to move this status's issues to.");
      }
      await ctx.scheduler.runAfter(0, internal.workflowStates.reassignAndDelete, {
        stateId: state._id,
        replacementStateId: replacement._id,
      });
      return { pending: true };
    }
    await ctx.db.delete(state._id);
    return { pending: false };
  },
});

export const reassignAndDelete = systemMutation({
  args: { stateId: v.id("workflowStates"), replacementStateId: v.id("workflowStates") },
  handler: async (ctx, { stateId, replacementStateId }) => {
    const issues = await ctx.db.query("issues").withIndex("by_state", (q) => q.eq("stateId", stateId)).take(reassignBatch);
    const now = Date.now();
    for (const issue of issues) {
      await ctx.db.patch(issue._id, { stateId: replacementStateId, version: issue.version + 1, updatedAt: now });
    }
    if (issues.length === reassignBatch) {
      await ctx.scheduler.runAfter(0, internal.workflowStates.reassignAndDelete, { stateId, replacementStateId });
    } else if (await ctx.db.get(stateId)) {
      await ctx.db.delete(stateId);
    }
  },
});
