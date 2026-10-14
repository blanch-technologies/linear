import { describe, expect, it } from "vitest";
import {
  canAddTeamMember,
  canDeleteTeam,
  canJoinTeam,
  canManageTeam,
  canRemoveTeamMember,
  canReparentTeam,
  descendants,
  teamMembershipError,
  validateTeamPlacement,
  type Actor,
  type Team,
  type TeamGraph,
  type TeamRole,
  type WorkspaceRole,
} from "./index";

const ws = "ws_a";
const t = (id: string, visibility: Team["visibility"], parentId: string | null = null): Team => ({
  id,
  workspaceId: ws,
  parentId,
  visibility,
});
const graphOf = (...teams: Team[]): TeamGraph => new Map(teams.map((team) => [team.id, team]));
const actor = (role: WorkspaceRole, teams: [string, TeamRole][] = []): Actor => ({
  workspaceId: ws,
  userId: "me",
  role,
  teams: new Map(teams),
});

const eng = t("eng", "public");
const sec = t("sec", "private");
const secOps = t("sec_ops", "restricted", "sec");
const engWeb = t("eng_web", "public", "eng");
const engWebUi = t("eng_web_ui", "private", "eng_web");
const graph = graphOf(eng, sec, secOps, engWeb, engWebUi);

describe("team management", () => {
  it("is granted to admins, team owners, and members of an ancestor (D-17)", () => {
    expect(canManageTeam(actor("admin"), sec, graph)).toBe(true);
    expect(canManageTeam(actor("member", [["eng_web", "owner"]]), engWeb, graph)).toBe(true);
    expect(canManageTeam(actor("member", [["eng_web", "member"]]), engWeb, graph)).toBe(false);
    expect(canManageTeam(actor("member", [["eng", "member"]]), engWebUi, graph)).toBe(true);
    expect(canManageTeam(actor("member", [["sec", "member"]]), secOps, graph)).toBe(true);
    expect(canManageTeam(actor("guest", [["eng", "owner"]]), eng, graph)).toBe(false);
  });

  it("limits reparenting and deletion to admins", () => {
    expect(canReparentTeam(actor("owner"), engWeb)).toBe(true);
    expect(canReparentTeam(actor("member", [["eng", "owner"]]), engWeb)).toBe(false);
    expect(canDeleteTeam(actor("admin"), eng)).toBe(true);
    expect(canDeleteTeam(actor("member", [["eng", "owner"]]), eng)).toBe(false);
  });
});

describe("joining and membership", () => {
  it("lets non-guests join public teams, and admins join private ones", () => {
    expect(canJoinTeam(actor("member"), eng)).toBe(true);
    expect(canJoinTeam(actor("guest"), eng)).toBe(false);
    expect(canJoinTeam(actor("member"), sec)).toBe(false);
    expect(canJoinTeam(actor("admin"), sec)).toBe(true);
    expect(canJoinTeam(actor("member", [["eng", "member"]]), eng)).toBe(false);
  });

  it("requires membership in the parent before joining a sub-team", () => {
    expect(canJoinTeam(actor("member"), engWeb)).toBe(false);
    expect(canJoinTeam(actor("member", [["eng", "member"]]), engWeb)).toBe(true);
    expect(canJoinTeam(actor("member", [["sec", "member"]]), secOps)).toBe(true);
    expect(canJoinTeam(actor("admin"), secOps)).toBe(false);
  });

  it("enforces parent membership and keeps guests out of restricted teams", () => {
    const member = { role: "member" as const, teams: new Map<string, TeamRole>() };
    expect(teamMembershipError(engWeb, member)).toBe("PARENT_MEMBERSHIP_REQUIRED");
    expect(teamMembershipError(eng, member)).toBeNull();
    expect(teamMembershipError(engWeb, { ...member, teams: new Map([["eng", "member"]]) })).toBeNull();
    const guest = { role: "guest" as const, teams: new Map<string, TeamRole>() };
    expect(teamMembershipError(secOps, guest)).toBe("GUESTS_NOT_ALLOWED");
    expect(teamMembershipError(engWeb, guest)).toBeNull();
  });

  it("separates adding others (manage) from adding yourself (join)", () => {
    const member = actor("member");
    expect(canAddTeamMember(member, eng, graph, "me")).toBe(true);
    expect(canAddTeamMember(member, eng, graph, "someone")).toBe(false);
    expect(canAddTeamMember(actor("admin"), sec, graph, "someone")).toBe(true);
  });

  it("lets members leave and managers remove", () => {
    expect(canRemoveTeamMember(actor("guest", [["eng", "member"]]), eng, graph, "me")).toBe(true);
    expect(canRemoveTeamMember(actor("member"), eng, graph, "me")).toBe(false);
    expect(canRemoveTeamMember(actor("member"), eng, graph, "someone")).toBe(false);
    expect(canRemoveTeamMember(actor("admin"), eng, graph, "someone")).toBe(true);
  });
});

