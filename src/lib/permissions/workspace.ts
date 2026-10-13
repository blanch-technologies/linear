import type { Actor, MemberTarget, WorkspaceRole } from "./types";

/** Owners and admins administer the workspace. */
export function isAdmin(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

function inWorkspace(actor: Actor | null, workspaceId: string): actor is Actor {
  return actor !== null && actor.workspaceId === workspaceId;
}

export function canManageWorkspace(actor: Actor | null, workspaceId: string): boolean {
  return inWorkspace(actor, workspaceId) && isAdmin(actor.role);
}

/** D-18: guests see only themselves, never the member directory. */
export function canViewMemberDirectory(actor: Actor | null, workspaceId: string): boolean {
  return inWorkspace(actor, workspaceId) && actor.role !== "guest";
}

/** D-18: no initiatives or other workspace-wide surfaces for guests. */
export function canViewWorkspaceSurfaces(actor: Actor | null, workspaceId: string): boolean {
  return inWorkspace(actor, workspaceId) && actor.role !== "guest";
}

export function canCreateTeam(actor: Actor | null, workspaceId: string): boolean {
  return inWorkspace(actor, workspaceId) && actor.role !== "guest";
}

/** Owners invite any role; admins invite anyone except owners. */
export function canInvite(actor: Actor | null, workspaceId: string, role: WorkspaceRole): boolean {
  if (!inWorkspace(actor, workspaceId)) return false;
  if (actor.role === "owner") return true;
  return actor.role === "admin" && role !== "owner";
}

/** Revoking or resending an invitation needs the right to send it. */
export const canManageInvitation = canInvite;

/** Only owners touch owners or grant ownership. Last-owner rules are separate. */
export function canChangeMemberRole(
  actor: Actor | null,
  target: MemberTarget,
  nextRole: WorkspaceRole,
): boolean {
  if (!inWorkspace(actor, target.workspaceId)) return false;
  if (actor.role === "owner") return true;
  return actor.role === "admin" && target.role !== "owner" && nextRole !== "owner";
}

/** Anyone may leave; removing someone else follows the role-change rule. */
export function canRemoveMember(actor: Actor | null, target: MemberTarget): boolean {
  if (!inWorkspace(actor, target.workspaceId)) return false;
  if (actor.userId === target.userId) return true;
  return canChangeMemberRole(actor, target, target.role) && isAdmin(actor.role);
}

/** Suspension (deactivation) is never self-service. */
export function canSuspendMember(actor: Actor | null, target: MemberTarget): boolean {
  if (!inWorkspace(actor, target.workspaceId) || actor.userId === target.userId) return false;
  return canRemoveMember(actor, target);
}

/**
 * D-16: at least one active owner must remain. True when the change (a new
 * role, or `null` for removal or suspension) would leave the workspace with none.
 */
export function wouldRemoveLastOwner(
  activeOwnerCount: number,
  targetRole: WorkspaceRole,
  nextRole: WorkspaceRole | null,
): boolean {
  return targetRole === "owner" && nextRole !== "owner" && activeOwnerCount <= 1;
}
