import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";

/** Active owners, capped at 2: callers only need "one" versus "more than one". */
export async function countActiveOwners(db: DatabaseReader, workspaceId: Id<"workspaces">): Promise<number> {
  const owners = await db
    .query("memberships")
    .withIndex("by_workspace_and_status_and_role", (q) =>
      q.eq("workspaceId", workspaceId).eq("status", "active").eq("role", "owner"),
    )
    .take(2);
  return owners.length;
}

export function userSummary(user: Doc<"users">) {
  return { id: user._id, name: user.name, email: user.email, avatarUrl: user.avatarUrl ?? null };
}

/** The membership if it belongs to the viewer's workspace; foreign ids look missing. */
export async function membershipInWorkspace(
  db: DatabaseReader,
  workspaceId: Id<"workspaces">,
  membershipId: Id<"memberships">,
): Promise<Doc<"memberships"> | null> {
  const membership = await db.get(membershipId);
  return membership && membership.workspaceId === workspaceId ? membership : null;
}
