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
    /** Estimate scale; absent means estimates are off for the team. */
    estimateScale: v.optional(
      v.union(v.literal("linear"), v.literal("exponential"), v.literal("fibonacci"), v.literal("tshirt")),
    ),
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

  /** Issues (D-23). Every list query uses one of these indexes (D-32). */
  issues: defineTable({
    workspaceId: v.id("workspaces"),
    teamId: v.id("teams"),
    number: v.number(),
    /** e.g. ENG-123; never changes; a move to another team adds an alias (D-24). */
    identifier: v.string(),
    title: v.string(),
    /** ProseMirror JSON (ADR 0006), and its plain text for search and previews. */
    description: v.optional(v.string()),
    descriptionText: v.optional(v.string()),
    stateId: v.id("workflowStates"),
    /** Copied from the state so views can filter by category with an index. */
    stateCategory: stateCategory,
    /** 0 none, 1 urgent, 2 high, 3 medium, 4 low (D-28). */
    priority: v.number(),
    assigneeId: v.optional(v.id("users")),
    creatorId: v.id("users"),
    /** Copied from issueLabels for rendering; issueLabels is the indexed relation. */
    labelIds: v.array(v.id("labels")),
    estimate: v.optional(v.number()),
    /** Calendar date, YYYY-MM-DD. */
    dueDate: v.optional(v.string()),
    parentId: v.optional(v.id("issues")),
    /** Manual order within a list or board column; fractional. */
    sortOrder: v.number(),
    /** Optimistic concurrency (D-21). */
    version: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    /** Soft delete (D-26); purged 30 days later. */
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    // Team issue list, newest first.
    .index("by_team_and_number", ["teamId", "number"])
    // Team views filtered by state category (active, backlog, ...).
    .index("by_team_and_category", ["teamId", "stateCategory"])
    // Moving issues off a deleted workflow state.
    .index("by_state", ["stateId"])
    // Identifier -> issue for /issue/ENG-123 URLs.
    .index("by_workspace_and_identifier", ["workspaceId", "identifier"])
    // My issues: Assigned (by category), Created.
    .index("by_assignee_and_category", ["workspaceId", "assigneeId", "stateCategory"])
    .index("by_creator", ["workspaceId", "creatorId"])
    // Sub-issues of a parent.
    .index("by_parent", ["parentId"])
    // Recently deleted.
    .index("by_workspace_and_deleted", ["workspaceId", "deletedAt"])
    // The purge cron (D-26): deleted more than 30 days ago, across workspaces.
    .index("by_deleted", ["deletedAt"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["workspaceId", "deletedAt"] })
    .searchIndex("search_description", { searchField: "descriptionText", filterFields: ["workspaceId", "deletedAt"] }),

  /** Old identifiers of moved issues, so links keep resolving (D-24). */
  issueAliases: defineTable({
    workspaceId: v.id("workspaces"),
    identifier: v.string(),
    issueId: v.id("issues"),
  })
    .index("by_workspace_and_identifier", ["workspaceId", "identifier"])
    // Purge: aliases of an issue.
    .index("by_issue", ["issueId"]),

  /** Labels: workspace-wide (teamId null) or per team; a label with children is a group. */
  labels: defineTable({
    workspaceId: v.id("workspaces"),
    teamId: v.union(v.id("teams"), v.null()),
    name: v.string(),
    color: v.string(),
    description: v.optional(v.string()),
    parentId: v.optional(v.id("labels")),
    archivedAt: v.optional(v.number()),
  })
    // Label pickers and settings: workspace labels, then a team's.
    .index("by_workspace_and_team", ["workspaceId", "teamId"])
    // A group's labels; "is this a group?".
    .index("by_parent", ["parentId"]),

  issueLabels: defineTable({
    workspaceId: v.id("workspaces"),
    issueId: v.id("issues"),
    labelId: v.id("labels"),
  })
    .index("by_issue", ["issueId"])
    // Filter "has label X".
    .index("by_label", ["labelId"]),

  /** Relations; "blocked by" is the inverse of "blocks" (D-25: ids only). */
  issueRelations: defineTable({
    workspaceId: v.id("workspaces"),
    issueId: v.id("issues"),
    relatedIssueId: v.id("issues"),
    type: v.union(v.literal("blocks"), v.literal("related"), v.literal("duplicate")),
    createdBy: v.id("users"),
  })
    .index("by_issue", ["issueId"])
    .index("by_related", ["relatedIssueId"]),

  comments: defineTable({
    workspaceId: v.id("workspaces"),
    issueId: v.id("issues"),
    authorId: v.id("users"),
    /** ProseMirror JSON and its plain text, as for descriptions. */
    body: v.string(),
    bodyText: v.string(),
    /** Replies point at the thread's first comment. */
    parentId: v.optional(v.id("comments")),
    editedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
  }).index("by_issue", ["issueId"]),

  commentReactions: defineTable({
    workspaceId: v.id("workspaces"),
    commentId: v.id("comments"),
    issueId: v.id("issues"),
    userId: v.id("users"),
    emoji: v.string(),
  })
    .index("by_issue", ["issueId"])
    .index("by_comment_and_user", ["commentId", "userId"]),

  /** Files in Convex storage, kept until the issue is purged (D-26). */
  attachments: defineTable({
    workspaceId: v.id("workspaces"),
    issueId: v.id("issues"),
    commentId: v.optional(v.id("comments")),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    uploadedBy: v.id("users"),
  }).index("by_issue", ["issueId"]),

  /** Who follows an issue (D-31). `subscribed: false` remembers an explicit unsubscribe. */
  subscriptions: defineTable({
    workspaceId: v.id("workspaces"),
    issueId: v.id("issues"),
    userId: v.id("users"),
    subscribed: v.boolean(),
    reason: v.union(
      v.literal("creator"),
      v.literal("assignee"),
      v.literal("mentioned"),
      v.literal("commented"),
      v.literal("manual"),
    ),
    updatedAt: v.number(),
  })
    // Recipients of an issue's notifications.
    .index("by_issue", ["issueId"])
    .index("by_issue_and_user", ["issueId", "userId"])
    // My issues > Subscribed, most recent first.
    .index("by_user", ["workspaceId", "userId", "subscribed", "updatedAt"]),

  /** Per-recipient inbox entries, generated from history and comments (ADR 0007). */
  notifications: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    actorId: v.id("users"),
    issueId: v.id("issues"),
    kind: v.union(
      v.literal("assigned"),
      v.literal("mentioned"),
      v.literal("commented"),
      v.literal("status"),
      v.literal("priority"),
      v.literal("updated"),
      v.literal("reaction"),
    ),
    commentId: v.optional(v.id("comments")),
    /** Short summary, e.g. "changed status to Done". */
    summary: v.string(),
    readAt: v.optional(v.number()),
    snoozedUntil: v.optional(v.number()),
    archived: v.boolean(),
    emailedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    // Inbox, newest first; unread count.
    .index("by_user", ["workspaceId", "userId", "archived", "createdAt"])
    .index("by_issue", ["issueId"]),

  /** Sidebar favorites, in the viewer's order. */
  favorites: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    kind: v.union(v.literal("issue"), v.literal("view"), v.literal("team")),
    targetId: v.string(),
    position: v.number(),
  }).index("by_user", ["workspaceId", "userId", "position"]),

  /** Saved views: a filter AST plus display options (ADR 0008). */
  savedViews: defineTable({
    workspaceId: v.id("workspaces"),
    ownerId: v.id("users"),
    /** Team views live under the team; workspace views have none. */
    teamId: v.union(v.id("teams"), v.null()),
    scope: v.union(v.literal("personal"), v.literal("shared")),
    name: v.string(),
    description: v.optional(v.string()),
    filter: v.string(),
    display: v.string(),
    updatedAt: v.number(),
  })
    .index("by_workspace_and_team", ["workspaceId", "teamId"])
    .index("by_owner", ["workspaceId", "ownerId"]),

  /** Append-only work-item history (D-22). Not the admin audit log. */
  issueHistory: defineTable({
    workspaceId: v.id("workspaces"),
    issueId: v.id("issues"),
    actorId: v.id("users"),
    kind: v.union(
      v.literal("created"),
      v.literal("updated"),
      v.literal("deleted"),
      v.literal("restored"),
      v.literal("moved"),
    ),
    changes: v.array(
      v.object({
        field: v.string(),
        from: v.optional(v.union(v.string(), v.number(), v.null())),
        to: v.optional(v.union(v.string(), v.number(), v.null())),
      }),
    ),
  })
    // Issue activity timeline.
    .index("by_issue", ["issueId"])
    // My issues > Activity.
    .index("by_actor", ["workspaceId", "actorId"]),

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
