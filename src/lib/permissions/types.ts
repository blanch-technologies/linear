/**
 * Inputs to the permission module. Plain data only: no Convex or React imports
 * (handoff A2), so the same rules run in Convex functions, in the UI, and in tests.
 */

export const workspaceRoles = ["owner", "admin", "member", "guest"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const teamVisibilities = ["public", "restricted", "private"] as const;
export type TeamVisibility = (typeof teamVisibilities)[number];

export const teamRoles = ["owner", "member"] as const;
export type TeamRole = (typeof teamRoles)[number];

export interface Team {
  id: string;
  workspaceId: string;
  parentId: string | null;
  visibility: TeamVisibility;
}

/** Every team in one workspace, by id. Workspaces have tens of teams, not thousands. */
export type TeamGraph = ReadonlyMap<string, Team>;

/**
 * An active member of one workspace. Signed-in people who are not members (or
 * whose membership is suspended) have no Actor: pass `null`.
 */
export interface Actor {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  /** Explicit team memberships in this workspace. */
  teams: ReadonlyMap<string, TeamRole>;
}

/** The member a workspace-administration action targets. */
export interface MemberTarget {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}
