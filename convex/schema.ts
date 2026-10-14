import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/*
 * Tenancy (D-15): every table except `users` carries `workspaceId`, the Convex
 * id of the workspace that mirrors one WorkOS organization. Functions never
 * take it from the client; the wrapper in convex/lib/functions.ts resolves it
 * from the signed `org_id` claim. Each index notes the view or check it serves
 * (D-32).
 */

export const workspaceRole = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("guest"),
);
export const teamVisibility = v.union(
  v.literal("public"),
  v.literal("restricted"),
  v.literal("private"),
);
export const teamRole = v.union(v.literal("owner"), v.literal("member"));
export const stateCategory = v.union(
  v.literal("triage"),
  v.literal("backlog"),
  v.literal("unstarted"),
  v.literal("started"),
  v.literal("completed"),
  v.literal("canceled"),
);

export default defineSchema({
  /** People, across workspaces. Mirrors the WorkOS user (session sync). */
  users: defineTable({
    workosUserId: v.string(),
    email: v.string(),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    syncedAt: v.number(),
  })
    // Identity -> user on every call.
    .index("by_workos_user_id", ["workosUserId"])
    // "Already a member?" check when inviting.
    .index("by_email", ["email"]),

  /** One per WorkOS organization (D-15). */
  workspaces: defineTable({
    workosOrganizationId: v.string(),
    name: v.string(),
    /** URL segment: /<urlKey>/... */
    urlKey: v.string(),
    createdBy: v.id("users"),
  })
    // org_id claim -> workspace on every call.
    .index("by_workos_organization_id", ["workosOrganizationId"])
    // URL -> workspace (switching) and uniqueness on create/rename.
    .index("by_url_key", ["urlKey"]),

  /** Mirrors WorkOS organization memberships; roles come from WorkOS RBAC (D-16). */
  memberships: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    workosMembershipId: v.string(),
    role: workspaceRole,
    status: v.union(v.literal("active"), v.literal("suspended")),
    /** Last mirror write; session sync skips rows changed after it listed WorkOS. */
    updatedAt: v.number(),
  })
    // Resolve the viewer's membership on every call.
    .index("by_workspace_and_user", ["workspaceId", "userId"])
    // Workspace switcher: the viewer's workspaces.
    .index("by_user", ["userId"])
    // Members settings list, and the active-owner count (D-16).
    .index("by_workspace_and_status_and_role", ["workspaceId", "status", "role"])
    // Session sync: WorkOS membership -> mirror row.
    .index("by_workos_membership_id", ["workosMembershipId"]),

  /** Mirrors WorkOS invitations. */
  invitations: defineTable({
    workspaceId: v.id("workspaces"),
    workosInvitationId: v.string(),
    email: v.string(),
    role: workspaceRole,
    state: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    /** WorkOS accept link: a bearer secret, returned to admins only. */
    acceptUrl: v.string(),
  })
    // Members settings: pending invitations.
    .index("by_workspace_and_state", ["workspaceId", "state"])
    // Duplicate check on invite; mark accepted on session sync.
    .index("by_workspace_and_email", ["workspaceId", "email"])
    .index("by_workos_invitation_id", ["workosInvitationId"]),

  /** Teams (D-17). Membership lives here, not in WorkOS. */
  teams: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    /** Issue prefix, e.g. ENG (D-24). */
    key: v.string(),
    description: v.optional(v.string()),
    parentId: v.union(v.id("teams"), v.null()),
    visibility: teamVisibility,
    /** Exactly one default state per team (D-27). Set right after creation. */
    defaultStateId: v.optional(v.id("workflowStates")),
    /** Last issue number handed out; the next issue is counter + 1 (D-24). */
    issueCounter: v.number(),
    createdBy: v.id("users"),
  })
    // The workspace's team graph, loaded once per call (tens of teams).
    .index("by_workspace", ["workspaceId"])
    // URL /team/<KEY> -> team, and key uniqueness.
    .index("by_workspace_and_key", ["workspaceId", "key"]),

  teamMembers: defineTable({
    workspaceId: v.id("workspaces"),
    teamId: v.id("teams"),
    userId: v.id("users"),
    role: teamRole,
  })
    // Membership check and duplicate guard.
    .index("by_team_and_user", ["teamId", "userId"])
    // The viewer's teams on every call.
    .index("by_workspace_and_user", ["workspaceId", "userId"])
    // Team members settings.
    .index("by_team", ["teamId"]),

  /** Per-team workflow states (D-27). */
  workflowStates: defineTable({
    workspaceId: v.id("workspaces"),
    teamId: v.id("teams"),
    name: v.string(),
    category: stateCategory,
    color: v.string(),
    description: v.optional(v.string()),
    /** Order within the team; fractional so inserts and moves touch one row. */
    position: v.number(),
  })
    // Team workflow settings and status pickers, in order.
    .index("by_team_and_position", ["teamId", "position"]),

  /**
   * Issues. Phase 1 carries only what the large-list spike (O-3) needs;
   * Phase 2 adds descriptions, labels, projects, cycles, and the rest.
   */
  issues: defineTable({
    workspaceId: v.id("workspaces"),
    teamId: v.id("teams"),
    number: v.number(),
    /** e.g. ENG-123; never changes (D-24). */
    identifier: v.string(),
    title: v.string(),
    stateId: v.id("workflowStates"),
    /** 0 none, 1 urgent, 2 high, 3 medium, 4 low (D-28). */
    priority: v.number(),
    assigneeId: v.optional(v.id("users")),
    creatorId: v.id("users"),
    sortOrder: v.number(),
    /** Optimistic concurrency (D-21). */
    version: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    // Team issue list, newest number first.
    .index("by_team_and_number", ["teamId", "number"])
    // Moving issues off a deleted workflow state.
    .index("by_state", ["stateId"]),

  /** Append-only work-item history (D-22). Not the admin audit log. */
  issueHistory: defineTable({
    workspaceId: v.id("workspaces"),
    issueId: v.id("issues"),
    actorId: v.id("users"),
    kind: v.union(v.literal("created"), v.literal("updated")),
    changes: v.array(
      v.object({
        field: v.string(),
        from: v.optional(v.union(v.string(), v.number(), v.null())),
        to: v.optional(v.union(v.string(), v.number(), v.null())),
      }),
    ),
  })
    // Issue activity timeline.
    .index("by_issue", ["issueId"]),

  /**
   * Outbox for WorkOS Audit Logs (D-22): written in the same transaction as the
   * change, delivered by an action with retries (convex/audit.ts).
   */
  auditEvents: defineTable({
    workspaceId: v.id("workspaces"),
    action: v.string(),
    actorId: v.id("users"),
    targets: v.array(v.object({ type: v.string(), id: v.string(), name: v.optional(v.string()) })),
    metadata: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    occurredAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    attempts: v.number(),
    lastError: v.optional(v.string()),
  })
    // Retry sweep: pending events, oldest first.
    .index("by_status", ["status"]),
});
