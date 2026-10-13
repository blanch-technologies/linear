import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import {
  canManageTeam,
  canReadTeamContent,
  canSeeTeam,
  canWriteTeamContent,
  type Actor,
  type Team,
  type TeamGraph,
  type TeamRole,
} from "../../src/lib/permissions";
import { fail } from "./errors";

/** Teams loaded per call to build the graph. Far above any real workspace. */
const maxTeamsPerWorkspace = 1000;

export type Viewer = {
  identity: UserIdentity;
  user: Doc<"users">;
  workspace: Doc<"workspaces">;
  membership: Doc<"memberships">;
  /** Input to src/lib/permissions. */
  actor: Actor;
  graph: TeamGraph;
  teams: ReadonlyMap<Id<"teams">, Doc<"teams">>;
};

export async function requireIdentity(ctx: {
  auth: { getUserIdentity(): Promise<UserIdentity | null> };
}): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("UNAUTHENTICATED", "Sign in to continue.");
  return identity;
}

/** WorkOS organization the session is scoped to, from the signed token. */
export function organizationClaim(identity: UserIdentity): string | null {
  return typeof identity.org_id === "string" ? identity.org_id : null;
}

export function userByIdentity(db: DatabaseReader, identity: UserIdentity) {
  return db
    .query("users")
    .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", identity.subject))
    .unique();
}

export function toTeam(doc: Doc<"teams">): Team {
  return { id: doc._id, workspaceId: doc.workspaceId, parentId: doc.parentId, visibility: doc.visibility };
}

/**
 * Resolves who is calling and in which workspace (D-15): the WorkOS user from
 * the token subject, the workspace from its `org_id` claim, and an active
 * membership. Nothing comes from client arguments.
 */
export async function loadViewer(ctx: {
  db: DatabaseReader;
  auth: { getUserIdentity(): Promise<UserIdentity | null> };
}): Promise<Viewer> {
  const identity = await requireIdentity(ctx);
  const organizationId = organizationClaim(identity);
  if (!organizationId) fail("NO_WORKSPACE", "Choose a workspace.");

  const [user, workspace] = await Promise.all([
    userByIdentity(ctx.db, identity),
    ctx.db
      .query("workspaces")
      .withIndex("by_workos_organization_id", (q) => q.eq("workosOrganizationId", organizationId))
      .unique(),
  ]);
  if (!workspace || !user) fail("NO_WORKSPACE", "This workspace isn't available.");

  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspace._id).eq("userId", user._id))
    .unique();
  if (!membership) fail("NO_WORKSPACE", "You're not a member of this workspace.");
  if (membership.status !== "active") fail("FORBIDDEN", "Your access to this workspace is suspended.");

  const [teamDocs, teamMemberships] = await Promise.all([
    ctx.db
      .query("teams")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(maxTeamsPerWorkspace),
    ctx.db
      .query("teamMembers")
      .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspace._id).eq("userId", user._id))
      .take(maxTeamsPerWorkspace),
  ]);

  return {
    identity,
    user,
    workspace,
    membership,
    actor: {
      workspaceId: workspace._id,
      userId: user._id,
      role: membership.role,
      teams: new Map<string, TeamRole>(teamMemberships.map((m) => [m.teamId, m.role])),
    },
    graph: new Map(teamDocs.map((doc) => [doc._id as string, toTeam(doc)])),
    teams: new Map(teamDocs.map((doc) => [doc._id, doc])),
  };
}

export type TeamAccess = "see" | "read" | "write" | "manage";

/**
 * The team, if the viewer has `access` to it. Teams the viewer cannot see are
 * reported as missing, so their existence doesn't leak.
 */
export function requireTeam(viewer: Viewer, teamId: Id<"teams">, access: TeamAccess): Doc<"teams"> {
  const doc = viewer.teams.get(teamId);
  const team = doc && toTeam(doc);
  if (!doc || !team || !canSeeTeam(viewer.actor, team)) fail("NOT_FOUND", "Team not found.");
  const allowed =
    access === "see" ||
    (access === "read" && canReadTeamContent(viewer.actor, team)) ||
    (access === "write" && canWriteTeamContent(viewer.actor, team)) ||
    (access === "manage" && canManageTeam(viewer.actor, team, viewer.graph));
  if (!allowed) {
    fail("FORBIDDEN", access === "manage" ? "Only team managers can change this team." : "You don't have access to this team.");
  }
  return doc;
}
