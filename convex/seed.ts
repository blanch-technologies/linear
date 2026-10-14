import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { workspaceRole } from "./schema";
import { systemMutation } from "./lib/functions";
import { insertTeamWithDefaults } from "./lib/teams";

/*
 * Demo data (O-11), written by `pnpm seed` after it has created the WorkOS
 * organization, users, and memberships (scripts/seed.ts). Idempotent: rows are
 * matched by WorkOS id or team key and only missing ones are added. Seeded
 * people use @blanch.test addresses, so test auth can sign in as them.
 */

const person = v.object({
  workosUserId: v.string(),
  email: v.string(),
  name: v.string(),
  workosMembershipId: v.string(),
  role: workspaceRole,
});

const team = v.object({
  key: v.string(),
  name: v.string(),
  description: v.string(),
  visibility: v.union(v.literal("public"), v.literal("private"), v.literal("restricted")),
  parentKey: v.optional(v.string()),
  /** Emails of members; the first is the team owner. */
  members: v.array(v.string()),
  issues: v.number(),
});

export const run = systemMutation({
  args: {
    workspace: v.optional(v.object({ workosOrganizationId: v.string(), name: v.string(), urlKey: v.string() })),
    people: v.optional(v.array(person)),
    teams: v.optional(v.array(team)),
  },
  handler: async (ctx, args) => {
    if (!args.workspace || !args.people || !args.teams) {
      return { seeded: false, hint: "Run `pnpm seed`; it creates the WorkOS organization first." };
    }
    const now = Date.now();
    const userIds = new Map<string, Id<"users">>();
    for (const p of args.people) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", p.workosUserId))
        .unique();
      const fields = { workosUserId: p.workosUserId, email: p.email, name: p.name, syncedAt: now };
      userIds.set(p.email, existing ? (await ctx.db.patch(existing._id, fields), existing._id) : await ctx.db.insert("users", fields));
    }

    let workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_workos_organization_id", (q) => q.eq("workosOrganizationId", args.workspace!.workosOrganizationId))
      .unique();
    if (!workspace) {
      const owner = args.people.find((p) => p.role === "owner") ?? args.people[0]!;
      const id = await ctx.db.insert("workspaces", { ...args.workspace, createdBy: userIds.get(owner.email)! });
      workspace = (await ctx.db.get(id))!;
    }
    const workspaceId = workspace._id;

    for (const p of args.people) {
      const userId = userIds.get(p.email)!;
      const existing = await ctx.db
        .query("memberships")
        .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
        .unique();
      if (!existing) {
        await ctx.db.insert("memberships", {
          workspaceId,
          userId,
          workosMembershipId: p.workosMembershipId,
          role: p.role,
          status: "active",
          updatedAt: now,
        });
      }
    }

    const created: string[] = [];
    for (const spec of args.teams) {
      let teamDoc = await ctx.db
        .query("teams")
        .withIndex("by_workspace_and_key", (q) => q.eq("workspaceId", workspaceId).eq("key", spec.key))
        .unique();
      if (!teamDoc) {
        const parent = spec.parentKey
          ? await ctx.db
              .query("teams")
              .withIndex("by_workspace_and_key", (q) => q.eq("workspaceId", workspaceId).eq("key", spec.parentKey!))
              .unique()
          : null;
        const teamId = await insertTeamWithDefaults(ctx, {
          workspaceId,
          name: spec.name,
          key: spec.key,
          description: spec.description,
          parentId: parent?._id ?? null,
          visibility: spec.visibility,
          createdBy: workspace.createdBy,
        });
        teamDoc = (await ctx.db.get(teamId))!;
        created.push(spec.key);
      }
      for (const [index, email] of spec.members.entries()) {
        const userId = userIds.get(email);
        if (!userId) continue;
        const existing = await ctx.db
          .query("teamMembers")
          .withIndex("by_team_and_user", (q) => q.eq("teamId", teamDoc!._id).eq("userId", userId))
          .unique();
        if (!existing) {
          await ctx.db.insert("teamMembers", { workspaceId, teamId: teamDoc._id, userId, role: index === 0 ? "owner" : "member" });
        }
      }
      // Small teams get their issues here; large ones through `issues` in batches.
      if (teamDoc.issueCounter === 0 && spec.issues > 0 && spec.issues <= 200) {
        await insertIssues(ctx, teamDoc, spec.issues, spec.members.map((email) => userIds.get(email)!).filter(Boolean));
      }
    }
    return { seeded: true, workspaceId, created };
  },
});

