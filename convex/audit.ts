import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { auditActions, type AuditAction } from "./lib/auditActions";
import { recordAudit, systemAction, systemMutation, systemQuery, workspaceInternalMutation } from "./lib/functions";
import { workos, workosErrorMessage } from "./lib/workos";

/*
 * Delivery of the audit outbox to WorkOS Audit Logs (D-22). Each row is sent
 * with its id as the idempotency key, retried with exponential backoff, and
 * swept by a cron in case a scheduled delivery is lost.
 */

const maxAttempts = 8;
const baseDelayMs = 5_000;

const eventArgs = {
  action: v.string(),
  targets: v.array(v.object({ type: v.string(), id: v.string(), name: v.optional(v.string()) })),
  metadata: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
};

function assertAction(action: string): AuditAction {
  if (!(action in auditActions)) throw new Error(`Unknown audit action: ${action}`);
  return action as AuditAction;
}

/** For actions: record an event as the calling member, after WorkOS accepted the change. */
export const record = workspaceInternalMutation({
  args: eventArgs,
  handler: async (ctx, event) => {
    await ctx.audit({ ...event, action: assertAction(event.action) });
  },
});

/** For actions where the caller is no longer a member afterwards (leaving). */
export const recordAs = systemMutation({
  args: { ...eventArgs, actorId: v.id("users"), workspaceId: v.id("workspaces") },
  handler: async (ctx, { actorId, workspaceId, ...event }) => {
    const [user, workspace] = await Promise.all([ctx.db.get(actorId), ctx.db.get(workspaceId)]);
    if (!user || !workspace) return;
    await recordAudit(ctx, { user, workspace }, { ...event, action: assertAction(event.action) });
  },
});

export const loadForDelivery = systemQuery({
  args: { eventId: v.id("auditEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return null;
    const [workspace, actor] = await Promise.all([ctx.db.get(event.workspaceId), ctx.db.get(event.actorId)]);
    if (!workspace || !actor) return null;
    return { event, organizationId: workspace.workosOrganizationId, actor };
  },
});

export const deliver = systemAction({
  args: { eventId: v.id("auditEvents") },
  handler: async (ctx, { eventId }) => {
    const payload = await ctx.runQuery(internal.audit.loadForDelivery, { eventId });
    if (!payload) return;
    const { event, organizationId, actor } = payload;
    try {
      await workos().auditLogs.createEvent(organizationId, toWorkOSEvent(event, actor), { idempotencyKey: eventId });
      await ctx.runMutation(internal.audit.markDelivered, { eventId });
    } catch (error) {
      await ctx.runMutation(internal.audit.markAttemptFailed, { eventId, error: workosErrorMessage(error) });
    }
  },
});

/**
 * The WorkOS payload. The schemas `pnpm workos:bootstrap` creates require a
 * `metadata` object on the actor and on every target, even when empty, and the
 * targets in the order the schema lists them.
 */
export function toWorkOSEvent(
  event: Pick<Doc<"auditEvents">, "action" | "occurredAt" | "targets" | "metadata">,
  actor: Pick<Doc<"users">, "workosUserId" | "name">,
) {
  return {
    action: event.action,
    occurredAt: new Date(event.occurredAt),
    actor: { type: "user", id: actor.workosUserId, name: actor.name, metadata: {} },
    targets: event.targets.map((target) => ({ ...target, metadata: {} })),
    // WorkOS requires an IP. Convex functions never see the client's, so
    // 0.0.0.0 marks it as unknown rather than inventing one.
    context: { location: "0.0.0.0" },
    metadata: event.metadata,
  };
}

export const markDelivered = systemMutation({
  args: { eventId: v.id("auditEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (event) await ctx.db.patch(eventId, { status: "delivered", attempts: event.attempts + 1, lastError: undefined });
  },
});

export const markAttemptFailed = systemMutation({
  args: { eventId: v.id("auditEvents"), error: v.string() },
  handler: async (ctx, { eventId, error }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return;
    const attempts = event.attempts + 1;
    if (attempts >= maxAttempts) {
      console.error(`audit delivery failed permanently`, { eventId, action: event.action, error });
      await ctx.db.patch(eventId, { status: "failed", attempts, lastError: error });
      return;
    }
    await ctx.db.patch(eventId, { attempts, lastError: error });
    await ctx.scheduler.runAfter(baseDelayMs * 2 ** (attempts - 1), internal.audit.deliver, { eventId });
  },
});

/** Cron: re-schedule pending events whose delivery was lost (older than an hour). */
export const sweep = systemMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const pending = await ctx.db.query("auditEvents").withIndex("by_status", (q) => q.eq("status", "pending")).take(100);
    for (const event of pending) {
      if (event.occurredAt < cutoff) await ctx.scheduler.runAfter(0, internal.audit.deliver, { eventId: event._id });
    }
  },
});
