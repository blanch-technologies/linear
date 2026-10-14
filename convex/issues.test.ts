import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addTeam, addUser, addWorkspace, errorCode, newConvex, type Person, type TestConvex, type Workspace } from "./lib/test.fixtures";
import { fromPlainText } from "../src/lib/richtext";

let t: TestConvex;
let ada: Person;
let bo: Person;
let gus: Person;
let outsider: Person;
let ws: Workspace;
let eng: Id<"teams">;
let sec: Id<"teams">;

const states = async (teamId: Id<"teams">) => (await ws.as(ada).query(api.workflowStates.list, { teamId })).states;
const notificationsFor = (person: Person) =>
  t.run((ctx) => ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("workspaceId", ws.workspaceId).eq("userId", person.userId)).collect());
const mentionDoc = (person: Person, name: string) =>
  JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "cc " }, { type: "mention", attrs: { id: person.userId, label: name } }] }] });

beforeEach(async () => {
  vi.useFakeTimers();
  t = newConvex();
  ada = await addUser(t, "ada");
  bo = await addUser(t, "bo");
  gus = await addUser(t, "gus");
  outsider = await addUser(t, "outsider");
  ws = await addWorkspace(t, "acme", [[ada, "owner"], [bo, "member"], [gus, "guest"], [outsider, "member"]]);
  eng = await addTeam(t, ws, "ENG", "public", [[ada, "owner"], [bo]]);
  sec = await addTeam(t, ws, "SEC", "private", [[ada, "owner"]]);
});
afterEach(() => vi.useRealTimers());

describe("create and identifiers (D-24)", () => {
  it("numbers per team, starts in the default status, and subscribes the creator", async () => {
    const a = await ws.as(bo).mutation(api.issues.create, { teamId: eng, title: "  First   issue " });
    const b = await ws.as(bo).mutation(api.issues.create, { teamId: eng, title: "Second" });
    expect([a.identifier, b.identifier]).toEqual(["ENG-1", "ENG-2"]);
    const issue = await ws.as(bo).query(api.issues.get, { identifier: "eng-1" });
    expect(issue).toMatchObject({ deleted: false, title: "First issue", stateCategory: "unstarted", priority: 0, viewerSubscribed: true });
  });

  it("validates every field", async () => {
    const as = ws.as(ada);
    expect(await errorCode(as.mutation(api.issues.create, { teamId: eng, title: "  " }))).toBe("INVALID");
    expect(await errorCode(as.mutation(api.issues.create, { teamId: eng, title: "x", priority: 7 }))).toBe("INVALID");
    expect(await errorCode(as.mutation(api.issues.create, { teamId: eng, title: "x", dueDate: "2026-02-30" }))).toBe("INVALID");
    expect(await errorCode(as.mutation(api.issues.create, { teamId: eng, title: "x", estimate: 3 }))).toBe("INVALID");
    expect(await errorCode(as.mutation(api.issues.create, { teamId: eng, title: "x", description: "{not json" }))).toBe("INVALID");
    const secState = (await states(sec))[0]!.id;
    expect(await errorCode(as.mutation(api.issues.create, { teamId: eng, title: "x", stateId: secState }))).toBe("INVALID");
  });

  it("only assigns people who can read the team", async () => {
    expect(await errorCode(ws.as(ada).mutation(api.issues.create, { teamId: sec, title: "x", assigneeId: bo.userId }))).toBe("INVALID");
    expect(await errorCode(ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "x", assigneeId: gus.userId }))).toBe("INVALID");
    await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "x", assigneeId: bo.userId });
  });
});

