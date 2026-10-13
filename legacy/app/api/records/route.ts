import { ApiError, audit, canReadTeam, canWriteTeam, errorResponse, json, now, requireContext, safeParse, type Context } from "../../../lib/workspace-server";
import { getRequestExecutionContext } from "vinext/shims/request-context";
import { syncIssueOutbound } from "../../../lib/integrations/outbound";
import { defaultStatusForTeam, firstStatusInCategory, statusForTeam } from "../../../lib/issue-workflow";

export const dynamic = "force-dynamic";

type Kind = "issue" | "project" | "cycle" | "view" | "notification" | "initiative" | "request" | "dashboard" | "document" | "customer" | "customerRequest" | "releasePipeline" | "release" | "issueTemplate";
type RecordRow = { kind: Kind; id: string; team_id: string | null; owner_user_id: string | null; value_json: string; version: number; deleted_at: string | null };
const kinds = new Set<Kind>(["issue", "project", "cycle", "view", "notification", "initiative", "request", "dashboard", "document", "customer", "customerRequest", "releasePipeline", "release", "issueTemplate"]);
const priorityOptions = new Set(["Urgent", "High", "Medium", "Low", "No priority"]);
const allowedFields: Record<Kind, Set<string>> = {
  issue: new Set(["title", "description", "status", "priority", "assignee", "assigneeId", "project", "projectId", "cycle", "labels", "source", "dueDate", "startDate", "estimate", "parentId", "relatedIds", "blockedByIds", "milestoneId"]),
  project: new Set(["name", "description", "status", "lead", "target", "startDate", "priority", "labels", "memberIds", "color", "icon", "initiativeId", "teamIds", "milestones", "updates", "blockedByProjectIds"]),
  cycle: new Set(["name", "start", "end", "current"]),
  view: new Set(["name", "description", "type", "entity", "filters", "layout", "groupBy", "sortBy", "scope"]),
  notification: new Set(["read"]),
  initiative: new Set(["name", "description", "status", "owner", "target", "parentIds"]),
  request: new Set(["title", "description"]),
  dashboard: new Set(["name", "description", "visibility", "blocks", "filters"]),
  document: new Set(["name", "content", "projectId", "initiativeId", "icon"]),
  customer: new Set(["name", "domain", "tier", "status", "revenue", "notes"]),
  customerRequest: new Set(["title", "description", "customerId", "issueId", "projectId", "source", "requester", "createdAt"]),
  releasePipeline: new Set(["name", "description", "type", "teamIds", "environment", "branch"]),
  release: new Set(["name", "pipelineId", "status", "date", "commitSha", "issueIds", "notes"]),
  issueTemplate: new Set(["name", "title", "description", "status", "priority", "labels"]),
};

async function findRecord(ctx: Context, kind: Kind, id: string) {
  const row = await ctx.db.prepare("SELECT kind, id, team_id, owner_user_id, value_json, version, deleted_at FROM records WHERE kind = ? AND id = ?")
    .bind(kind, id).first<RecordRow>();
  if (!row) throw new ApiError(404, "Record not found");
  return row;
}

async function validateTeamStatus(ctx: Context, kind: Kind, teamId: string | null, status: unknown) {
  if (!teamId || typeof status !== "string") throw new ApiError(400, "Invalid issue status");
  if (status === "Triage" && kind === "issue" && ctx.teams.find(team => team.id === teamId)?.triage_enabled) return;
  if (!await statusForTeam(ctx.db, teamId, status)) throw new ApiError(400, "Status is unavailable for this team");
}

async function resolveAssignee(ctx: Context, identity: unknown, teamId: string | null) {
  if (identity === "" || identity === undefined || identity === null) return null;
  if (typeof identity !== "string") throw new ApiError(400, "Invalid assignee");
  const matches = (await ctx.db.prepare("SELECT user_id, display_name, role FROM members WHERE (user_id = ? OR display_name = ?) AND status = 'active'")
    .bind(identity, identity).all<{ user_id: string; display_name: string; role: string }>()).results;
  if (matches.length !== 1) throw new ApiError(400, "Choose an active workspace member");
  const target = matches[0];
  const team = ctx.teams.find(item => item.id === teamId);
  const joined = await ctx.db.prepare("SELECT 1 AS present FROM team_members WHERE team_id = ? AND user_id = ?").bind(teamId, target.user_id).first();
  const parentJoined = team?.parent_id && await ctx.db.prepare("SELECT 1 AS present FROM team_members WHERE team_id = ? AND user_id = ?")
    .bind(team.parent_id, target.user_id).first();
  if (!joined && (target.role === "guest" || team?.visibility === "private" || (team?.visibility === "restricted" && !parentJoined)))
    throw new ApiError(400, "Assignee cannot access this team");
  return target;
}

async function validateIssueLinks(ctx: Context, value: Record<string, unknown>, teamId: string | null, fields: Array<"project" | "cycle">) {
  for (const field of fields) {
    const name = value[field];
    if (!name) continue;
    if (typeof name !== "string") throw new ApiError(400, `Invalid ${field}`);
    if (field === "project") continue;
    const linked = await ctx.db.prepare("SELECT 1 AS present FROM records WHERE kind = ? AND team_id = ? AND deleted_at IS NULL AND json_extract(value_json, '$.name') = ? LIMIT 1")
      .bind(field, teamId, name).first();
    if (!linked) throw new ApiError(400, `${field} does not belong to this team`);
  }
}

async function resolveProject(ctx: Context, value: Record<string, unknown>, teamId: string | null) {
  const projectId = typeof value.projectId === "string" ? value.projectId : "";
  const name = typeof value.project === "string" ? value.project : "";
  if (!projectId && !name) { value.project = ""; value.projectId = null; return; }
  const row = projectId
    ? await ctx.db.prepare("SELECT p.id, p.value_json FROM records p JOIN project_teams pt ON pt.project_id = p.id WHERE p.kind = 'project' AND p.id = ? AND pt.team_id = ? AND p.deleted_at IS NULL")
      .bind(projectId, teamId).first<{ id: string; value_json: string }>()
    : await ctx.db.prepare("SELECT p.id, p.value_json FROM records p JOIN project_teams pt ON pt.project_id = p.id WHERE p.kind = 'project' AND pt.team_id = ? AND json_extract(p.value_json, '$.name') = ? AND p.deleted_at IS NULL LIMIT 1")
      .bind(teamId, name).first<{ id: string; value_json: string }>();
  if (!row) throw new ApiError(400, "Project does not belong to this team");
  value.projectId = row.id;
  value.project = String(safeParse<Record<string, unknown>>(row.value_json, {}).name || "");
}

