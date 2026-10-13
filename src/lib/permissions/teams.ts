import { ancestors } from "./hierarchy";
import type { Actor, Team, TeamGraph, TeamRole, WorkspaceRole } from "./types";
import { isAdmin } from "./workspace";

/*
 * Team access (D-17, D-18). Three separate questions:
 * - see: the team's name and key appear (sidebar, pickers, settings).
 * - read: its issues, projects, documents, and attachments.
 * - write: create, change, delete, or move that content.
 * Explicit membership grants everything, for every role. Admins see private
 * teams so they can join them, but never read their content without joining
 * (the prototype's P0 bug, docs/reference/nonlinear-functionality-audit.md).
 */

function sameTenant(actor: Actor | null, team: Team): actor is Actor {
  return actor !== null && actor.workspaceId === team.workspaceId;
}

export function isTeamMember(actor: Actor, teamId: string): boolean {
  return actor.teams.has(teamId);
}

function isParentMember(actor: Actor, team: Team): boolean {
  return team.parentId !== null && actor.teams.has(team.parentId);
}

export function canSeeTeam(actor: Actor | null, team: Team): boolean {
  if (!sameTenant(actor, team)) return false;
  if (isTeamMember(actor, team.id)) return true;
  if (actor.role === "guest") return false;
  if (isAdmin(actor.role)) return true;
  if (team.visibility === "public") return true;
  if (team.visibility === "restricted") return isParentMember(actor, team);
  return false;
}

export function canReadTeamContent(actor: Actor | null, team: Team): boolean {
  if (!sameTenant(actor, team)) return false;
  if (isTeamMember(actor, team.id)) return true;
  if (actor.role === "guest") return false;
  if (team.visibility === "public") return true;
  if (team.visibility === "restricted") return isParentMember(actor, team);
  return false;
}

export function canWriteTeamContent(actor: Actor | null, team: Team): boolean {
  if (!sameTenant(actor, team)) return false;
  if (isTeamMember(actor, team.id)) return true;
  return actor.role !== "guest" && team.visibility === "public";
}

/**
 * Manage = settings, workflow states, and membership. Workspace admins, the
 * team's owners, and members of any ancestor team (D-17) manage a team.
 */
export function canManageTeam(actor: Actor | null, team: Team, graph: TeamGraph): boolean {
  if (!sameTenant(actor, team) || actor.role === "guest") return false;
  if (isAdmin(actor.role)) return true;
  if (actor.teams.get(team.id) === "owner") return true;
  return ancestors(graph, team).some((ancestor) => isTeamMember(actor, ancestor.id));
}

/** D-17: only admins move a team to a new parent (or to the top level). */
export function canReparentTeam(actor: Actor | null, team: Team): boolean {
  return sameTenant(actor, team) && isAdmin(actor.role);
}

export function canDeleteTeam(actor: Actor | null, team: Team): boolean {
  return sameTenant(actor, team) && isAdmin(actor.role);
}

/** Self-service join. Guests are added by someone who manages the team. */
export function canJoinTeam(actor: Actor | null, team: Team): boolean {
  if (!sameTenant(actor, team) || actor.role === "guest") return false;
  if (isTeamMember(actor, team.id)) return false;
  if (team.parentId !== null && !isParentMember(actor, team)) return false;
  if (team.visibility === "public" || team.visibility === "restricted") return true;
  return isAdmin(actor.role);
}

export type TeamMembershipError = "PARENT_MEMBERSHIP_REQUIRED" | "GUESTS_NOT_ALLOWED";

export const teamMembershipErrorMessages: Record<TeamMembershipError, string> = {
  PARENT_MEMBERSHIP_REQUIRED: "Add them to the parent team first.",
  GUESTS_NOT_ALLOWED: "Guests can't join restricted teams.",
};

/**
 * Invariants on who may be in a team, whoever adds them: non-guest members of a
 * sub-team also belong to its parent; restricted teams have no guests.
 */
export function teamMembershipError(
  team: Team,
  member: { role: WorkspaceRole; teams: ReadonlyMap<string, TeamRole> },
): TeamMembershipError | null {
  if (member.role === "guest") {
    return team.visibility === "restricted" ? "GUESTS_NOT_ALLOWED" : null;
  }
  if (team.parentId !== null && !member.teams.has(team.parentId)) {
    return "PARENT_MEMBERSHIP_REQUIRED";
  }
  return null;
}

/** Adding someone else needs manage rights; adding yourself needs join rights. */
export function canAddTeamMember(
  actor: Actor | null,
  team: Team,
  graph: TeamGraph,
  targetUserId: string,
): boolean {
  if (actor?.userId === targetUserId) return canJoinTeam(actor, team) || canManageTeam(actor, team, graph);
  return canManageTeam(actor, team, graph);
}

/** Anyone may leave a team; removing someone else needs manage rights. */
export function canRemoveTeamMember(
  actor: Actor | null,
  team: Team,
  graph: TeamGraph,
  targetUserId: string,
): boolean {
  if (!sameTenant(actor, team)) return false;
  if (actor.userId === targetUserId) return isTeamMember(actor, team.id);
  return canManageTeam(actor, team, graph);
}

export function canChangeTeamMemberRole(actor: Actor | null, team: Team, graph: TeamGraph): boolean {
  return canManageTeam(actor, team, graph);
}
