/**
 * The single entry point for Convex functions (D-19). Every query, mutation,
 * and action in this codebase is built from these wrappers; importing the raw
 * builders from _generated/server anywhere else fails lint.
 *
 * - `workspace*`: the caller is an active member of the workspace in their
 *   token (`ctx.viewer`); mutations get `ctx.audit` for admin events.
 * - `authed*`: signed in, no workspace yet (onboarding, the switcher).
 * - `system*`: internal only, no caller. Sync, crons, seed. Never takes
 *   tenant ids from a client.
 */
import { customAction, customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { AuditAction, AuditTarget } from "./auditActions";
import { loadViewer, requireIdentity, userByIdentity, type Viewer } from "./viewer";

export type AuditInput = {
  action: AuditAction;
  targets: AuditTarget[];
  metadata?: Record<string, string | number | boolean>;
};

/** Writes the audit outbox row in the caller's transaction, then schedules delivery. */
export async function recordAudit(ctx: MutationCtx, viewer: Pick<Viewer, "workspace" | "user">, event: AuditInput) {
  const eventId = await ctx.db.insert("auditEvents", {
    workspaceId: viewer.workspace._id,
    actorId: viewer.user._id,
    action: event.action,
    targets: event.targets,
    metadata: event.metadata,
    occurredAt: Date.now(),
    status: "pending",
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.audit.deliver, { eventId });
}

const withViewer = customCtx(async (ctx: Parameters<typeof loadViewer>[0]) => ({
  viewer: await loadViewer(ctx),
}));

const withViewerAndAudit = customCtx(async (ctx: MutationCtx) => {
  const viewer = await loadViewer(ctx);
  return { viewer, audit: (event: AuditInput) => recordAudit(ctx, viewer, event) };
});

const withIdentity = customCtx(async (ctx: Parameters<typeof requireIdentity>[0] & { db: Parameters<typeof userByIdentity>[0] }) => {
  const identity = await requireIdentity(ctx);
  return { identity, user: await userByIdentity(ctx.db, identity) };
});

export const workspaceQuery = customQuery(query, withViewer);
export const workspaceMutation = customMutation(mutation, withViewerAndAudit);
/** Called by actions via ctx.runQuery/runMutation; the caller's identity carries over. */
export const workspaceInternalQuery = customQuery(internalQuery, withViewer);
export const workspaceInternalMutation = customMutation(internalMutation, withViewerAndAudit);

export const authedQuery = customQuery(query, withIdentity);
export const authedMutation = customMutation(mutation, withIdentity);
export const authedInternalMutation = customMutation(internalMutation, withIdentity);
export const authedAction = customAction(
  action,
  customCtx(async (ctx) => ({ identity: await requireIdentity(ctx) })),
);

export const systemQuery = internalQuery;
export const systemMutation = internalMutation;
export const systemAction = internalAction;