describe("hierarchy validation", () => {
  it("accepts valid placements", () => {
    expect(validateTeamPlacement(graph, { workspaceId: ws, parentId: null, visibility: "public" })).toBeNull();
    expect(validateTeamPlacement(graph, { workspaceId: ws, parentId: "sec", visibility: "restricted" })).toBeNull();
    expect(validateTeamPlacement(graph, { id: "eng_web", workspaceId: ws, parentId: null, visibility: "public" })).toBeNull();
  });

  it("requires a private parent for restricted teams", () => {
    expect(validateTeamPlacement(graph, { workspaceId: ws, parentId: null, visibility: "restricted" })).toBe(
      "RESTRICTED_NEEDS_PRIVATE_PARENT",
    );
    expect(validateTeamPlacement(graph, { workspaceId: ws, parentId: "eng", visibility: "restricted" })).toBe(
      "RESTRICTED_NEEDS_PRIVATE_PARENT",
    );
    expect(validateTeamPlacement(graph, { id: "sec", workspaceId: ws, parentId: null, visibility: "public" })).toBe(
      "RESTRICTED_CHILDREN_NEED_PRIVATE_PARENT",
    );
  });

  it("rejects cycles, unknown parents, and parents in another workspace", () => {
    expect(validateTeamPlacement(graph, { id: "eng", workspaceId: ws, parentId: "eng_web_ui", visibility: "public" })).toBe("CYCLE");
    expect(validateTeamPlacement(graph, { id: "eng", workspaceId: ws, parentId: "eng", visibility: "public" })).toBe("CYCLE");
    expect(validateTeamPlacement(graph, { workspaceId: ws, parentId: "nope", visibility: "public" })).toBe("PARENT_NOT_FOUND");
    const foreign = new Map(graph).set("x", { ...eng, id: "x", workspaceId: "ws_b" });
    expect(validateTeamPlacement(foreign, { workspaceId: ws, parentId: "x", visibility: "public" })).toBe("PARENT_NOT_FOUND");
  });

  it("caps trees at five levels, counting the moved subtree", () => {
    const chain = graphOf(t("l1", "public"), t("l2", "public", "l1"), t("l3", "public", "l2"), t("l4", "public", "l3"), t("l5", "public", "l4"));
    expect(validateTeamPlacement(chain, { workspaceId: ws, parentId: "l4", visibility: "public" })).toBeNull();
    expect(validateTeamPlacement(chain, { workspaceId: ws, parentId: "l5", visibility: "public" })).toBe("TOO_DEEP");
    const withSubtree = new Map(chain).set("a", t("a", "public")).set("b", t("b", "public", "a"));
    expect(validateTeamPlacement(withSubtree, { id: "a", workspaceId: ws, parentId: "l3", visibility: "public" })).toBeNull();
    expect(validateTeamPlacement(withSubtree, { id: "a", workspaceId: ws, parentId: "l4", visibility: "public" })).toBe("TOO_DEEP");
  });

  it("lists descendants nearest first", () => {
    expect(descendants(graph, "eng").map((team) => team.id)).toEqual(["eng_web", "eng_web_ui"]);
  });
});
