import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addTeam, addUser, addWorkspace, errorCode, newConvex, type Person, type TestConvex, type Workspace } from "./lib/test.fixtures";

/*
 * Member administration and the last-owner rule (D-16). WorkOS is mocked: the
 * tests check that the mirror and WorkOS change together, that a WorkOS
 * failure undoes the mirror change, and that audit events follow success only.
 */

const workosMock = vi.hoisted(() => ({
  updateOrganizationMembership: vi.fn(),
  deactivateOrganizationMembership: vi.fn(),
  reactivateOrganizationMembership: vi.fn(),
  deleteOrganizationMembership: vi.fn(),
}));

vi.mock("./lib/workos", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/workos")>();
  return { ...original, workos: () => ({ userManagement: workosMock }) };
});

let t: TestConvex;
let owner: Person;
let admin: Person;
let member: Person;
let ws: Workspace;

async function membershipOf(person: Person): Promise<Id<"memberships">> {
  const row = await t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", ws.workspaceId).eq("userId", person.userId))
      .unique(),
  );
  return row!._id;
}

async function auditActions() {
  return (await t.run((ctx) => ctx.db.query("auditEvents").collect())).map((event) => event.action);
}

beforeEach(async () => {
  vi.useFakeTimers();
  for (const fn of Object.values(workosMock)) fn.mockReset().mockResolvedValue({});
  t = newConvex();
  owner = await addUser(t, "owner");
  admin = await addUser(t, "admin");
  member = await addUser(t, "member");
  ws = await addWorkspace(t, "acme", [[owner, "owner"], [admin, "admin"], [member, "member"]]);
});

afterEach(() => vi.useRealTimers());

describe("last-owner protection (D-16)", () => {
  it("blocks demoting, removing, or the sole owner leaving", async () => {
    const id = await membershipOf(owner);
    expect(await errorCode(ws.as(owner).action(api.members.changeRole, { membershipId: id, role: "admin" }))).toBe("LAST_OWNER");
    expect(await errorCode(ws.as(owner).action(api.members.remove, { membershipId: id }))).toBe("LAST_OWNER");
    expect(workosMock.updateOrganizationMembership).not.toHaveBeenCalled();
    expect(workosMock.deleteOrganizationMembership).not.toHaveBeenCalled();
    const members = await ws.as(owner).query(api.members.list, {});
    expect(members.find((m) => m.isViewer)?.can).toMatchObject({ changeRoleTo: [], remove: false, suspend: false });
  });

  it("allows it once there is another active owner, then protects the remaining one", async () => {
    await ws.as(owner).action(api.members.changeRole, { membershipId: await membershipOf(admin), role: "owner" });
    await ws.as(admin).action(api.members.changeRole, { membershipId: await membershipOf(owner), role: "member" });
    expect(await errorCode(ws.as(admin).action(api.members.remove, { membershipId: await membershipOf(admin) }))).toBe("LAST_OWNER");
  });

  it("doesn't count suspended owners", async () => {
    await ws.as(owner).action(api.members.changeRole, { membershipId: await membershipOf(admin), role: "owner" });
    await ws.as(owner).action(api.members.setSuspended, { membershipId: await membershipOf(admin), suspended: true });
    expect(await errorCode(ws.as(owner).action(api.members.changeRole, { membershipId: await membershipOf(owner), role: "admin" }))).toBe("LAST_OWNER");
  });
});

