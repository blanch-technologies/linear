import type { Team, TeamGraph, TeamVisibility } from "./types";

/** D-17: a team tree is at most five levels deep, counting the top-level team. */
export const maxTeamDepth = 5;

/** Parent first, root last. Stops on a corrupt (cyclic) chain instead of looping. */
export function ancestors(graph: TeamGraph, team: Team): Team[] {
  const chain: Team[] = [];
  const seen = new Set([team.id]);
  let parentId = team.parentId;
  while (parentId && !seen.has(parentId)) {
    const parent = graph.get(parentId);
    if (!parent) break;
    chain.push(parent);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return chain;
}

export function children(graph: TeamGraph, teamId: string): Team[] {
  return [...graph.values()].filter((team) => team.parentId === teamId);
}

/** Every team below `teamId`, nearest first. */
export function descendants(graph: TeamGraph, teamId: string): Team[] {
  const found: Team[] = [];
  const queue = [teamId];
  const seen = new Set(queue);
  while (queue.length > 0) {
    for (const child of children(graph, queue.shift()!)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      found.push(child);
      queue.push(child.id);
    }
  }
  return found;
}

/** Levels in the subtree rooted at `teamId`, including itself. */
function subtreeHeight(graph: TeamGraph, teamId: string, seen = new Set<string>()): number {
  seen.add(teamId);
  let height = 0;
  for (const child of children(graph, teamId)) {
    if (!seen.has(child.id)) height = Math.max(height, subtreeHeight(graph, child.id, seen));
  }
  return height + 1;
}

export type PlacementError =
  | "PARENT_NOT_FOUND"
  | "CYCLE"
  | "TOO_DEEP"
  | "RESTRICTED_NEEDS_PRIVATE_PARENT"
  | "RESTRICTED_CHILDREN_NEED_PRIVATE_PARENT";

export const placementErrorMessages: Record<PlacementError, string> = {
  PARENT_NOT_FOUND: "The parent team does not exist.",
  CYCLE: "A team cannot be nested under itself or one of its sub-teams.",
  TOO_DEEP: `Teams can be nested at most ${maxTeamDepth} levels deep.`,
  RESTRICTED_NEEDS_PRIVATE_PARENT: "A restricted team must be a sub-team of a private team.",
  RESTRICTED_CHILDREN_NEED_PRIVATE_PARENT:
    "This team has restricted sub-teams, so it must stay private.",
};

/**
 * Checks a new team (no `id`) or a change to an existing one against D-17:
 * parent exists in the same workspace, no cycles, five levels at most, and
 * restricted teams sit under a private parent.
 */
export function validateTeamPlacement(
  graph: TeamGraph,
  change: {
    id?: string;
    workspaceId: string;
    parentId: string | null;
    visibility: TeamVisibility;
  },
): PlacementError | null {
  let parentDepth = 0;
  if (change.parentId) {
    const parent = graph.get(change.parentId);
    if (!parent || parent.workspaceId !== change.workspaceId) return "PARENT_NOT_FOUND";
    if (change.id && (parent.id === change.id || ancestors(graph, parent).some((t) => t.id === change.id))) {
      return "CYCLE";
    }
    parentDepth = ancestors(graph, parent).length + 1;
    if (change.visibility === "restricted" && parent.visibility !== "private") {
      return "RESTRICTED_NEEDS_PRIVATE_PARENT";
    }
  } else if (change.visibility === "restricted") {
    return "RESTRICTED_NEEDS_PRIVATE_PARENT";
  }

  const height = change.id ? subtreeHeight(graph, change.id) : 1;
  if (parentDepth + height > maxTeamDepth) return "TOO_DEEP";

  if (
    change.id &&
    change.visibility !== "private" &&
    children(graph, change.id).some((child) => child.visibility === "restricted")
  ) {
    return "RESTRICTED_CHILDREN_NEED_PRIVATE_PARENT";
  }
  return null;
}
