import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addTeam, addUser, addWorkspace, errorCode, newConvex, type Person, type TestConvex, type Workspace } from "./lib/test.fixtures";

const page = { numItems: 50, cursor: null };

let t: TestConvex;
let owner: Person;
let admin: Person;
let member: Person;
let guest: Person;
let ws: Workspace;

beforeEach(async () => {
  vi.useFakeTimers();
  t = newConvex();
  owner = await addUser(t, "owner");
  admin = await addUser(t, "admin");
  member = await addUser(t, "member");
  guest = await addUser(t, "guest");
  ws = await addWorkspace(t, "acme", [[owner, "owner"], [admin, "admin"], [member, "member"], [guest, "guest"]]);
});

afterEach(() => vi.useRealTimers());

describe("private team content (Phase 1 acceptance)", () => {
  let sec: Id<"teams">;
  beforeEach(async () => {
    sec = await addTeam(t, ws, "SEC", "private", [[member, "owner"]]);
    await ws.as(member).mutation(api.issues.create, { teamId: sec, title: "Incident 42" });
  });

  it("is invisible to owners and admins who are not members", async () => {
    for (const person of [owner, admin]) {
      const teams = await ws.as(person).query(api.teams.list, {});
      const listed = teams.find((team) => team.key === "SEC");
      // They see the name and key so they can join (D-17) ...
      expect(listed?.can).toMatchObject({ read: false, write: false, join: true });
      // ... but no content.
      expect(await errorCode(ws.as(person).query(api.issues.listForTeam, { teamId: sec, paginationOpts: page }))).toBe("FORBIDDEN");
      expect(await errorCode(ws.as(person).mutation(api.issues.create, { teamId: sec, title: "x" }))).toBe("FORBIDDEN");
    }
  });

  it("is hidden entirely from members and guests outside it", async () => {
    for (const person of [guest, await addOutsider()]) {
      const teams = await ws.as(person).query(api.teams.list, {});
      expect(teams.some((team) => team.key === "SEC")).toBe(false);
      expect(await errorCode(ws.as(person).query(api.issues.listForTeam, { teamId: sec, paginationOpts: page }))).toBe("NOT_FOUND");
    }
  });

  it("opens to an admin after joining, and closes again after leaving", async () => {
    await ws.as(admin).mutation(api.teams.addMember, { teamId: sec, userId: admin.userId });
    const issues = await ws.as(admin).query(api.issues.listForTeam, { teamId: sec, paginationOpts: page });
    expect(issues.page.map((issue) => issue.title)).toEqual(["Incident 42"]);
    await ws.as(admin).mutation(api.teams.removeMember, { teamId: sec, userId: admin.userId });
    expect(await errorCode(ws.as(admin).query(api.issues.listForTeam, { teamId: sec, paginationOpts: page }))).toBe("FORBIDDEN");
  });

  async function addOutsider() {
    const other = await addUser(t, "other_member");
    await t.run((ctx) =>
      ctx.db.insert("memberships", {
        workspaceId: ws.workspaceId,
        userId: other.userId,
        workosMembershipId: "om_other",
        role: "member",
        status: "active",
        updatedAt: 0,
      }),
    );
    return other;
  }
});

