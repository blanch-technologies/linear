import { canReadTeamContent, canWriteTeamContent } from "./teams";
import type { Actor, Team } from "./types";

/** Actions on team-owned content: issues, projects, documents, attachments. */
export const contentActions = ["read", "create", "update", "delete", "move"] as const;
export type ContentAction = (typeof contentActions)[number];

/**
 * The single question every content query and mutation asks (D-19, D-20).
 * `move` needs write access to both the source and the destination team.
 */
export function canActOnTeamContent(
  actor: Actor | null,
  action: ContentAction,
  team: Team,
  destination?: Team,
): boolean {
  switch (action) {
    case "read":
      return canReadTeamContent(actor, team);
    case "create":
    case "update":
    case "delete":
      return canWriteTeamContent(actor, team);
    case "move":
      return (
        destination !== undefined &&
        canWriteTeamContent(actor, team) &&
        canWriteTeamContent(actor, destination)
      );
  }
}
