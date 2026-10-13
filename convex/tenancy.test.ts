import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  addTeam,
  addUser,
  addWorkspace,
  errorCode,
  identity,
  newConvex,
  type Person,
  type TestConvex,
  type Workspace,
} from "./lib/test.fixtures";

/*
 * Cross-tenant isolation (D-15, D-20). Two workspaces, each with its own owner
 * and teams. Nothing from one may be read or changed from the other, whatever
 * ids the caller passes. These run in CI forever.
 */

const page = { numItems: 50, cursor: null };

let t: TestConvex;
let alice: Person;
let bob: Person;
let a: Workspace;
let b: Workspace;
let aTeam: Id<"teams">;
let bTeam: Id<"teams">;
let bState: Id<"workflowStates">;
let bIssue: Id<"issues">;

beforeEach(async () => {
  vi.useFakeTimers();
  t = newConvex();
  alice = await addUser(t, "alice");
  bob = await addUser(t, "bob");
  a = await addWorkspace(t, "acme", [[alice, "owner"]]);
  b = await addWorkspace(t, "globex", [[bob, "owner"]]);
  aTeam = await addTeam(t, a, "ENG", "public", [[alice, "owner"]]);
  bTeam = await addTeam(t, b, "OPS", "public", [[bob, "owner"]]);
  bState = (await b.as(bob).query(api.workflowStates.list, { teamId: bTeam })).states[0]!.id;
  bIssue = (await b.as(bob).mutation(api.issues.create, { teamId: bTeam, title: "Globex secret" })).issueId;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cross-tenant isolation", () => {
  it("lists only the caller's workspace", async () => {
    const teams = await a.as(alice).query(api.teams.list, {});
    expect(teams.map((team) => team.key)).toEqual(["ENG"]);
    const members = await a.as(alice).query(api.members.list, {});
    expect(members.map((m) => m.user.email)).toEqual([alice.email]);
    const mine = await t.withIdentity(identity(alice)).query(api.workspaces.mine, {});
    expect(mine.workspaces.map((w) => w.urlKey)).toEqual(["acme"]);
  });

  it("rejects a session scoped to a workspace the caller doesn't belong to", async () => {
    const forged = t.withIdentity(identity(alice, b.organizationId));
    expect(await errorCode(forged.query(api.teams.list, {}))).toBe("NO_WORKSPACE");
    expect(await errorCode(forged.query(api.workspaces.current, {}))).toBe("NO_WORKSPACE");
    expect(await errorCode(forged.mutation(api.issues.create, { teamId: bTeam, title: "x" }))).toBe("NO_WORKSPACE");
  });

  it("treats the other workspace's team ids as missing", async () => {
    const asAlice = a.as(alice);
    expect(await errorCode(asAlice.query(api.issues.listForTeam, { teamId: bTeam, paginationOpts: page }))).toBe("NOT_FOUND");
    expect(await errorCode(asAlice.query(api.workflowStates.list, { teamId: bTeam }))).toBe("NOT_FOUND");
    expect(await asAlice.query(api.teams.byKey, { key: "OPS" })).toBeNull();
    for (const call of [
      asAlice.mutation(api.issues.create, { teamId: bTeam, title: "x" }),
      asAlice.mutation(api.teams.update, { teamId: bTeam, name: "pwned" }),
      asAlice.mutation(api.teams.addMember, { teamId: bTeam, userId: alice.userId }),
      asAlice.mutation(api.teams.removeMember, { teamId: bTeam, userId: bob.userId }),
      asAlice.mutation(api.teams.setMemberRole, { teamId: bTeam, userId: bob.userId, role: "member" }),
      asAlice.mutation(api.teams.reparent, { teamId: bTeam, parentId: null }),
      asAlice.mutation(api.teams.remove, { teamId: bTeam }),
      asAlice.mutation(api.teams.create, { name: "Sub", key: "SUB", visibility: "public", parentId: bTeam }),
      asAlice.mutation(api.workflowStates.create, { teamId: bTeam, name: "x", category: "started", color: "#ebaa69" }),
    ]) {
      expect(await errorCode(call)).toBe("NOT_FOUND");
    }
  });

  it("treats the other workspace's states, issues, and members as missing", async () => {
    const asAlice = a.as(alice);
    expect(await errorCode(asAlice.mutation(api.workflowStates.update, { stateId: bState, name: "x" }))).toBe("NOT_FOUND");
    expect(await errorCode(asAlice.mutation(api.workflowStates.setDefault, { stateId: bState }))).toBe("NOT_FOUND");
    expect(await errorCode(asAlice.mutation(api.workflowStates.remove, { stateId: bState }))).toBe("NOT_FOUND");
    expect(await errorCode(asAlice.mutation(api.issues.setPriority, { issueId: bIssue, priority: 1 }))).toBe("NOT_FOUND");
    // A user from another workspace can't be added to a team here.
    expect(await errorCode(asAlice.mutation(api.teams.addMember, { teamId: aTeam, userId: bob.userId }))).toBe("NOT_FOUND");
    const bobMembership = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", b.workspaceId).eq("userId", bob.userId))
        .unique(),
    );
    for (const call of [
      asAlice.mutation(internal.members.applyRoleChange, { membershipId: bobMembership!._id, role: "member" }),
      asAlice.mutation(internal.members.applyRemoval, { membershipId: bobMembership!._id }),
      asAlice.mutation(internal.members.applySuspension, { membershipId: bobMembership!._id, suspended: true }),
    ]) {
      expect(await errorCode(call)).toBe("NOT_FOUND");
    }
  });

  it("leaves the other workspace untouched", async () => {
    const issues = await b.as(bob).query(api.issues.listForTeam, { teamId: bTeam, paginationOpts: page });
    expect(issues.page.map((issue) => issue.title)).toEqual(["Globex secret"]);
    const team = await b.as(bob).query(api.teams.byKey, { key: "OPS" });
    expect(team?.name).toBe("OPS");
  });
});

describe("authentication and membership", () => {
  it("requires sign-in", async () => {
    expect(await errorCode(t.query(api.teams.list, {}))).toBe("UNAUTHENTICATED");
    expect(await errorCode(t.query(api.workspaces.mine, {}))).toBe("UNAUTHENTICATED");
  });

  it("requires a workspace-scoped session for workspace data", async () => {
    expect(await errorCode(t.withIdentity(identity(alice)).query(api.teams.list, {}))).toBe("NO_WORKSPACE");
  });

  it("locks out suspended members", async () => {
    const carol = await addUser(t, "carol");
    const c = await addWorkspace(t, "initech", [[alice, "owner"], [carol, "member", "suspended"]]);
    expect(await errorCode(c.as(carol).query(api.teams.list, {}))).toBe("FORBIDDEN");
  });
});
