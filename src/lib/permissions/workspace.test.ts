import { describe, expect, it } from "vitest";
import {
  canChangeMemberRole,
  canCreateTeam,
  canInvite,
  canManageWorkspace,
  canRemoveMember,
  canSuspendMember,
  canViewMemberDirectory,
  canViewWorkspaceSurfaces,
  workspaceRoles,
  wouldRemoveLastOwner,
  type Actor,
  type WorkspaceRole,
} from "./index";

const ws = "ws_a";
const actor = (role: WorkspaceRole, userId = `u_${role}`): Actor => ({
  workspaceId: ws,
  userId,
  role,
  teams: new Map(),
});
const target = (role: WorkspaceRole, userId = `t_${role}`) => ({ workspaceId: ws, userId, role });
const outsider: Actor = { workspaceId: "ws_b", userId: "u_x", role: "owner", teams: new Map() };

describe("workspace administration", () => {
  it("lets owners and admins manage the workspace", () => {
    expect(workspaceRoles.filter((r) => canManageWorkspace(actor(r), ws))).toEqual(["owner", "admin"]);
    expect(canManageWorkspace(outsider, ws)).toBe(false);
    expect(canManageWorkspace(null, ws)).toBe(false);
  });

  it("hides the member directory and workspace surfaces from guests (D-18)", () => {
    for (const check of [canViewMemberDirectory, canViewWorkspaceSurfaces, canCreateTeam]) {
      expect(workspaceRoles.filter((r) => check(actor(r), ws))).toEqual(["owner", "admin", "member"]);
      expect(check(outsider, ws)).toBe(false);
    }
  });

  it("lets owners invite any role and admins any role but owner", () => {
    const table = workspaceRoles.map((by) => [by, workspaceRoles.filter((r) => canInvite(actor(by), ws, r))]);
    expect(Object.fromEntries(table)).toEqual({
      owner: ["owner", "admin", "member", "guest"],
      admin: ["admin", "member", "guest"],
      member: [],
      guest: [],
    });
    expect(canInvite(outsider, ws, "member")).toBe(false);
  });

  it("reserves owner changes for owners", () => {
    expect(canChangeMemberRole(actor("owner"), target("owner"), "member")).toBe(true);
    expect(canChangeMemberRole(actor("owner"), target("member"), "owner")).toBe(true);
    expect(canChangeMemberRole(actor("admin"), target("member"), "admin")).toBe(true);
    expect(canChangeMemberRole(actor("admin"), target("admin"), "guest")).toBe(true);
    expect(canChangeMemberRole(actor("admin"), target("owner"), "admin")).toBe(false);
    expect(canChangeMemberRole(actor("admin"), target("member"), "owner")).toBe(false);
    expect(canChangeMemberRole(actor("member"), target("guest"), "member")).toBe(false);
    expect(canChangeMemberRole(actor("guest"), target("guest"), "member")).toBe(false);
    expect(canChangeMemberRole(outsider, target("member"), "admin")).toBe(false);
  });

  it("lets anyone leave, and only admins remove others", () => {
    for (const role of workspaceRoles) {
      expect(canRemoveMember(actor(role, "me"), target(role, "me"))).toBe(true);
    }
    expect(canRemoveMember(actor("owner"), target("owner"))).toBe(true);
    expect(canRemoveMember(actor("admin"), target("member"))).toBe(true);
    expect(canRemoveMember(actor("admin"), target("owner"))).toBe(false);
    expect(canRemoveMember(actor("member"), target("guest"))).toBe(false);
    expect(canRemoveMember(outsider, target("guest"))).toBe(false);
  });

  it("never lets people suspend themselves", () => {
    expect(canSuspendMember(actor("owner", "me"), target("owner", "me"))).toBe(false);
    expect(canSuspendMember(actor("owner"), target("admin"))).toBe(true);
    expect(canSuspendMember(actor("admin"), target("owner"))).toBe(false);
    expect(canSuspendMember(actor("member"), target("guest"))).toBe(false);
  });

  it("detects removal of the last owner (D-16)", () => {
    expect(wouldRemoveLastOwner(1, "owner", "admin")).toBe(true);
    expect(wouldRemoveLastOwner(1, "owner", null)).toBe(true);
    expect(wouldRemoveLastOwner(1, "owner", "owner")).toBe(false);
    expect(wouldRemoveLastOwner(2, "owner", null)).toBe(false);
    expect(wouldRemoveLastOwner(1, "admin", null)).toBe(false);
  });
});