function projectTeamIds(ctx: Context, value: Record<string, unknown>, leadTeamId: string | null, existing: string[] = []) {
  const ids = value.teamIds === undefined ? [leadTeamId] : value.teamIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => typeof id !== "string" || !ctx.teams.some(team => team.id === id) || (!existing.includes(id) && !canWriteTeam(ctx, id))))
    throw new ApiError(400, "Choose accessible project teams");
  return [...new Set([leadTeamId, ...ids].filter((id): id is string => typeof id === "string"))];
}

async function validateIssueRelations(ctx: Context, value: Record<string, unknown>, issueId: string, teamId: string | null) {
  const parentId = value.parentId;
  if (parentId !== undefined && parentId !== null && parentId !== "") {
    if (typeof parentId !== "string" || parentId === issueId) throw new ApiError(400, "Invalid parent issue");
    const parent = await ctx.db.prepare("SELECT team_id, value_json FROM records WHERE kind = 'issue' AND id = ? AND deleted_at IS NULL")
      .bind(parentId).first<{ team_id: string; value_json: string }>();
    if (!parent || parent.team_id !== teamId || !canReadTeam(ctx, parent.team_id)) throw new ApiError(400, "Parent issue must be visible in this team");
    let ancestor: string | undefined = parentId;
    const visited = new Set<string>([issueId]);
    while (ancestor) {
      if (visited.has(ancestor)) throw new ApiError(400, "Issue hierarchy cannot contain a cycle");
      visited.add(ancestor);
      const row: { value_json: string } | null = await ctx.db.prepare("SELECT value_json FROM records WHERE kind = 'issue' AND id = ? AND deleted_at IS NULL")
        .bind(ancestor).first<{ value_json: string }>();
      ancestor = safeParse<{ parentId?: string }>(row?.value_json, {}).parentId;
    }
  }
  for (const key of ["relatedIds", "blockedByIds"] as const) {
    const ids = value[key];
    if (ids === undefined) continue;
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== "string" || id === issueId) || new Set(ids).size !== ids.length)
      throw new ApiError(400, `Invalid ${key}`);
    for (const id of ids) {
      const linked = await ctx.db.prepare("SELECT team_id FROM records WHERE kind = 'issue' AND id = ? AND deleted_at IS NULL")
        .bind(id).first<{ team_id: string }>();
      if (!linked || linked.team_id !== teamId || !canReadTeam(ctx, linked.team_id)) throw new ApiError(400, `Related issue ${id} must be in this team`);
    }
  }
}

async function validateIssueMilestone(ctx: Context, value: Record<string, unknown>, teamId: string | null) {
  if (!value.milestoneId) return;
  if (typeof value.milestoneId !== "string" || typeof value.projectId !== "string") throw new ApiError(400, "Choose a project milestone");
  const row = await ctx.db.prepare("SELECT p.value_json FROM records p JOIN project_teams pt ON pt.project_id = p.id WHERE p.kind = 'project' AND p.id = ? AND pt.team_id = ? AND p.deleted_at IS NULL")
    .bind(value.projectId, teamId).first<{ value_json: string }>();
  const project = safeParse<{ milestones?: Array<{ id: string }> }>(row?.value_json, {});
  if (!project.milestones?.some(item => item.id === value.milestoneId)) throw new ApiError(400, "Milestone is unavailable in this project");
}

async function validateProjectDependencies(ctx: Context, value: Record<string, unknown>, projectId: string) {
  const ids = value.blockedByProjectIds;
  if (ids === undefined) return;
  if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== "string" || id === projectId) || new Set(ids).size !== ids.length)
    throw new ApiError(400, "Invalid project dependencies");
  const visited = new Set<string>();
  async function walk(id: string, depth: number) {
    if (id === projectId) throw new ApiError(400, "Project dependencies cannot contain a cycle");
    if (depth > 50 || visited.has(id)) return;
    visited.add(id);
    const row = await ctx.db.prepare("SELECT value_json FROM records WHERE kind = 'project' AND id = ? AND deleted_at IS NULL")
      .bind(id).first<{ value_json: string }>();
    const membership = await ctx.db.prepare("SELECT team_id FROM project_teams WHERE project_id = ?")
      .bind(id).all<{ team_id: string }>();
    if (!row || !membership.results.some(item => item.team_id === value.teamId && canReadTeam(ctx, item.team_id))) throw new ApiError(400, "Blocking project must share this project's lead team");
    for (const child of safeParse<{ blockedByProjectIds?: string[] }>(row.value_json, {}).blockedByProjectIds || []) await walk(child, depth + 1);
  }
  for (const id of ids) await walk(id, 0);
}

async function validateInitiativeParents(ctx: Context, value: Record<string, unknown>, initiativeId: string) {
  const ids = value.parentIds;
  if (ids === undefined) return;
  if (!Array.isArray(ids) || ids.length > 10 || ids.some(id => typeof id !== "string" || id === initiativeId) || new Set(ids).size !== ids.length)
    throw new ApiError(400, "Invalid parent initiatives");
  const visited = new Set<string>();
  async function walk(id: string, depth: number) {
    if (id === initiativeId || depth > 5) throw new ApiError(400, "Initiative hierarchy cannot contain a cycle or exceed five levels");
    if (visited.has(id)) return;
    visited.add(id);
    const row = await ctx.db.prepare("SELECT value_json FROM records WHERE kind = 'initiative' AND id = ? AND deleted_at IS NULL")
      .bind(id).first<{ value_json: string }>();
    if (!row) throw new ApiError(400, "Parent initiative is unavailable");
    for (const parent of safeParse<{ parentIds?: string[] }>(row.value_json, {}).parentIds || []) await walk(parent, depth + 1);
  }
  for (const id of ids) await walk(id, 1);
}