describe("team creation", () => {
  it("creates default workflow states and makes the creator the owner", async () => {
    const { teamId } = await ws.as(member).mutation(api.teams.create, { name: "Design", key: "des", visibility: "public" });
    const states = await ws.as(member).query(api.workflowStates.list, { teamId });
    expect(states.states.map((s) => s.name)).toEqual(["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled", "Duplicate"]);
    expect(states.states.find((s) => s.id === states.defaultStateId)?.name).toBe("Todo");
    const team = await ws.as(member).query(api.teams.byKey, { key: "DES" });
    expect(team?.members.map((m) => [m.user.email, m.role])).toEqual([[member.email, "owner"]]);
    const audit = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    expect(audit.map((e) => e.action)).toContain("team.created");
  });

  it("refuses guests, duplicate keys, and invalid input", async () => {
    expect(await errorCode(ws.as(guest).mutation(api.teams.create, { name: "G", key: "G", visibility: "public" }))).toBe("FORBIDDEN");
    await ws.as(member).mutation(api.teams.create, { name: "Design", key: "DES", visibility: "public" });
    expect(await errorCode(ws.as(member).mutation(api.teams.create, { name: "Other", key: "des", visibility: "public" }))).toBe("CONFLICT");
    expect(await errorCode(ws.as(member).mutation(api.teams.create, { name: "Bad", key: "1X", visibility: "public" }))).toBe("INVALID");
    expect(await errorCode(ws.as(member).mutation(api.teams.create, { name: "R", key: "R", visibility: "restricted" }))).toBe("INVALID");
  });

  it("lets only managers of the parent create sub-teams, under hierarchy rules", async () => {
    const sec = await addTeam(t, ws, "SEC", "private", [[member, "member"]]);
    const eng = await addTeam(t, ws, "ENG", "public");
    // A member of SEC manages its children (D-17).
    const { teamId: ops } = await ws.as(member).mutation(api.teams.create, { name: "Ops", key: "OPS", visibility: "restricted", parentId: sec });
    expect((await ws.as(member).query(api.teams.byKey, { key: "OPS" }))?.parentId).toBe(sec);
    expect(await errorCode(ws.as(member).mutation(api.teams.create, { name: "Web", key: "WEB", visibility: "public", parentId: eng }))).toBe("FORBIDDEN");
    expect(await errorCode(ws.as(admin).mutation(api.teams.create, { name: "X", key: "X", visibility: "restricted", parentId: eng }))).toBe("INVALID");
    // An admin creating a sub-team of a team they're not in manages it without joining.
    await ws.as(admin).mutation(api.teams.create, { name: "Web", key: "WEB", visibility: "public", parentId: eng });
    expect((await ws.as(admin).query(api.teams.byKey, { key: "WEB" }))?.members).toEqual([]);
    expect(ops).toBeDefined();
  });
});

describe("team membership rules", () => {
  it("requires parent membership for non-guests and keeps guests out of restricted teams", async () => {
    const sec = await addTeam(t, ws, "SEC", "private", [[owner, "owner"]]);
    const ops = await addTeam(t, ws, "OPS", "restricted", [], sec);
    expect(await errorCode(ws.as(owner).mutation(api.teams.addMember, { teamId: ops, userId: member.userId }))).toBe("INVALID");
    expect(await errorCode(ws.as(owner).mutation(api.teams.addMember, { teamId: ops, userId: guest.userId }))).toBe("INVALID");
    await ws.as(owner).mutation(api.teams.addMember, { teamId: sec, userId: member.userId });
    await ws.as(owner).mutation(api.teams.addMember, { teamId: ops, userId: member.userId });
    // Removing someone from the parent removes them from its sub-teams.
    await ws.as(owner).mutation(api.teams.removeMember, { teamId: sec, userId: member.userId });
    const opsTeam = await ws.as(owner).query(api.teams.byKey, { key: "OPS" });
    expect(opsTeam?.members).toEqual([]);
  });

  it("lets members join public teams and leave, but not add others", async () => {
    const eng = await addTeam(t, ws, "ENG", "public", [[owner, "owner"]]);
    expect(await errorCode(ws.as(member).mutation(api.teams.addMember, { teamId: eng, userId: guest.userId }))).toBe("FORBIDDEN");
    await ws.as(member).mutation(api.teams.addMember, { teamId: eng, userId: member.userId });
    expect(await errorCode(ws.as(member).mutation(api.teams.addMember, { teamId: eng, userId: member.userId, role: "owner" }))).toBe("FORBIDDEN");
    await ws.as(member).mutation(api.teams.removeMember, { teamId: eng, userId: member.userId });
    expect(await errorCode(ws.as(guest).mutation(api.teams.addMember, { teamId: eng, userId: guest.userId }))).toBe("NOT_FOUND");
  });

  it("gives guests access only through explicit membership (D-18)", async () => {
    const eng = await addTeam(t, ws, "ENG", "public", [[owner, "owner"]]);
    expect(await ws.as(guest).query(api.teams.list, {})).toEqual([]);
    await ws.as(owner).mutation(api.teams.addMember, { teamId: eng, userId: guest.userId });
    const teams = await ws.as(guest).query(api.teams.list, {});
    expect(teams.map((team) => [team.key, team.can.write])).toEqual([["ENG", true]]);
    const members = await ws.as(guest).query(api.members.list, {});
    expect(members.map((m) => m.user.email)).toEqual([guest.email]);
  });
});

