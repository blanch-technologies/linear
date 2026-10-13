import { describe, expect, it } from "vitest";
import {
  canActOnTeamContent,
  canSeeTeam,
  contentActions,
  type Actor,
  type ContentAction,
  type Team,
  type TeamRole,
  type WorkspaceRole,
} from "./index";

/*
 * D-20 matrix: role x team visibility x action, written out by hand. Each cell
 * lists the content actions allowed (R read, C create, U update, D delete,
 * M move) and `s` when the team itself is visible (name and key). `-` means
 * nothing. The rules are not recomputed here; change a cell only with a reason
 * that matches D-17/D-18.
 *
 * Membership columns: `none` = no team membership; `team` = explicit member;
 * `parent` = member of the restricted team's private parent only.
 */
const matrix = {
  public: {
    "owner/none": "RCUDM s",
    "admin/none": "RCUDM s",
    "member/none": "RCUDM s",
    "guest/none": "-",
    "owner/team": "RCUDM s",
    "admin/team": "RCUDM s",
    "member/team": "RCUDM s",
    "guest/team": "RCUDM s",
    "non-member": "-",
    "other-tenant": "-",
  },
  restricted: {
    "owner/none": "s",
    "admin/none": "s",
    "member/none": "-",
    "guest/none": "-",
    "owner/parent": "R s",
    "admin/parent": "R s",
    "member/parent": "R s",
    "guest/parent": "-",
    "owner/team": "RCUDM s",
    "admin/team": "RCUDM s",
    "member/team": "RCUDM s",
    // guest/team cannot exist: teamMembershipError rejects guests in restricted teams.
    "non-member": "-",
    "other-tenant": "-",
  },
  private: {
    "owner/none": "s",
    "admin/none": "s",
    "member/none": "-",
    "guest/none": "-",
    "owner/team": "RCUDM s",
    "admin/team": "RCUDM s",
    "member/team": "RCUDM s",
    "guest/team": "RCUDM s",
    "non-member": "-",
    "other-tenant": "-",
  },
} as const;

const letters: Record<ContentAction, string> = {
  read: "R",
  create: "C",
  update: "U",
  delete: "D",
  move: "M",
};

const ws = "ws_a";
const team = (id: string, visibility: Team["visibility"], parentId: string | null = null): Team => ({
  id,
  workspaceId: ws,
  parentId,
  visibility,
});

const subjects: Record<keyof typeof matrix, Team> = {
  public: team("pub", "public"),
  restricted: team("restricted", "restricted", "restricted_parent"),
  private: team("priv", "private"),
};
// Move destination: a public team every subject belongs to, so `move` turns on
// the source team alone.
const destination = team("dest", "public");

function actorFor(subject: string, target: Team): Actor | null {
  if (subject === "non-member") return null;
  if (subject === "other-tenant") {
    // An owner elsewhere, even holding a membership row with a colliding id.
    return {
      workspaceId: "ws_b",
      userId: "u_other",
      role: "owner",
      teams: new Map<string, TeamRole>([[target.id, "owner"], [destination.id, "member"]]),
    };
  }
  const [role, membership] = subject.split("/") as [WorkspaceRole, "none" | "team" | "parent"];
  const teams = new Map<string, TeamRole>([[destination.id, "member"]]);
  if (membership === "team") teams.set(target.id, "member");
  if (membership === "parent") teams.set(target.parentId!, "member");
  return { workspaceId: ws, userId: `u_${role}`, role, teams };
}

function observed(actor: Actor | null, target: Team): string {
  const allowed = contentActions
    .filter((action) => canActOnTeamContent(actor, action, target, destination))
    .map((action) => letters[action])
    .join("");
  const parts = [allowed, canSeeTeam(actor, target) ? "s" : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : "-";
}

describe("D-20 permission matrix", () => {
  for (const [visibility, rows] of Object.entries(matrix)) {
    const target = subjects[visibility as keyof typeof matrix];
    describe(visibility, () => {
      for (const [subject, expected] of Object.entries(rows)) {
        it(`${subject}: ${expected}`, () => {
          expect(observed(actorFor(subject, target), target)).toBe(expected);
        });
      }
    });
  }

  it("covers every role in every membership state for each visibility", () => {
    for (const [visibility, rows] of Object.entries(matrix)) {
      const keys = Object.keys(rows);
      for (const role of ["owner", "admin", "member", "guest"]) {
        expect(keys, visibility).toContain(`${role}/none`);
      }
      expect(keys).toContain("non-member");
      expect(keys).toContain("other-tenant");
    }
  });

  it("refuses a move into a team the actor cannot write", () => {
    const member = actorFor("member/none", subjects.public)!;
    expect(canActOnTeamContent(member, "move", subjects.public, subjects.private)).toBe(false);
    expect(canActOnTeamContent(member, "move", subjects.public)).toBe(false);
  });
});
