import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addTeam, addUser, addWorkspace, errorCode, newConvex, type Person, type TestConvex, type Workspace } from "./lib/test.fixtures";
import { serializeFilter } from "../src/lib/filters";

const page = { numItems: 100, cursor: null };
const filter = serializeFilter({ op: "and", conditions: [{ field: "priority", op: "in", values: [1] }] });
const display = JSON.stringify({ layout: "board" });

let t: TestConvex;
let ada: Person;
let bo: Person;
let gus: Person;
let ws: Workspace;
let eng: Id<"teams">;
let sec: Id<"teams">;

beforeEach(async () => {
  vi.useFakeTimers();
  t = newConvex();
  ada = await addUser(t, "ada");
  bo = await addUser(t, "bo");
  gus = await addUser(t, "gus");
  ws = await addWorkspace(t, "acme", [[ada, "admin"], [bo, "member"], [gus, "guest"]]);
  eng = await addTeam(t, ws, "ENG", "public", [[ada, "owner"], [bo], [gus]]);
  sec = await addTeam(t, ws, "SEC", "private", [[ada, "owner"]]);
});
afterEach(() => vi.useRealTimers());

describe("My issues (D-31)", () => {
  it("derives each tab from assignments, authorship, subscriptions, and history", async () => {
    const a = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "Assigned to Bo", assigneeId: bo.userId });
    await ws.as(bo).mutation(api.issues.create, { teamId: eng, title: "Bo wrote this" });
    const c = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "Bo follows" });
    await ws.as(bo).mutation(api.issues.setSubscribed, { issueId: c.issueId, subscribed: true });
    await ws.as(bo).mutation(api.issues.update, { issueId: a.issueId, priority: 2 });
    const tab = async (name: "assigned" | "created" | "subscribed" | "activity") =>
      (await ws.as(bo).query(api.views.myIssues, { tab: name, paginationOpts: page })).page.map((i) => i.title).sort();
    expect(await tab("assigned")).toEqual(["Assigned to Bo"]);
    expect(await tab("created")).toEqual(["Bo wrote this"]);
    expect(await tab("subscribed")).toEqual(["Assigned to Bo", "Bo follows", "Bo wrote this"]);
    expect(await tab("activity")).toEqual(["Assigned to Bo", "Bo wrote this"]);
  });

  it("drops issues the viewer can no longer read", async () => {
    await ws.as(ada).mutation(api.issues.create, { teamId: sec, title: "secret" });
    await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "open" });
    expect((await ws.as(bo).query(api.views.workspaceIssues, { paginationOpts: page })).page.map((i) => i.title)).toEqual(["open"]);
    expect((await ws.as(ada).query(api.views.workspaceIssues, { paginationOpts: page })).page.map((i) => i.title)).toEqual(["open", "secret"]);
  });
});

describe("saved views", () => {
  it("shows personal views to their owner and shared ones to readers", async () => {
    await ws.as(bo).mutation(api.views.create, { name: "Mine", teamId: eng, scope: "personal", filter, display });
    await ws.as(bo).mutation(api.views.create, { name: "Team urgent", teamId: eng, scope: "shared", filter, display });
    await ws.as(ada).mutation(api.views.create, { name: "Secret queue", teamId: sec, scope: "shared", filter, display });
    await ws.as(ada).mutation(api.views.create, { name: "Workspace", teamId: null, scope: "shared", filter, display });
    const names = async (p: Person) => (await ws.as(p).query(api.views.list, {})).map((v) => v.name);
    expect(await names(bo)).toEqual(["Mine", "Team urgent", "Workspace"]);
    expect(await names(ada)).toEqual(["Secret queue", "Team urgent", "Workspace"]);
    expect(await names(gus)).toEqual(["Team urgent"]);
  });

  it("lets owners, team managers, and admins edit shared views", async () => {
    const id = await ws.as(bo).mutation(api.views.create, { name: "Team urgent", teamId: eng, scope: "shared", filter, display });
    await ws.as(ada).mutation(api.views.update, { viewId: id, name: "Renamed" });
    expect(await errorCode(ws.as(gus).mutation(api.views.update, { viewId: id, name: "x" }))).toBe("FORBIDDEN");
    expect(await errorCode(ws.as(ada).mutation(api.views.update, { viewId: id, scope: "personal" }))).toBe("FORBIDDEN");
    const stored = await ws.as(bo).query(api.views.get, { viewId: id });
    expect(stored).toMatchObject({ name: "Renamed", display: expect.stringContaining('"layout":"board"') });
  });

  it("validates filters and limits guests to personal team views", async () => {
    expect(await errorCode(ws.as(bo).mutation(api.views.create, { name: "Bad", teamId: eng, scope: "personal", filter: "{}", display }))).toBe("INVALID");
    expect(await errorCode(ws.as(bo).mutation(api.views.create, { name: "Bad", teamId: eng, scope: "personal", filter, display: "[]" }))).toBe("INVALID");
    expect(await errorCode(ws.as(gus).mutation(api.views.create, { name: "x", teamId: null, scope: "personal", filter, display }))).toBe("FORBIDDEN");
    expect(await errorCode(ws.as(gus).mutation(api.views.create, { name: "x", teamId: eng, scope: "shared", filter, display }))).toBe("FORBIDDEN");
    await ws.as(gus).mutation(api.views.create, { name: "x", teamId: eng, scope: "personal", filter, display });
    expect(await errorCode(ws.as(bo).mutation(api.views.create, { name: "x", teamId: sec, scope: "personal", filter, display }))).toBe("NOT_FOUND");
  });

  it("keeps other workspaces' views out", async () => {
    const other = await addUser(t, "other");
    const ows = await addWorkspace(t, "globex", [[other, "owner"]]);
    const id = await ows.as(other).mutation(api.views.create, { name: "Globex", teamId: null, scope: "shared", filter, display });
    expect(await ws.as(ada).query(api.views.get, { viewId: id })).toBeNull();
    expect(await errorCode(ws.as(ada).mutation(api.views.remove, { viewId: id }))).toBe("NOT_FOUND");
  });
});