describe("team settings", () => {
  it("reserves reparenting and deletion for admins", async () => {
    const eng = await addTeam(t, ws, "ENG", "public", [[member, "owner"], [owner, "member"]]);
    const web = await addTeam(t, ws, "WEB", "public", [[member, "owner"]]);
    expect(await errorCode(ws.as(member).mutation(api.teams.reparent, { teamId: web, parentId: eng }))).toBe("FORBIDDEN");
    expect(await errorCode(ws.as(member).mutation(api.teams.remove, { teamId: web }))).toBe("FORBIDDEN");
    await ws.as(admin).mutation(api.teams.reparent, { teamId: web, parentId: eng });
    expect(await errorCode(ws.as(admin).mutation(api.teams.remove, { teamId: eng }))).toBe("INVALID");
    await ws.as(admin).mutation(api.teams.reparent, { teamId: web, parentId: null });
    await ws.as(admin).mutation(api.teams.remove, { teamId: web });
    expect(await ws.as(admin).query(api.teams.byKey, { key: "WEB" })).toBeNull();
  });

  it("refuses a reparent that would leave members outside the new parent", async () => {
    const eng = await addTeam(t, ws, "ENG", "public", [[owner, "owner"]]);
    const web = await addTeam(t, ws, "WEB", "public", [[member, "owner"]]);
    expect(await errorCode(ws.as(owner).mutation(api.teams.reparent, { teamId: web, parentId: eng }))).toBe("INVALID");
  });

  it("freezes the identifier once issues exist (D-24)", async () => {
    const eng = await addTeam(t, ws, "ENG", "public", [[member, "owner"]]);
    await ws.as(member).mutation(api.teams.update, { teamId: eng, key: "CORE" });
    await ws.as(member).mutation(api.issues.create, { teamId: eng, title: "First" });
    expect(await errorCode(ws.as(member).mutation(api.teams.update, { teamId: eng, key: "ENG" }))).toBe("INVALID");
    const issues = await ws.as(member).query(api.issues.listForTeam, { teamId: eng, paginationOpts: page });
    expect(issues.page.map((issue) => issue.identifier)).toEqual(["CORE-1"]);
  });

  it("validates visibility changes against the hierarchy and guests", async () => {
    const sec = await addTeam(t, ws, "SEC", "private", [[owner, "owner"]]);
    const ops = await addTeam(t, ws, "OPS", "private", [[owner, "owner"], [guest, "member"]], sec);
    expect(await errorCode(ws.as(owner).mutation(api.teams.update, { teamId: ops, visibility: "restricted" }))).toBe("INVALID");
    await ws.as(owner).mutation(api.teams.removeMember, { teamId: ops, userId: guest.userId });
    await ws.as(owner).mutation(api.teams.update, { teamId: ops, visibility: "restricted" });
    expect(await errorCode(ws.as(owner).mutation(api.teams.update, { teamId: sec, visibility: "public" }))).toBe("INVALID");
    const audit = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    expect(audit.find((e) => e.action === "team.visibility_changed")?.metadata).toEqual({ from: "private", to: "restricted" });
  });
});
