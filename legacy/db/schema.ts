import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  settingsJson: text("settings_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const members = sqliteTable("members", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  welcomeSeenAt: text("welcome_seen_at"),
});

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
  teamIdsJson: text("team_ids_json").notNull().default("[]"),
  invitedBy: text("invited_by").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  acceptedAt: text("accepted_at"),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  key: text("key").notNull().unique(),
  parentId: text("parent_id"),
  visibility: text("visibility").notNull().default("public"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  triageEnabled: integer("triage_enabled").notNull().default(0),
  cycleDurationDays: integer("cycle_duration_days").notNull().default(14),
  cycleStartDate: text("cycle_start_date"),
});

export const issueStatuses = sqliteTable("issue_statuses", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  position: integer("position").notNull().default(0),
  isDefault: integer("is_default").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [uniqueIndex("issue_statuses_team_name_unique").on(table.teamId, table.name)]);

export const teamMembers = sqliteTable("team_members", {
  teamId: text("team_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"),
}, table => [primaryKey({ columns: [table.teamId, table.userId] })]);

export const teamCounters = sqliteTable("team_counters", {
  teamId: text("team_id").primaryKey(),
  nextIssueNumber: integer("next_issue_number").notNull().default(1),
});

export const projectTeams = sqliteTable("project_teams", {
  projectId: text("project_id").notNull(),
  teamId: text("team_id").notNull(),
}, table => [primaryKey({ columns: [table.projectId, table.teamId] })]);

export const issueSubscriptions = sqliteTable("issue_subscriptions", {
  issueId: text("issue_id").notNull(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [primaryKey({ columns: [table.issueId, table.userId] })]);

export const issueEvents = sqliteTable("issue_events", {
  id: text("id").primaryKey(),
  issueId: text("issue_id").notNull(),
  teamId: text("team_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  action: text("action").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const exportJobs = sqliteTable("export_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  includePrivate: integer("include_private").notNull().default(0),
  status: text("status").notNull().default("pending"),
  storageKey: text("storage_key"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const integrationConnections = sqliteTable("integration_connections", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  displayName: text("display_name").notNull(),
  ownerUserId: text("owner_user_id"),
  status: text("status").notNull().default("connected"),
  credentialsJson: text("credentials_json").notNull().default("{}"),
  settingsJson: text("settings_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const integrationStates = sqliteTable("integration_states", {
  stateHash: text("state_hash").primaryKey(),
  provider: text("provider").notNull(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  contextJson: text("context_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const integrationDeliveries = sqliteTable("integration_deliveries", {
  provider: text("provider").notNull(),
  deliveryId: text("delivery_id").notNull(),
  status: text("status").notNull().default("received"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [primaryKey({ columns: [table.provider, table.deliveryId] })]);

export const integrationLinks = sqliteTable("integration_links", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  issueId: text("issue_id"),
  projectId: text("project_id"),
  kind: text("kind").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const records = sqliteTable("records", {
  kind: text("kind").notNull(),
  id: text("id").notNull(),
  teamId: text("team_id"),
  ownerUserId: text("owner_user_id"),
  valueJson: text("value_json").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
}, table => [primaryKey({ columns: [table.kind, table.id] })]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  ipAddress: text("ip_address"),
  country: text("country"),
  createdAt: text("created_at").notNull(),
});

export const mcpTokens = sqliteTable("mcp_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  secretHash: text("secret_hash").notNull(),
  scope: text("scope").notNull().default("read write"),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
});