describe("updates (D-21, D-22)", () => {
  it("bumps the version, records history, and rejects stale writes", async () => {
    const { issueId } = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "Fix" });
    const started = (await states(eng)).find((s) => s.category === "started")!;
    expect(await ws.as(ada).mutation(api.issues.update, { issueId, expectedVersion: 1, stateId: started.id, priority: 2 })).toEqual({ version: 2 });
    expect(await errorCode(ws.as(bo).mutation(api.issues.update, { issueId, expectedVersion: 1, priority: 1 }))).toBe("CONFLICT");
    const activity = await ws.as(ada).query(api.issues.activity, { issueId });
    expect(activity.map((a) => a.kind)).toEqual(["created", "updated"]);
    expect(activity[1]!.changes).toEqual(
      expect.arrayContaining([
        { field: "stateId", from: "Todo", to: "In Progress" },
        { field: "priority", from: 0, to: 2 },
      ]),
    );
    const issue = await t.run((ctx) => ctx.db.get(issueId));
    expect(issue).toMatchObject({ stateCategory: "started" });
    expect(issue!.startedAt).toBeGreaterThan(0);
  });

  it("ignores no-op updates", async () => {
    const { issueId } = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "Same" });
    expect(await ws.as(ada).mutation(api.issues.update, { issueId, title: "Same" })).toEqual({ version: 1 });
  });

  it("prevents parent cycles", async () => {
    const a = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "A" });
    const b = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "B", parentId: a.issueId });
    expect(await errorCode(ws.as(ada).mutation(api.issues.update, { issueId: a.issueId, parentId: b.issueId }))).toBe("INVALID");
    expect(await errorCode(ws.as(ada).mutation(api.issues.update, { issueId: a.issueId, parentId: a.issueId }))).toBe("INVALID");
    const parent = await ws.as(ada).query(api.issues.get, { identifier: "ENG-1" });
    expect(parent?.deleted === false && parent.children.map((c) => c.identifier)).toEqual(["ENG-2"]);
  });

  it("applies labels, one per group, and only the team's or workspace's", async () => {
    const as = ws.as(ada);
    const bug = await as.mutation(api.labels.create, { teamId: null, name: "Bug", color: "#df726f" });
    const size = await as.mutation(api.labels.create, { teamId: eng, name: "Size", color: "#83858e" });
    const small = await as.mutation(api.labels.create, { teamId: eng, name: "Small", color: "#83858e", parentId: size });
    const large = await as.mutation(api.labels.create, { teamId: eng, name: "Large", color: "#83858e", parentId: size });
    const secret = await as.mutation(api.labels.create, { teamId: sec, name: "Secret", color: "#83858e" });
    const { issueId } = await as.mutation(api.issues.create, { teamId: eng, title: "x", labelIds: [bug, small] });
    expect(await errorCode(as.mutation(api.issues.update, { issueId, labelIds: [small, large] }))).toBe("INVALID");
    expect(await errorCode(as.mutation(api.issues.update, { issueId, labelIds: [size] }))).toBe("INVALID");
    expect(await errorCode(as.mutation(api.issues.update, { issueId, labelIds: [secret] }))).toBe("INVALID");
    await as.mutation(api.labels.remove, { labelId: bug });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const issue = await t.run((ctx) => ctx.db.get(issueId));
    expect(issue!.labelIds).toEqual([small]);
    const rows = await t.run((ctx) => ctx.db.query("issueLabels").withIndex("by_issue", (q) => q.eq("issueId", issueId)).collect());
    expect(rows.map((r) => r.labelId)).toEqual([small]);
  });
});

describe("subscriptions and notifications (D-31)", () => {
  it("notifies the assignee and subscribers, never the actor", async () => {
    const { issueId } = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "x", assigneeId: bo.userId });
    expect((await notificationsFor(bo)).map((n) => n.kind)).toEqual(["assigned"]);
    const done = (await states(eng)).find((s) => s.category === "completed")!;
    await ws.as(bo).mutation(api.issues.update, { issueId, stateId: done.id });
    expect((await notificationsFor(ada)).map((n) => [n.kind, n.summary])).toEqual([["status", "changed the status to Done"]]);
    expect((await notificationsFor(bo)).map((n) => n.kind)).toEqual(["assigned"]);
  });

  it("coalesces repeated changes and respects unsubscribe", async () => {
    const { issueId } = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "x" });
    await ws.as(bo).mutation(api.issues.setSubscribed, { issueId, subscribed: true });
    await ws.as(ada).mutation(api.issues.update, { issueId, priority: 1 });
    await ws.as(ada).mutation(api.issues.update, { issueId, priority: 2 });
    const bos = await notificationsFor(bo);
    expect(bos.map((n) => n.summary)).toEqual(["set the priority to High"]);
    await ws.as(bo).mutation(api.issues.setSubscribed, { issueId, subscribed: false });
    await ws.as(ada).mutation(api.issues.update, { issueId, priority: 3 });
    expect((await notificationsFor(bo)).length).toBe(1);
  });

  it("notifies mentioned people who can read the issue, once", async () => {
    const { issueId } = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "x", description: mentionDoc(bo, "Bo") });
    expect((await notificationsFor(bo)).map((n) => n.kind)).toEqual(["mentioned"]);
    // Editing the description again doesn't re-notify someone already mentioned.
    await ws.as(ada).mutation(api.issues.update, { issueId, description: mentionDoc(bo, "Bo").replace("cc ", "ping ") });
    expect((await notificationsFor(bo)).length).toBe(1);
    // Bo can't read SEC: no notification, no subscription.
    await ws.as(ada).mutation(api.issues.create, { teamId: sec, title: "secret", description: mentionDoc(bo, "Bo") });
    expect((await notificationsFor(bo)).length).toBe(1);
  });

  it("stores plain text for search", async () => {
    const { issueId } = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "x", description: JSON.stringify(fromPlainText("hello world")) });
    expect((await t.run((ctx) => ctx.db.get(issueId)))!.descriptionText).toBe("hello world");
  });
});