/**
 * Fills a team up to `target` issues, at most 1000 per call (the O-3 spike).
 * Call until `total` reaches `target`; extra calls add nothing.
 */
export const issues = systemMutation({
  args: { workspaceId: v.id("workspaces"), teamKey: v.string(), target: v.number() },
  handler: async (ctx, { workspaceId, teamKey, target }) => {
    const teamDoc = await ctx.db
      .query("teams")
      .withIndex("by_workspace_and_key", (q) => q.eq("workspaceId", workspaceId).eq("key", teamKey))
      .unique();
    if (!teamDoc) throw new Error(`No team ${teamKey}`);
    const members = await ctx.db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", teamDoc._id)).take(50);
    const batch = Math.max(0, Math.min(target - teamDoc.issueCounter, 1000));
    if (batch > 0) await insertIssues(ctx, teamDoc, batch, members.map((m) => m.userId));
    return { inserted: batch, total: teamDoc.issueCounter + batch };
  },
});

const verbs = ["Fix", "Add", "Improve", "Refactor", "Investigate", "Remove", "Document", "Speed up", "Migrate", "Polish"];
const nouns = [
  "sidebar collapse state", "issue composer", "board drag and drop", "search ranking", "invite flow", "SAML setup",
  "webhook retries", "cycle rollover", "label picker", "inbox filters", "keyboard shortcuts", "export job",
  "project timeline", "triage queue", "audit log export", "dark theme contrast", "notification email", "API rate limits",
];

/** Deterministic pseudo-random sequence so reseeding produces the same data. */
function prng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

async function insertIssues(ctx: Pick<MutationCtx, "db">, teamDoc: Doc<"teams">, count: number, assignees: Id<"users">[]) {
  const states = await ctx.db.query("workflowStates").withIndex("by_team_and_position", (q) => q.eq("teamId", teamDoc._id)).take(50);
  // Weighted toward open work, as in a real team.
  const weights: Record<string, number> = { backlog: 4, unstarted: 3, started: 2, completed: 4, canceled: 1, triage: 0 };
  const categories = new Map(states.map((state) => [state._id, state.category]));
  const pool = states.flatMap((state) => Array.from({ length: weights[state.category] ?? 1 }, () => state._id));
  const random = prng(teamDoc.issueCounter + teamDoc.key.length * 7919);
  const now = Date.now();
  let counter = teamDoc.issueCounter;
  for (let i = 0; i < count; i++) {
    counter += 1;
    const updatedAt = now - Math.floor(random() * 90 * 24 * 3600 * 1000);
    const assigneeIndex = Math.floor(random() * (assignees.length + 1));
    const stateId = pool[Math.floor(random() * pool.length)]!;
    await ctx.db.insert("issues", {
      workspaceId: teamDoc.workspaceId,
      teamId: teamDoc._id,
      number: counter,
      identifier: `${teamDoc.key}-${counter}`,
      title: `${verbs[Math.floor(random() * verbs.length)]} ${nouns[Math.floor(random() * nouns.length)]}`,
      stateId,
      stateCategory: categories.get(stateId)!,
      labelIds: [],
      priority: Math.floor(random() * 5),
      assigneeId: assignees[assigneeIndex],
      creatorId: teamDoc.createdBy,
      sortOrder: -updatedAt,
      version: 1,
      updatedAt,
    });
  }
  await ctx.db.patch(teamDoc._id, { issueCounter: counter });
}
