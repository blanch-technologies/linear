import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { addUser, addWorkspace, errorCode, identity, newConvex, type Person, type TestConvex } from "./lib/test.fixtures";

const workosMock = vi.hoisted(() => {
  const userManagement = {
    getUser: vi.fn(),
    createOrganizationMembership: vi.fn(),
    listOrganizationMemberships: vi.fn(),
    sendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
    resendInvitation: vi.fn(),
  };
  const organizations = { createOrganization: vi.fn(), deleteOrganization: vi.fn(), updateOrganization: vi.fn() };
  return { userManagement, organizations };
});

vi.mock("./lib/workos", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/workos")>();
  return { ...original, workos: () => workosMock };
});

let t: TestConvex;
let dana: Person;

beforeEach(async () => {
  vi.useFakeTimers();
  for (const group of Object.values(workosMock)) for (const fn of Object.values(group)) fn.mockReset();
  t = newConvex();
  dana = await addUser(t, "dana");
  workosMock.userManagement.getUser.mockResolvedValue({
    id: dana.sub,
    email: dana.email,
    firstName: "Dana",
    lastName: "Scully",
    profilePictureUrl: null,
  });
});

afterEach(() => vi.useRealTimers());

describe("workspace creation", () => {
  beforeEach(() => {
    workosMock.organizations.createOrganization.mockResolvedValue({ id: "org_new" });
    workosMock.userManagement.createOrganizationMembership.mockResolvedValue({ id: "om_new" });
  });

  it("creates the WorkOS organization, the owner membership, and a default team", async () => {
    const result = await t.withIdentity(identity(dana)).action(api.workspaces.create, { name: "Acme Labs", urlKey: "acme" });
    expect(result).toEqual({ urlKey: "acme", workosOrganizationId: "org_new" });
    expect(workosMock.userManagement.createOrganizationMembership).toHaveBeenCalledWith({
      organizationId: "org_new",
      userId: dana.sub,
      roleSlug: "owner",
    });
    const asDana = t.withIdentity(identity(dana, "org_new"));
    const current = await asDana.query(api.workspaces.current, {});
    expect(current.viewer).toMatchObject({ role: "owner", name: "Dana Scully" });
    const teams = await asDana.query(api.teams.list, {});
    expect(teams.map((team) => [team.name, team.key, team.teamRole])).toEqual([["Acme Labs", "AL", "owner"]]);
  });

  it("rejects taken or invalid URLs before calling WorkOS", async () => {
    await addWorkspace(t, "acme", [[dana, "owner"]]);
    expect(await errorCode(t.withIdentity(identity(dana)).action(api.workspaces.create, { name: "A", urlKey: "acme" }))).toBe("CONFLICT");
    expect(await errorCode(t.withIdentity(identity(dana)).action(api.workspaces.create, { name: "A", urlKey: "settings" }))).toBe("INVALID");
    expect(workosMock.organizations.createOrganization).not.toHaveBeenCalled();
  });

  it("deletes the WorkOS organization if the rest fails", async () => {
    workosMock.userManagement.createOrganizationMembership.mockRejectedValueOnce(new Error("role owner not found"));
    expect(await errorCode(t.withIdentity(identity(dana)).action(api.workspaces.create, { name: "Acme", urlKey: "acme" }))).toBe("UPSTREAM");
    expect(workosMock.organizations.deleteOrganization).toHaveBeenCalledWith("org_new");
    const mine = await t.withIdentity(identity(dana)).query(api.workspaces.mine, {});
    expect(mine.workspaces).toEqual([]);
  });

  it("lets admins rename, and reverts if WorkOS refuses", async () => {
    const ws = await addWorkspace(t, "acme", [[dana, "owner"]]);
    workosMock.organizations.updateOrganization.mockResolvedValueOnce({});
    await ws.as(dana).action(api.workspaces.update, { name: "Acme Inc", urlKey: "acme-inc" });
    expect((await ws.as(dana).query(api.workspaces.current, {})).workspace).toMatchObject({ name: "Acme Inc", urlKey: "acme-inc" });
    workosMock.organizations.updateOrganization.mockRejectedValueOnce(new Error("nope"));
    expect(await errorCode(ws.as(dana).action(api.workspaces.update, { name: "Other" }))).toBe("UPSTREAM");
    expect((await ws.as(dana).query(api.workspaces.current, {})).workspace.name).toBe("Acme Inc");
  });
});