describe("access", () => {
  it("hides private-team issues and lets guests work only in their teams", async () => {
    await ws.as(ada).mutation(api.issues.create, { teamId: sec, title: "secret" });
    expect(await ws.as(bo).query(api.issues.get, { identifier: "SEC-1" })).toBeNull();
    const { issueId } = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "x" });
    expect(await ws.as(gus).query(api.issues.get, { identifier: "ENG-1" })).toBeNull();
    expect(await errorCode(ws.as(gus).mutation(api.issues.update, { issueId, title: "y" }))).toBe("NOT_FOUND");
  });
});

describe("move, delete, restore, purge (D-24, D-26)", () => {
  it("moves to another team with a new identifier and keeps the old one as an alias", async () => {
    const des = await addTeam(t, ws, "DES", "public", [[ada, "owner"]]);
    const label = await ws.as(ada).mutation(api.labels.create, { teamId: eng, name: "Backend", color: "#83858e" });
    const { issueId } = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "Move me", labelIds: [label] });
    expect(await ws.as(ada).mutation(api.issues.move, { issueId, teamId: des })).toEqual({ identifier: "DES-1" });
    const viaAlias = await ws.as(ada).query(api.issues.get, { identifier: "ENG-1" });
    expect(viaAlias).toMatchObject({ identifier: "DES-1", labelIds: [] });
  });

  it("soft-deletes, restores, and purges after 30 days", async () => {
    const parent = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "Parent" });
    await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "Child", parentId: parent.issueId });
    await ws.as(ada).mutation(api.issues.remove, { issueId: parent.issueId });
    expect(await ws.as(ada).query(api.issues.get, { identifier: "ENG-1" })).toMatchObject({ deleted: true });
    expect((await ws.as(ada).query(api.issues.recentlyDeleted, {})).map((i) => i.identifier)).toEqual(["ENG-1"]);
    await ws.as(ada).mutation(api.issues.restore, { issueId: parent.issueId });
    expect(await ws.as(ada).query(api.issues.recentlyDeleted, {})).toEqual([]);

    await ws.as(ada).mutation(api.issues.remove, { issueId: parent.issueId });
    await t.mutation(internal.issues.purgeDeleted, {});
    expect(await t.run((ctx) => ctx.db.get(parent.issueId))).not.toBeNull();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
    await t.mutation(internal.issues.purgeDeleted, {});
    expect(await t.run((ctx) => ctx.db.get(parent.issueId))).toBeNull();
    const child = await ws.as(ada).query(api.issues.get, { identifier: "ENG-2" });
    expect(child).toMatchObject({ parentId: null });
  });

  it("relates issues both ways and stores blocked-by as the inverse", async () => {
    const a = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "A" });
    const b = await ws.as(ada).mutation(api.issues.create, { teamId: eng, title: "B" });
    await ws.as(ada).mutation(api.issues.addRelation, { issueId: a.issueId, relatedIssueId: b.issueId, type: "blocked_by" });
    expect(await errorCode(ws.as(ada).mutation(api.issues.addRelation, { issueId: b.issueId, relatedIssueId: a.issueId, type: "related" }))).toBe("CONFLICT");
    const issueB = await ws.as(ada).query(api.issues.get, { identifier: "ENG-2" });
    expect(issueB?.deleted === false && issueB.relations.map((r) => [r.type, r.direction, r.issue.identifier])).toEqual([["blocks", "outgoing", "ENG-1"]]);
  });
});