async function validateWorkReferences(ctx: Context, kind: Kind, value: Record<string, unknown>, teamId: string | null) {
  const references: Array<[string, Kind]> = [];
  if (kind === "document") {
    if (value.projectId && !teamId) throw new ApiError(400, "Project documents require a team");
    if (value.projectId) references.push([String(value.projectId), "project"]);
    if (value.initiativeId) references.push([String(value.initiativeId), "initiative"]);
  }
  if (kind === "customerRequest") {
    if (value.customerId) references.push([String(value.customerId), "customer"]);
    if (value.issueId) references.push([String(value.issueId), "issue"]);
    if (value.projectId) references.push([String(value.projectId), "project"]);
    if (!value.issueId && !value.projectId) throw new ApiError(400, "Link a customer request to an issue or project");
  }
  if (kind === "release") {
    references.push([String(value.pipelineId || ""), "releasePipeline"]);
    for (const id of value.issueIds as string[] || []) references.push([id, "issue"]);
  }
  for (const [id, targetKind] of references) {
    if (!id) throw new ApiError(400, `Missing ${targetKind} reference`);
    const linked = await ctx.db.prepare("SELECT team_id FROM records WHERE kind = ? AND id = ? AND deleted_at IS NULL")
      .bind(targetKind, id).first<{ team_id: string | null }>();
    if (!linked || !canReadTeam(ctx, linked.team_id)) throw new ApiError(400, `${targetKind} is unavailable`);
    if (teamId && linked.team_id && linked.team_id !== teamId && targetKind !== "project") throw new ApiError(400, `${targetKind} belongs to another team`);
    if (targetKind === "project" && teamId) {
      const membership = await ctx.db.prepare("SELECT 1 AS present FROM project_teams WHERE project_id = ? AND team_id = ?")
        .bind(id, teamId).first();
      if (!membership) throw new ApiError(400, "Project is unavailable to this team");
    }
  }
}

async function notify(ctx: Context, userId: string | null, issue: Record<string, unknown>, message: string) {
  if (!userId || userId === ctx.user.userId) return;
  const teamId = typeof issue.teamId === "string" ? issue.teamId : null;
  if (teamId) {
    const team = ctx.teams.find(item => item.id === teamId);
    const recipient = await ctx.db.prepare("SELECT role, status FROM members WHERE user_id = ?").bind(userId).first<{ role: string; status: string }>();
    if (!team || !recipient || recipient.status !== "active") return;
    const membership = await ctx.db.prepare("SELECT 1 AS present FROM team_members WHERE team_id = ? AND user_id = ?").bind(teamId, userId).first();
    const parentMembership = team.parent_id && await ctx.db.prepare("SELECT 1 AS present FROM team_members WHERE team_id = ? AND user_id = ?").bind(team.parent_id, userId).first();
    if (!membership && !(team.visibility === "public" && recipient.role !== "guest") && !(team.visibility === "restricted" && parentMembership && recipient.role !== "guest")) return;
  }
  const id = crypto.randomUUID();
  const stamp = now();
  const value = { id, issue: String(issue.id), text: message, time: "Now", read: false, createdAt: stamp };
  await ctx.db.prepare("INSERT INTO records (kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at) VALUES ('notification', ?, ?, ?, ?, 1, ?, ?)")
    .bind(id, issue.teamId || null, userId, JSON.stringify(value), stamp, stamp).run();
}

