import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { toWorkOSEvent } from "./audit";
import { auditActions } from "./lib/auditActions";
import { addTeam, addUser, addWorkspace, newConvex } from "./lib/test.fixtures";

const createEvent = vi.hoisted(() => vi.fn());
vi.mock("./lib/workos", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/workos")>();
  return { ...original, workos: () => ({ auditLogs: { createEvent } }) };
});

beforeEach(() => {
  vi.useFakeTimers();
  createEvent.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("audit payload", () => {
  it("matches the shape the WorkOS schemas require", () => {
    const payload = toWorkOSEvent(
      { action: "team.member_added", occurredAt: 0, targets: [{ type: "team", id: "t" }, { type: "user", id: "u" }], metadata: { role: "member" } },
      { workosUserId: "user_1", name: "A" },
    );
    expect(payload.actor).toEqual({ type: "user", id: "user_1", name: "A", metadata: {} });
    expect(payload.targets).toEqual([
      { type: "team", id: "t", metadata: {} },
      { type: "user", id: "u", metadata: {} },
    ]);
    expect(payload.targets.map((t) => t.type)).toEqual([...auditActions["team.member_added"].targets]);
  });
});

describe("audit outbox delivery", () => {
  async function setupEvent() {
    const t = newConvex();
    const owner = await addUser(t, "owner");
    const ws = await addWorkspace(t, "acme", [[owner, "owner"]]);
    await addTeam(t, ws, "ENG", "public", [[owner, "owner"]]);
    await ws.as(owner).mutation(api.teams.create, { name: "Design", key: "DES", visibility: "private" });
    const event = (await t.run((ctx) => ctx.db.query("auditEvents").first()))!;
    return { t, event, ws };
  }

  it("delivers once with the event id as the idempotency key", async () => {
    const { t, event, ws } = await setupEvent();
    createEvent.mockResolvedValue(undefined);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createEvent.mock.calls[0]![0]).toBe(ws.organizationId);
    expect(createEvent.mock.calls[0]![2]).toEqual({ idempotencyKey: event._id });
    expect((await t.run((ctx) => ctx.db.get(event._id)))?.status).toBe("delivered");
  });

  it("retries with backoff, then gives up and marks the event failed", async () => {
    const { t, event } = await setupEvent();
    createEvent.mockRejectedValue(new Error("WorkOS down"));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const failed = await t.run((ctx) => ctx.db.get(event._id));
    expect(failed).toMatchObject({ status: "failed", attempts: 8, lastError: "WorkOS down" });
    expect(createEvent).toHaveBeenCalledTimes(8);
  });

  it("recovers after a transient failure", async () => {
    const { t, event } = await setupEvent();
    createEvent.mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(undefined);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(event._id)))).toMatchObject({ status: "delivered", attempts: 2 });
  });

  it("sweeps pending events whose delivery was lost", async () => {
    const { t, event } = await setupEvent();
    await t.run((ctx) => ctx.db.patch(event._id, { occurredAt: Date.now() - 2 * 60 * 60 * 1000 }));
    createEvent.mockResolvedValue(undefined);
    await t.mutation(internal.audit.sweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(event._id)))?.status).toBe("delivered");
  });
});
