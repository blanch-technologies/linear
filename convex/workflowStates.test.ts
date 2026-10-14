import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addTeam, addUser, addWorkspace, errorCode, newConvex, type Person, type TestConvex, type Workspace } from "./lib/test.fixtures";

let t: TestConvex;
let lead: Person;
let member: Person;
let ws: Workspace;
let eng: Id<"teams">;

const stateNamed = async (name: string) =>
  (await ws.as(lead).query(api.workflowStates.list, { teamId: eng })).states.find((s) => s.name === name)!;

beforeEach(async () => {
  vi.useFakeTimers();
  t = newConvex();
  lead = await addUser(t, "lead");
  member = await addUser(t, "member");
  ws = await addWorkspace(t, "acme", [[lead, "member"], [member, "member"]]);
  eng = await addTeam(t, ws, "ENG", "public", [[lead, "owner"], [member, "member"]]);
});

afterEach(() => vi.useRealTimers());

describe("workflow states (D-27)", () => {
  it("lets team managers add, rename, recolor, and reorder", async () => {
    const id = await ws.as(lead).mutation(api.workflowStates.create, { teamId: eng, name: "QA", category: "started", color: "#8E7CF8" });
    await ws.as(lead).mutation(api.workflowStates.update, { stateId: id, name: "Testing", color: "#5cb788" });
    const inProgress = await stateNamed("In Progress");
    await ws.as(lead).mutation(api.workflowStates.move, { stateId: id, beforeStateId: inProgress.id });
    const started = (await ws.as(lead).query(api.workflowStates.list, { teamId: eng })).states.filter((s) => s.category === "started");
    expect(started.map((s) => [s.name, s.color])).toEqual([["Testing", "#5cb788"], ["In Progress", "#ebaa69"], ["In Review", "#66a8e9"]]);
    expect(await errorCode(ws.as(lead).mutation(api.workflowStates.move, { stateId: id, beforeStateId: (await stateNamed("Done")).id }))).toBe("INVALID");
  });

  it("refuses non-managers, duplicate names, triage, and bad colors", async () => {
    expect(await errorCode(ws.as(member).mutation(api.workflowStates.create, { teamId: eng, name: "QA", category: "started", color: "#ebaa69" }))).toBe("FORBIDDEN");
    expect(await errorCode(ws.as(lead).mutation(api.workflowStates.create, { teamId: eng, name: "todo", category: "unstarted", color: "#ebaa69" }))).toBe("CONFLICT");
    expect(await errorCode(ws.as(lead).mutation(api.workflowStates.create, { teamId: eng, name: "Triage", category: "triage", color: "#ebaa69" }))).toBe("INVALID");
    expect(await errorCode(ws.as(lead).mutation(api.workflowStates.create, { teamId: eng, name: "QA", category: "started", color: "red" }))).toBe("INVALID");
  });

  it("keeps exactly one default, in a backlog or unstarted category", async () => {
    const backlog = await stateNamed("Backlog");
    await ws.as(lead).mutation(api.workflowStates.setDefault, { stateId: backlog.id });
    expect((await ws.as(lead).query(api.workflowStates.list, { teamId: eng })).defaultStateId).toBe(backlog.id);
    expect(await errorCode(ws.as(lead).mutation(api.workflowStates.setDefault, { stateId: (await stateNamed("Done")).id }))).toBe("INVALID");
    expect(await errorCode(ws.as(lead).mutation(api.workflowStates.remove, { stateId: backlog.id }))).toBe("INVALID");
  });

  it("keeps one state per required category", async () => {
    expect(await errorCode(ws.as(lead).mutation(api.workflowStates.remove, { stateId: (await stateNamed("Done")).id }))).toBe("INVALID");
    expect(await ws.as(lead).mutation(api.workflowStates.remove, { stateId: (await stateNamed("Duplicate")).id })).toEqual({ pending: false });
  });

  it("moves issues to a replacement before deleting", async () => {
    const todo = await stateNamed("Todo");
    const backlog = await stateNamed("Backlog");
    await ws.as(lead).mutation(api.workflowStates.setDefault, { stateId: backlog.id });
    await ws.as(lead).mutation(api.workflowStates.setDefault, { stateId: todo.id });
    await ws.as(member).mutation(api.issues.create, { teamId: eng, title: "One" });
    const inProgress = await stateNamed("In Progress");
    const { issueId } = await ws.as(member).mutation(api.issues.create, { teamId: eng, title: "Two" });
    await t.run((ctx) => ctx.db.patch(issueId, { stateId: inProgress.id }));
    expect(await errorCode(ws.as(lead).mutation(api.workflowStates.remove, { stateId: inProgress.id }))).toBe("INVALID");
    const review = await stateNamed("In Review");
    expect(await ws.as(lead).mutation(api.workflowStates.remove, { stateId: inProgress.id, replacementStateId: review.id })).toEqual({ pending: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const issue = await t.run((ctx) => ctx.db.get(issueId));
    expect(issue).toMatchObject({ stateId: review.id, version: 2 });
    expect(await t.run((ctx) => ctx.db.get(inProgress.id))).toBeNull();
  });
});

describe("issues (D-21, D-22, D-24)", () => {
  it("numbers issues per team and rejects stale writes", async () => {
    const first = await ws.as(member).mutation(api.issues.create, { teamId: eng, title: "First" });
    const second = await ws.as(member).mutation(api.issues.create, { teamId: eng, title: "Second" });
    expect([first.identifier, second.identifier]).toEqual(["ENG-1", "ENG-2"]);
    expect(await ws.as(member).mutation(api.issues.setPriority, { issueId: first.issueId, priority: 2, expectedVersion: 1 })).toEqual({ version: 2 });
    expect(await errorCode(ws.as(lead).mutation(api.issues.setPriority, { issueId: first.issueId, priority: 1, expectedVersion: 1 }))).toBe("CONFLICT");
    const history = await t.run((ctx) => ctx.db.query("issueHistory").withIndex("by_issue", (q) => q.eq("issueId", first.issueId)).collect());
    expect(history.map((h) => [h.kind, h.changes])).toEqual([
      ["created", []],
      ["updated", [{ field: "priority", from: 0, to: 2 }]],
    ]);
  });
});