async function issueEvent(ctx: Context, issueId: string, teamId: string, action: string, details: Record<string, unknown> = {}) {
  await ctx.db.prepare("INSERT INTO issue_events (id, issue_id, team_id, actor_user_id, action, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), issueId, teamId, ctx.user.userId, action, JSON.stringify(details), now()).run();
}

function issueChanges(before: Record<string, unknown>, after: Record<string, unknown>, patch: Record<string, unknown>) {
  const summarized = (value: unknown) => Array.isArray(value) ? value.join(", ").slice(0, 240) :
    value === null || value === undefined || value === "" ? "None" : String(value).slice(0, 240);
  return Object.keys(patch)
    .filter(field => field !== "assigneeId" && field !== "projectId" && JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map(field => field === "description" ? { field } :
      { field, from: summarized(before[field]), to: summarized(after[field]) });
}

async function dispatchIssueSync(ctx: Context, issue: Record<string, unknown>, action: "create" | "update" | "comment", detail: string, commentId?: string) {
  const work = syncIssueOutbound(ctx.db, issue, action, new URL(ctx.request.url).origin, detail, commentId)
    .catch(error => console.error("Issue integration sync failed", error));
  const execution = getRequestExecutionContext();
  if (execution) execution.waitUntil(work); else await work;
}

async function subscribe(ctx: Context, issueId: string, userId: string | null) {
  if (!userId) return;
  await ctx.db.prepare("INSERT OR IGNORE INTO issue_subscriptions (issue_id, user_id, created_at) VALUES (?, ?, ?)")
    .bind(issueId, userId, now()).run();
}

async function authorize(ctx: Context, row: RecordRow, write = false) {
  if (row.kind === "dashboard") {
    const value = safeParse<{ visibility?: string }>(row.value_json, {});
    if (ctx.member.role === "guest" || value.visibility !== "workspace" && row.owner_user_id !== ctx.user.userId || write && row.owner_user_id !== ctx.user.userId && ctx.member.role !== "owner")
      throw new ApiError(403, "Dashboard access denied");
    return;
  }
  if (row.kind === "notification" || (row.kind === "view" && row.owner_user_id)) {
    if (row.owner_user_id !== ctx.user.userId) throw new ApiError(403, "Access denied");
    return;
  }
  if (row.kind === "project") {
    const teams = (await ctx.db.prepare("SELECT team_id FROM project_teams WHERE project_id = ?").bind(row.id).all<{ team_id: string }>()).results;
    if (teams.some(team => write ? canWriteTeam(ctx, team.team_id) : canReadTeam(ctx, team.team_id))) return;
  }
  if (write ? !canWriteTeam(ctx, row.team_id) : !canReadTeam(ctx, row.team_id))
    throw new ApiError(403, "Team access denied");
}

function validate(kind: Kind, value: Record<string, unknown>) {
  const title = kind === "issue" || kind === "request" || kind === "customerRequest" ? value.title : value.name;
  if (kind !== "notification" && (typeof title !== "string" || !title.trim() || title.length > 180))
    throw new ApiError(400, "A valid name is required");
  for (const field of ["description", "assignee", "project", "cycle", "lead", "owner", "target"]) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || value[field].length > (field === "description" ? 50_000 : 180)))
      throw new ApiError(400, `Invalid ${field}`);
  }
  if (kind === "issue") {
    if (value.assigneeId !== undefined && value.assigneeId !== null && (typeof value.assigneeId !== "string" || value.assigneeId.length > 100))
      throw new ApiError(400, "Invalid assignee ID");
    if (typeof value.status !== "string") throw new ApiError(400, "Invalid issue status");
    if (!priorityOptions.has(String(value.priority))) throw new ApiError(400, "Invalid issue priority");
    if (!Array.isArray(value.labels) || value.labels.length > 30 || value.labels.some(label => typeof label !== "string" || label.length > 40))
      throw new ApiError(400, "Invalid labels");
    for (const field of ["dueDate", "startDate"]) {
      if (value[field] !== undefined && value[field] !== "" && (typeof value[field] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value[field])))
        throw new ApiError(400, `Invalid ${field}`);
    }
    if (value.estimate !== undefined && value.estimate !== null && (!Number.isInteger(value.estimate) || Number(value.estimate) < 0 || Number(value.estimate) > 1000))
      throw new ApiError(400, "Invalid estimate");
  }
  if (kind === "project") {
    if (!["Planned", "In Progress", "Completed", "Canceled"].includes(String(value.status))) throw new ApiError(400, "Invalid project status");
    if (value.color !== undefined && (typeof value.color !== "string" || !/^#[0-9a-f]{6}$/i.test(value.color))) throw new ApiError(400, "Invalid project color");
    if (value.icon !== undefined && (typeof value.icon !== "string" || value.icon.length > 4)) throw new ApiError(400, "Invalid project icon");
    if (value.initiativeId !== undefined && (typeof value.initiativeId !== "string" || value.initiativeId.length > 100)) throw new ApiError(400, "Invalid initiative");
    if (value.priority !== undefined && !priorityOptions.has(String(value.priority))) throw new ApiError(400, "Invalid project priority");
    if (value.startDate !== undefined && value.startDate !== "" && (typeof value.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.startDate))) throw new ApiError(400, "Invalid project start date");
    if (value.labels !== undefined && (!Array.isArray(value.labels) || value.labels.length > 30 || value.labels.some(label => typeof label !== "string" || label.length > 40))) throw new ApiError(400, "Invalid project labels");
    if (value.memberIds !== undefined && (!Array.isArray(value.memberIds) || value.memberIds.length > 100 || value.memberIds.some(id => typeof id !== "string"))) throw new ApiError(400, "Invalid project members");
    if (value.milestones !== undefined && (!Array.isArray(value.milestones) || value.milestones.length > 100 || value.milestones.some(item => !item || typeof item !== "object" || typeof item.id !== "string" || typeof item.name !== "string" || item.name.length > 180 || item.targetDate !== undefined && item.targetDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(item.targetDate))))) throw new ApiError(400, "Invalid milestones");
    if (value.updates !== undefined && (!Array.isArray(value.updates) || value.updates.length > 200 || value.updates.some(item => !item || typeof item !== "object" || typeof item.id !== "string" || typeof item.text !== "string" || item.text.length > 10000))) throw new ApiError(400, "Invalid project updates");
    if (value.blockedByProjectIds !== undefined && (!Array.isArray(value.blockedByProjectIds) || value.blockedByProjectIds.length > 50)) throw new ApiError(400, "Invalid project dependencies");
  }
  if (kind === "initiative" && !["Planned", "In Progress", "Completed", "Canceled"].includes(String(value.status)))
    throw new ApiError(400, "Invalid initiative status");
  if (kind === "request" && !["New", "Accepted", "Declined"].includes(String(value.status)))
    throw new ApiError(400, "Invalid request status");
  if (kind === "cycle" && (typeof value.start !== "string" || typeof value.end !== "string" || value.end < value.start))
    throw new ApiError(400, "Invalid cycle dates");
  if (kind === "view") {
    if (value.type !== undefined && !["priority", "unassigned", "active", "custom"].includes(String(value.type))) throw new ApiError(400, "Invalid view filter");
    if (value.entity !== undefined && !["issue", "project", "initiative"].includes(String(value.entity))) throw new ApiError(400, "Invalid view entity");
    if (value.scope !== undefined && !["personal", "team", "workspace"].includes(String(value.scope))) throw new ApiError(400, "Invalid view scope");
    if (value.filters !== undefined && (!Array.isArray(value.filters) || value.filters.length > 20 || value.filters.some(filter => !filter || typeof filter !== "object" || typeof filter.field !== "string" || !["status", "priority", "assignee", "project", "cycle", "labels", "teamId", "lead", "initiativeId"].includes(filter.field) || !["is", "isNot", "contains"].includes(String(filter.op)) || typeof filter.value !== "string" || filter.value.length > 180))) throw new ApiError(400, "Invalid view filters");
  }
  if (kind === "notification" && typeof value.read !== "boolean") throw new ApiError(400, "Invalid notification state");
  if (kind === "dashboard") {
    if (!["private", "workspace"].includes(String(value.visibility))) throw new ApiError(400, "Invalid dashboard visibility");
    if (!Array.isArray(value.blocks) || value.blocks.length > 12 || value.blocks.some(block => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return true;
      const item = block as Record<string, unknown>;
      return typeof item.id !== "string" || item.id.length > 100 || typeof item.title !== "string" || item.title.length > 100 || !["metric", "chart", "table"].includes(String(item.type)) || item.metric !== undefined && !["issues", "projects", "completed", "active", "backlog", "cycles"].includes(String(item.metric)) || item.groupBy !== undefined && !["status", "priority", "team", "project"].includes(String(item.groupBy));
    })) throw new ApiError(400, "Invalid dashboard blocks");
    const filters = value.filters;
    if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new ApiError(400, "Invalid dashboard filters");
    const settings = filters as Record<string, unknown>;
    for (const key of ["teamIds", "statuses", "priorities"]) {
      const items = settings[key];
      if (!Array.isArray(items) || items.length > 30 || items.some(item => typeof item !== "string" || item.length > 100)) throw new ApiError(400, "Invalid dashboard filters");
    }
  }
  if (kind === "document" && (typeof value.content !== "string" || value.content.length > 100_000)) throw new ApiError(400, "Invalid document content");
  if (kind === "customer") {
    if (value.domain !== undefined && (typeof value.domain !== "string" || value.domain.length > 253)) throw new ApiError(400, "Invalid customer domain");
    if (value.revenue !== undefined && (!Number.isFinite(value.revenue) || Number(value.revenue) < 0)) throw new ApiError(400, "Invalid customer revenue");
  }
  if (kind === "customerRequest" && (!value.customerId || typeof value.customerId !== "string")) throw new ApiError(400, "Choose a customer");
  if (kind === "releasePipeline" && (!["continuous", "scheduled"].includes(String(value.type)) || !Array.isArray(value.teamIds) || value.teamIds.length !== 1 || value.teamIds[0] !== value.teamId || value.branch !== undefined && (typeof value.branch !== "string" || value.branch.length > 100))) throw new ApiError(400, "Invalid release pipeline");
  if (kind === "release" && (typeof value.pipelineId !== "string" || !["planned", "inProgress", "completed", "canceled"].includes(String(value.status)) || !Array.isArray(value.issueIds) || value.issueIds.length > 500 || value.issueIds.some(id => typeof id !== "string"))) throw new ApiError(400, "Invalid release");
  if (kind === "issueTemplate" && (typeof value.title !== "string" || value.title.length > 180 || typeof value.status !== "string" || !priorityOptions.has(String(value.priority)) || !Array.isArray(value.labels) || value.labels.some(label => typeof label !== "string" || label.length > 40))) throw new ApiError(400, "Invalid issue template");
  if (JSON.stringify(value).length > 100_000) throw new ApiError(413, "Record is too large");
}