describe("session sync", () => {
  const remote = (organizationId: string, role = "member", status = "active") => ({
    workosMembershipId: `om_${organizationId}`,
    workosOrganizationId: organizationId,
    role: role as "member",
    status: status as "active",
  });
  const profile = (person: Person) => ({ workosUserId: person.sub, email: person.email, name: "Dana Scully" });

  it("mirrors memberships for known workspaces only and marks invitations accepted", async () => {
    const owner = await addUser(t, "owner");
    const ws = await addWorkspace(t, "acme", [[owner, "owner"]]);
    await t.run((ctx) =>
      ctx.db.insert("invitations", {
        workspaceId: ws.workspaceId,
        workosInvitationId: "inv_1",
        email: dana.email,
        role: "member",
        state: "pending",
        invitedBy: owner.userId,
        expiresAt: Date.now() + 1000,
        acceptUrl: "https://example.invalid",
      }),
    );
    await t.withIdentity(identity(dana)).mutation(internal.session.apply, {
      profile: profile(dana),
      listedAt: Date.now(),
      memberships: [remote(ws.organizationId), remote("org_unknown")],
    });
    const mine = await t.withIdentity(identity(dana)).query(api.workspaces.mine, {});
    expect(mine.workspaces.map((w) => [w.urlKey, w.role])).toEqual([["acme", "member"]]);
    const invitation = await t.run((ctx) => ctx.db.query("invitations").first());
    expect(invitation?.state).toBe("accepted");
    const audit = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    expect(audit.map((e) => e.action)).toEqual(["member.joined"]);
  });

  it("applies role, status, and removal changes made in WorkOS", async () => {
    const ws = await addWorkspace(t, "acme", [[dana, "member"]]);
    const sync = (memberships: ReturnType<typeof remote>[]) =>
      t.withIdentity(identity(dana)).mutation(internal.session.apply, { profile: profile(dana), listedAt: Date.now(), memberships });
    await sync([{ ...remote(ws.organizationId, "admin"), workosMembershipId: `om_acme_${dana.sub}` }]);
    expect((await ws.as(dana).query(api.workspaces.current, {})).viewer.role).toBe("admin");
    await sync([{ ...remote(ws.organizationId, "admin", "suspended"), workosMembershipId: `om_acme_${dana.sub}` }]);
    expect(await errorCode(ws.as(dana).query(api.workspaces.current, {}))).toBe("FORBIDDEN");
    await sync([]);
    expect(await errorCode(ws.as(dana).query(api.workspaces.current, {}))).toBe("NO_WORKSPACE");
  });

  it("keeps changes made in the app after WorkOS was listed", async () => {
    const ws = await addWorkspace(t, "acme", [[dana, "member"]]);
    const listedAt = Date.now();
    await t.run(async (ctx) => {
      const row = await ctx.db.query("memberships").first();
      await ctx.db.patch(row!._id, { role: "admin", updatedAt: listedAt + 1 });
    });
    await t.withIdentity(identity(dana)).mutation(internal.session.apply, { profile: profile(dana), listedAt, memberships: [] });
    expect((await ws.as(dana).query(api.workspaces.current, {})).viewer.role).toBe("admin");
  });

  it("refuses a profile that doesn't match the session", async () => {
    const other = await addUser(t, "other");
    expect(
      await errorCode(t.withIdentity(identity(dana)).mutation(internal.session.apply, { profile: profile(other), listedAt: 0, memberships: [] })),
    ).toBe("FORBIDDEN");
  });
});

describe("invitations", () => {
  it("sends through WorkOS, lists for admins only, and blocks duplicates", async () => {
    const member = await addUser(t, "member");
    const ws = await addWorkspace(t, "acme", [[dana, "owner"], [member, "member"]]);
    workosMock.userManagement.sendInvitation.mockResolvedValue({
      id: "inv_1",
      expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
      acceptInvitationUrl: "https://auth.example/invite?token=x",
    });
    await ws.as(dana).action(api.invitations.send, { email: " New@Blanch.test ", role: "member" });
    expect(workosMock.userManagement.sendInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@blanch.test", organizationId: ws.organizationId, roleSlug: "member", inviterUserId: dana.sub }),
    );
    expect((await ws.as(dana).query(api.invitations.list, {})).map((i) => i.email)).toEqual(["new@blanch.test"]);
    expect(await ws.as(member).query(api.invitations.list, {})).toEqual([]);
    expect(await errorCode(ws.as(dana).action(api.invitations.send, { email: "new@blanch.test", role: "member" }))).toBe("CONFLICT");
    expect(await errorCode(ws.as(dana).action(api.invitations.send, { email: member.email, role: "member" }))).toBe("CONFLICT");
    expect(await errorCode(ws.as(member).action(api.invitations.send, { email: "x@blanch.test", role: "member" }))).toBe("FORBIDDEN");
    expect(await errorCode(ws.as(dana).action(api.invitations.send, { email: "not-an-email", role: "member" }))).toBe("INVALID");
    expect(workosMock.userManagement.sendInvitation).toHaveBeenCalledTimes(1);
  });

  it("revokes", async () => {
    const ws = await addWorkspace(t, "acme", [[dana, "owner"]]);
    workosMock.userManagement.sendInvitation.mockResolvedValue({ id: "inv_1", expiresAt: new Date(Date.now() + 864e5).toISOString(), acceptInvitationUrl: "u" });
    await ws.as(dana).action(api.invitations.send, { email: "a@blanch.test", role: "guest" });
    const [invitation] = await ws.as(dana).query(api.invitations.list, {});
    await ws.as(dana).action(api.invitations.revoke, { invitationId: invitation!.id });
    expect(workosMock.userManagement.revokeInvitation).toHaveBeenCalledWith("inv_1");
    expect(await ws.as(dana).query(api.invitations.list, {})).toEqual([]);
    const audit = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    expect(audit.map((e) => e.action)).toEqual(["invitation.sent", "invitation.revoked"]);
  });
});