describe("role changes", () => {
  it("updates the mirror and WorkOS, then records the audit event", async () => {
    await ws.as(owner).action(api.members.changeRole, { membershipId: await membershipOf(member), role: "admin" });
    expect(workosMock.updateOrganizationMembership).toHaveBeenCalledWith(`om_acme_${member.sub}`, { roleSlug: "admin" });
    const members = await ws.as(owner).query(api.members.list, {});
    expect(members.find((m) => m.user.email === member.email)?.role).toBe("admin");
    expect(await auditActions()).toEqual(["member.role_changed"]);
  });

  it("undoes the mirror change and records nothing when WorkOS fails", async () => {
    workosMock.updateOrganizationMembership.mockRejectedValueOnce(new Error("role not found"));
    expect(await errorCode(ws.as(owner).action(api.members.changeRole, { membershipId: await membershipOf(member), role: "admin" }))).toBe("UPSTREAM");
    const members = await ws.as(owner).query(api.members.list, {});
    expect(members.find((m) => m.user.email === member.email)?.role).toBe("member");
    expect(await auditActions()).toEqual([]);
  });

  it("enforces who may change whom", async () => {
    expect(await errorCode(ws.as(admin).action(api.members.changeRole, { membershipId: await membershipOf(owner), role: "admin" }))).toBe("FORBIDDEN");
    expect(await errorCode(ws.as(admin).action(api.members.changeRole, { membershipId: await membershipOf(member), role: "owner" }))).toBe("FORBIDDEN");
    expect(await errorCode(ws.as(member).action(api.members.changeRole, { membershipId: await membershipOf(admin), role: "member" }))).toBe("FORBIDDEN");
    await ws.as(admin).action(api.members.changeRole, { membershipId: await membershipOf(member), role: "guest" });
  });

  it("won't make someone a guest while they're in a restricted team", async () => {
    const sec = await addTeam(t, ws, "SEC", "private", [[member]]);
    await addTeam(t, ws, "OPS", "restricted", [[member]], sec);
    expect(await errorCode(ws.as(owner).action(api.members.changeRole, { membershipId: await membershipOf(member), role: "guest" }))).toBe("INVALID");
  });
});

describe("removal and suspension", () => {
  it("removes the member and their team memberships", async () => {
    const eng = await addTeam(t, ws, "ENG", "public", [[member]]);
    await ws.as(admin).action(api.members.remove, { membershipId: await membershipOf(member) });
    expect(workosMock.deleteOrganizationMembership).toHaveBeenCalledWith(`om_acme_${member.sub}`);
    const rows = await t.run((ctx) => ctx.db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", eng)).collect());
    expect(rows).toEqual([]);
    expect(await errorCode(ws.as(member).query(api.teams.list, {}))).toBe("NO_WORKSPACE");
    expect(await auditActions()).toEqual(["member.removed"]);
  });

  it("restores the member and their teams when WorkOS fails", async () => {
    const eng = await addTeam(t, ws, "ENG", "public", [[member, "owner"]]);
    workosMock.deleteOrganizationMembership.mockRejectedValueOnce(new Error("boom"));
    expect(await errorCode(ws.as(admin).action(api.members.remove, { membershipId: await membershipOf(member) }))).toBe("UPSTREAM");
    const teams = await ws.as(member).query(api.teams.list, {});
    expect(teams.find((team) => team.id === eng)?.teamRole).toBe("owner");
    expect(await auditActions()).toEqual([]);
  });

  it("lets members leave, recording the event after they're gone", async () => {
    await ws.as(member).action(api.members.remove, { membershipId: await membershipOf(member) });
    expect(await auditActions()).toEqual(["member.removed"]);
  });

  it("suspends and reactivates, never yourself", async () => {
    const id = await membershipOf(member);
    expect(await errorCode(ws.as(member).action(api.members.setSuspended, { membershipId: id, suspended: true }))).toBe("FORBIDDEN");
    await ws.as(admin).action(api.members.setSuspended, { membershipId: id, suspended: true });
    expect(workosMock.deactivateOrganizationMembership).toHaveBeenCalledWith(`om_acme_${member.sub}`);
    expect(await errorCode(ws.as(member).query(api.teams.list, {}))).toBe("FORBIDDEN");
    await ws.as(admin).action(api.members.setSuspended, { membershipId: id, suspended: false });
    expect(workosMock.reactivateOrganizationMembership).toHaveBeenCalled();
    expect(await ws.as(member).query(api.teams.list, {})).toEqual([]);
    expect(await auditActions()).toEqual(["member.suspended", "member.reactivated"]);
  });

  it("refuses an admin removing an owner", async () => {
    expect(await errorCode(ws.as(admin).action(api.members.remove, { membershipId: await membershipOf(owner) }))).toBe("FORBIDDEN");
    expect(await errorCode(ws.as(member).mutation(internal.members.applyRemoval, { membershipId: await membershipOf(admin) }))).toBe("FORBIDDEN");
  });
});