function sanitizePatch(kind: Kind, patch: unknown) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ApiError(400, "Invalid update");
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (kind === "issue" && key === "source") throw new ApiError(400, "Source cannot be changed");
    if (!allowedFields[kind].has(key)) throw new ApiError(400, `Cannot update ${key}`);
    clean[key] = value;
  }
  return clean;
}

async function updateRow(ctx: Context, row: RecordRow, value: Record<string, unknown>, expectedVersion: number) {
  validate(row.kind, value);
  const result = await ctx.db.prepare("UPDATE records SET value_json = ?, version = version + 1, updated_at = ? WHERE kind = ? AND id = ? AND version = ?")
    .bind(JSON.stringify(value), now(), row.kind, row.id, expectedVersion).run();
  if (!result.meta.changes) throw new ApiError(409, "This record changed elsewhere. Refresh and try again.");
  return { ...value, _version: expectedVersion + 1 };
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext(request);
    return await mutateRecord(ctx, await request.json() as Record<string, unknown>);
  } catch (error) { return errorResponse(error); }
}

// MCP and the browser use the same mutation path, including authorization, auditing,
// version checks, notifications, and outbound integration sync.
export async function mutateRecord(ctx: Context, body: Record<string, unknown>): Promise<Response> {
    const action = String(body.action || "");
    const kind = body.kind as Kind;
    const recordId = String(body.id || "");
    if (!kinds.has(kind)) throw new ApiError(400, "Invalid record type");
    if (kind === "request") throw new ApiError(410, "Requests are now issues in Triage");
    if (ctx.member.role === "guest" && ["cycle", "view", "initiative", "document", "customer", "customerRequest", "releasePipeline", "release", "issueTemplate"].includes(kind)) throw new ApiError(403, "Guest access is limited to team issues and projects");

    if (action === "create") {
      if (kind === "cycle") throw new ApiError(403, "Cycles are generated from the team schedule");
      if (kind === "notification") throw new ApiError(403, "Notifications cannot be created by clients");
      if (ctx.member.role === "guest" && ["initiative", "request", "view", "dashboard"].includes(kind)) throw new ApiError(403, "Guests cannot create this workspace record");
      const teamId = ["initiative", "dashboard", "customer"].includes(kind) || (kind === "view" && (body.personal === true || body.workspace === true)) || (kind === "document" && !body.teamId) ? null : String(body.teamId || "engineering");
      if (kind === "view" && !teamId && ctx.member.role === "guest") throw new ApiError(403, "Guests cannot create workspace views");
      if (teamId && !canWriteTeam(ctx, teamId)) throw new ApiError(403, "Team access denied");
      const input = body.value;
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "Invalid record");
      const value = Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([field]) => allowedFields[kind].has(field)));
      if ((kind === "issue" || kind === "issueTemplate") && !value.status) value.status = (await defaultStatusForTeam(ctx.db, teamId!))?.name;
      let id = crypto.randomUUID();
      let newAssignee: Awaited<ReturnType<typeof resolveAssignee>> = null;
      if (kind === "issue") {
        const team = ctx.teams.find(item => item.id === teamId);
        if (!team) throw new ApiError(404, "Team not found");
        if ((value.status === "Triage" || value.source === "Ask") && !team.triage_enabled) throw new ApiError(400, "Triage is not enabled for this team");
        newAssignee = await resolveAssignee(ctx, value.assigneeId || value.assignee, teamId);
        value.assignee = newAssignee?.display_name || "";
        value.assigneeId = newAssignee?.user_id || null;
        await validateIssueLinks(ctx, value, teamId, ["project", "cycle"]);
        await resolveProject(ctx, value, teamId);
        await validateIssueMilestone(ctx, value, teamId);
        const counter = await ctx.db.prepare("UPDATE team_counters SET next_issue_number = next_issue_number + 1 WHERE team_id = ? RETURNING next_issue_number")
          .bind(teamId).first<{ next_issue_number: number }>();
        if (!counter) throw new ApiError(500, "Issue counter unavailable");
        id = `${team.key}-${counter.next_issue_number - 1}`;
        await validateIssueRelations(ctx, value, id, teamId);
        value.created = new Date().toISOString().slice(0, 10);
        value.createdBy = ctx.user.displayName;
        value.createdById = ctx.user.userId;
        value.comments = [];
        if (value.source === "Ask") {
          value.requesterId = ctx.user.userId;
          value.requesterName = ctx.user.displayName;
          value.status = "Triage";
          value.labels = [...new Set([...(Array.isArray(value.labels) ? value.labels : []), "Request"])];
        } else delete value.source;
      }
      value.id = id;
      value.teamId = teamId;
      if (kind === "dashboard") {
        value.visibility = value.visibility === "workspace" ? "workspace" : "private";
        value.blocks = Array.isArray(value.blocks) ? value.blocks : [];
        value.filters = value.filters && typeof value.filters === "object" ? value.filters : { teamIds: [], statuses: [], priorities: [] };
      }
      if (kind === "project") value.teamIds = projectTeamIds(ctx, value, teamId);
      if (kind === "project" && value.initiativeId) {
        const initiative = await ctx.db.prepare("SELECT 1 AS present FROM records WHERE kind = 'initiative' AND id = ?").bind(value.initiativeId).first();
        if (!initiative) throw new ApiError(400, "Initiative not found");
      }
      validate(kind, value);
      if (kind === "issue" || kind === "issueTemplate") await validateTeamStatus(ctx, kind, teamId, value.status);
      if (kind === "project") await validateProjectDependencies(ctx, value, id);
      if (kind === "initiative") await validateInitiativeParents(ctx, value, id);
      if (kind === "releasePipeline" && (value.teamIds as string[]).some(id => !canWriteTeam(ctx, id))) throw new ApiError(403, "Release pipeline team access required");
      if (["document", "customerRequest", "release"].includes(kind)) await validateWorkReferences(ctx, kind, value, teamId);
      const ownerId = kind === "dashboard" || kind === "view" && body.personal === true ? ctx.user.userId : null;
      await ctx.db.prepare("INSERT INTO records (kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
        .bind(kind, id, teamId, ownerId, JSON.stringify(value), now(), now()).run();
      if (kind === "project") await ctx.db.batch((value.teamIds as string[]).map(team => ctx.db.prepare("INSERT INTO project_teams (project_id, team_id) VALUES (?, ?)").bind(id, team)));
      await audit(ctx, `${kind}.create`, kind, id, { teamId });
      if (kind === "issue") {
        await issueEvent(ctx, id, teamId!, "create", { title: value.title, status: value.status });
        await subscribe(ctx, id, ctx.user.userId);
        if (newAssignee) { await subscribe(ctx, id, newAssignee.user_id); await notify(ctx, newAssignee.user_id, value, `${ctx.user.displayName} assigned you to ${String(value.title)}`); }
        await dispatchIssueSync(ctx, value, "create", "");
      }
      return json({ record: { ...value, _version: 1 } }, 201);
    }

    if (action === "read-all" && kind === "notification") {
      const rows = (await ctx.db.prepare("SELECT kind, id, team_id, owner_user_id, value_json, version, deleted_at FROM records WHERE kind = 'notification' AND owner_user_id = ? AND deleted_at IS NULL").bind(ctx.user.userId).all<RecordRow>()).results;
      const statements = rows.filter(row => !safeParse<Record<string, unknown>>(row.value_json, {}).read).map(row => {
        const value = { ...safeParse<Record<string, unknown>>(row.value_json, {}), read: true };
        return ctx.db.prepare("UPDATE records SET value_json = ?, version = version + 1, updated_at = ? WHERE kind = ? AND id = ?").bind(JSON.stringify(value), now(), "notification", row.id);
      });
      if (statements.length) await ctx.db.batch(statements);
      return json({ updated: statements.length });
    }

    if (!recordId) throw new ApiError(400, "Record ID required");
    const row = await findRecord(ctx, kind, recordId);
    if (row.deleted_at && action !== "restore") throw new ApiError(404, "Record is in Recently deleted");
    await authorize(ctx, row, !["read", "subscribe", "unsubscribe"].includes(action));
    const current = safeParse<Record<string, unknown>>(row.value_json, {});
    if (kind === "issue" && action === "triage") {
      if (current.status !== "Triage") throw new ApiError(409, "Issue is not in Triage");
      const decision = String(body.decision);
      if (!["accept", "decline", "snooze", "duplicate"].includes(decision)) throw new ApiError(400, "Invalid triage action");
      const next: Record<string, unknown> = { ...current, triagedBy: ctx.user.displayName, triagedAt: now() };
      if (decision === "accept") next.status = (await firstStatusInCategory(ctx.db, row.team_id!, "unstarted") || await defaultStatusForTeam(ctx.db, row.team_id!))?.name;
      if (decision === "decline" || decision === "duplicate") next.status = (await firstStatusInCategory(ctx.db, row.team_id!, decision === "duplicate" ? "duplicate" : "canceled"))?.name;
      if (!next.status) throw new ApiError(409, "Configure a workflow status for this triage action");
      if (decision === "snooze") {
        const until = new Date(String(body.until || ""));
        if (!Number.isFinite(until.valueOf()) || until.valueOf() <= Date.now() || until.valueOf() > Date.now() + 365 * 86400000) throw new ApiError(400, "Choose a future snooze date");
        next.triageSnoozedUntil = until.toISOString();
      }
      if (decision === "duplicate") {
        const duplicateOf = String(body.duplicateOf || "");
        const linked = await ctx.db.prepare("SELECT team_id FROM records WHERE kind = 'issue' AND id = ? AND deleted_at IS NULL").bind(duplicateOf).first<{ team_id: string }>();
        if (!linked || !canReadTeam(ctx, linked.team_id)) throw new ApiError(400, "Choose a visible duplicate issue");
        next.duplicateOf = duplicateOf;
      }
      const record = await updateRow(ctx, row, next, row.version);
      await issueEvent(ctx, row.id, row.team_id!, `triage:${decision}`, { from: current.status, to: next.status, duplicateOf: next.duplicateOf });
      await audit(ctx, `issue.triage.${decision}`, "issue", row.id);
      await dispatchIssueSync(ctx, next, "update", "Status: " + String(next.status));
      return json({ record });
    }
    if (kind === "issue" && ["subscribe", "unsubscribe"].includes(action)) {
      if (action === "subscribe") await subscribe(ctx, row.id, ctx.user.userId);
      else await ctx.db.prepare("DELETE FROM issue_subscriptions WHERE issue_id = ? AND user_id = ?").bind(row.id, ctx.user.userId).run();
      await audit(ctx, `issue.${action}`, "issue", row.id);
      return json({ subscribed: action === "subscribe" });
    }
    const expectedVersion = Number(body.expectedVersion);
    if (["update", "comment", "comment.edit", "comment.delete", "comment.react", "comment.resolve", "delete"].includes(action) && expectedVersion !== row.version)
      throw new ApiError(409, "This record changed elsewhere. Refresh and try again.");

    if (action === "update") {
      const patch = sanitizePatch(kind, body.patch);
      const value: Record<string, unknown> = { ...current, ...patch, id: row.id, teamId: row.team_id };
      if (kind === "project" && patch.initiativeId) {
        const initiative = await ctx.db.prepare("SELECT 1 AS present FROM records WHERE kind = 'initiative' AND id = ?").bind(patch.initiativeId).first();
        if (!initiative) throw new ApiError(400, "Initiative not found");
      }
      if (kind === "issue") {
        await validateIssueLinks(ctx, value, row.team_id, ["project", "cycle"].filter(field => field in patch) as Array<"project" | "cycle">);
        if ("project" in patch || "projectId" in patch) {
          if ("project" in patch && !("projectId" in patch)) value.projectId = null;
          await resolveProject(ctx, value, row.team_id);
          if (value.milestoneId && value.projectId !== current.projectId && !("milestoneId" in patch)) value.milestoneId = "";
        }
        if (["milestoneId", "project", "projectId"].some(field => field in patch)) await validateIssueMilestone(ctx, value, row.team_id);
        if (["parentId", "relatedIds", "blockedByIds"].some(field => field in patch)) await validateIssueRelations(ctx, value, row.id, row.team_id);
      }
      if (kind === "project") {
        const existing = (await ctx.db.prepare("SELECT team_id FROM project_teams WHERE project_id = ?").bind(row.id).all<{ team_id: string }>()).results.map(item => item.team_id);
        value.teamIds = projectTeamIds(ctx, value, row.team_id, existing);
        if ("blockedByProjectIds" in patch) await validateProjectDependencies(ctx, value, row.id);
      }
      if (kind === "initiative" && "parentIds" in patch) await validateInitiativeParents(ctx, value, row.id);
      if (["document", "customer", "customerRequest", "releasePipeline", "release"].includes(kind)) validate(kind, value);
      if (kind === "releasePipeline" && Array.isArray(value.teamIds) && value.teamIds.some(id => !canWriteTeam(ctx, id))) throw new ApiError(403, "Release pipeline team access required");
      if (["document", "customerRequest", "release"].includes(kind)) await validateWorkReferences(ctx, kind, value, row.team_id);
      if (kind === "issue" && patch.status === "Triage" && !ctx.teams.find(team => team.id === row.team_id)?.triage_enabled) throw new ApiError(400, "Triage is not enabled for this team");
      if ((kind === "issue" || kind === "issueTemplate") && "status" in patch) await validateTeamStatus(ctx, kind, row.team_id, value.status);
      const assignee = kind === "issue" && (patch.assignee !== undefined || patch.assigneeId !== undefined)
        ? await resolveAssignee(ctx, patch.assigneeId || patch.assignee, row.team_id)
        : null;
      if (kind === "issue" && (patch.assignee !== undefined || patch.assigneeId !== undefined)) {
        value.assignee = assignee?.display_name || "";
        value.assigneeId = assignee?.user_id || null;
      }
      const updated = await updateRow(ctx, row, value, row.version);
      if (kind === "project" && "teamIds" in patch) {
        await ctx.db.batch([
          ctx.db.prepare("DELETE FROM project_teams WHERE project_id = ?").bind(row.id),
          ...(value.teamIds as string[]).map(team => ctx.db.prepare("INSERT INTO project_teams (project_id, team_id) VALUES (?, ?)").bind(row.id, team)),
        ]);
      }
      if (kind === "project" && patch.name && patch.name !== current.name) {
        await ctx.db.prepare("UPDATE records SET value_json = json_set(value_json, '$.project', ?), version = version + 1, updated_at = ? WHERE kind = 'issue' AND deleted_at IS NULL AND json_extract(value_json, '$.projectId') = ?")
          .bind(String(patch.name), now(), row.id).run();
      }
      await audit(ctx, `${kind}.update`, kind, row.id, { fields: Object.keys(patch) });
      if (kind === "issue") {
        await issueEvent(ctx, row.id, row.team_id!, "update", { changes: issueChanges(current, value, patch) });
        if (assignee && assignee.user_id !== current.assigneeId) { await subscribe(ctx, row.id, assignee.user_id); await notify(ctx, assignee.user_id, value, `${ctx.user.displayName} assigned you to ${String(value.title)}`); }
        await dispatchIssueSync(ctx, value, "update", Object.keys(patch).join(", "));
      }
      return json({ record: updated });
    }
    if (action === "comment" && kind === "issue") {
      const text = String(body.text || "").trim();
      if (!text || text.length > 10_000) throw new ApiError(400, "Invalid comment");
      const comments = Array.isArray(current.comments) ? (current.comments as Array<Record<string, unknown>>).map((item, index): Record<string, unknown> => ({ ...item, id: item.id || `legacy-${index}` })) : [];
      const requestedParent = body.parentId === undefined ? "" : String(body.parentId);
      const parent = requestedParent ? comments.find(item => item.id === requestedParent && !item.deletedAt) : null;
      if (requestedParent && !parent) throw new ApiError(404, "Parent comment not found");
      const parentId = parent ? String(parent.parentId || parent.id) : null;
      const comment = { id: crypto.randomUUID(), by: ctx.user.displayName, userId: ctx.user.userId, text, date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }), createdAt: now(), parentId, reactions: [] };
      const updated = await updateRow(ctx, row, { ...current, comments: [...comments, comment] }, row.version);
      await audit(ctx, parentId ? "issue.comment.reply" : "issue.comment", kind, row.id, { commentId: comment.id, parentId });
      await issueEvent(ctx, row.id, row.team_id!, parentId ? "comment.reply" : "comment", { commentId: comment.id, parentId });
      await subscribe(ctx, row.id, ctx.user.userId);
      const subscribers = (await ctx.db.prepare("SELECT s.user_id FROM issue_subscriptions s JOIN members m ON m.user_id = s.user_id WHERE s.issue_id = ? AND m.status = 'active'")
        .bind(row.id).all<{ user_id: string }>()).results.map(item => item.user_id);
      if (typeof current.assigneeId === "string") subscribers.push(current.assigneeId);
      if (parentId) for (const item of comments) if ((item.id === parentId || item.parentId === parentId) && typeof item.userId === "string") subscribers.push(item.userId);
      await Promise.all([...new Set(subscribers)].map(userId => notify(ctx, userId, current, `${ctx.user.displayName} ${parentId ? "replied to a thread" : "commented"} on ${String(current.title)}`)));
      await dispatchIssueSync(ctx, current, "comment", text, comment.id);
      return json({ record: updated });
    }
    if (kind === "issue" && ["comment.edit", "comment.delete", "comment.react", "comment.resolve"].includes(action)) {
      const comments = Array.isArray(current.comments) ? (current.comments as Array<Record<string, unknown>>).map((item, index): Record<string, unknown> => ({ ...item, id: item.id || `legacy-${index}` })) : [];
      const commentId = String(body.commentId || "");
      const index = comments.findIndex(item => item.id === commentId);
      if (index < 0) throw new ApiError(404, "Comment not found");
      const target = comments[index];
      if (target.deletedAt) throw new ApiError(409, "Comment was deleted");
      let change: Record<string, unknown> = {};
      if (action === "comment.edit" || action === "comment.delete") {
        if (target.userId !== ctx.user.userId) throw new ApiError(403, "Only the author can change this comment");
        if (action === "comment.edit") {
          const text = String(body.text || "").trim();
          if (!text || text.length > 10_000) throw new ApiError(400, "Invalid comment");
          change = { text, editedAt: now() };
        } else change = { text: "", deletedAt: now(), reactions: [] };
      } else if (action === "comment.react") {
        const emoji = String(body.emoji || "").trim();
        if (emoji.length > 16 || !/\p{Extended_Pictographic}/u.test(emoji) || /[<>\r\n]/.test(emoji)) throw new ApiError(400, "Choose an emoji reaction");
        const reactions = Array.isArray(target.reactions) ? target.reactions as Array<{ emoji: string; userIds: string[] }> : [];
        const previous = reactions.find(item => item.emoji === emoji);
        const userIds = Array.isArray(previous?.userIds) ? previous.userIds.filter(id => id !== ctx.user.userId) : [];
        const reacted = !previous?.userIds?.includes(ctx.user.userId);
        if (reacted) userIds.push(ctx.user.userId);
        change = { reactions: [...reactions.filter(item => item.emoji !== emoji), ...(userIds.length ? [{ emoji, userIds }] : [])] };
      } else {
        if (target.parentId) throw new ApiError(400, "Resolve the parent thread");
        if (typeof body.resolved !== "boolean") throw new ApiError(400, "Invalid thread state");
        change = { resolvedAt: body.resolved ? now() : null, resolvedById: body.resolved ? ctx.user.userId : null };
      }
      const next = [...comments];
      next[index] = { ...target, ...change };
      const updated = await updateRow(ctx, row, { ...current, comments: next }, row.version);
      await audit(ctx, `issue.${action}`, kind, row.id, { commentId });
      await issueEvent(ctx, row.id, row.team_id!, action, { commentId, ...(action === "comment.resolve" ? { resolved: body.resolved } : {}) });
      return json({ record: updated });
    }
    if (action === "delete") {
      if (kind === "notification") throw new ApiError(403, "Notifications cannot be deleted");
      const result = await ctx.db.prepare("UPDATE records SET deleted_at = ?, version = version + 1, updated_at = ? WHERE kind = ? AND id = ? AND version = ? AND deleted_at IS NULL")
        .bind(now(), now(), kind, row.id, row.version).run();
      if (!result.meta.changes) throw new ApiError(409, "This record changed elsewhere. Refresh and try again.");
      await audit(ctx, `${kind}.delete`, kind, row.id);
      if (kind === "issue") await issueEvent(ctx, row.id, row.team_id!, "delete");
      return json({ deleted: true, recoverableUntil: new Date(Date.now() + 30 * 86400000).toISOString() });
    }
    if (action === "restore") {
      if (!row.deleted_at) throw new ApiError(409, "Record is not deleted");
      if (Date.parse(row.deleted_at) < Date.now() - 30 * 86400000) throw new ApiError(410, "Recovery period has ended");
      const result = await ctx.db.prepare("UPDATE records SET deleted_at = NULL, version = version + 1, updated_at = ? WHERE kind = ? AND id = ? AND version = ? AND deleted_at IS NOT NULL")
        .bind(now(), kind, row.id, row.version).run();
      if (!result.meta.changes) throw new ApiError(409, "This record changed elsewhere. Refresh and try again.");
      await audit(ctx, `${kind}.restore`, kind, row.id);
      if (kind === "issue") await issueEvent(ctx, row.id, row.team_id!, "restore");
      return json({ record: { ...current, _version: row.version + 1 } });
    }
    throw new ApiError(400, "Unsupported action");
}
