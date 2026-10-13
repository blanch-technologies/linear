import { ApiError, canReadTeam, requireContext, safeParse, type Context } from "./workspace-server";
import { mutateRecord } from "../app/api/records/route";
import { listIssueStatuses } from "./issue-workflow";
import { readIssueActivity } from "./issue-activity";

type Json = Record<string, unknown>;
type Kind = "issue" | "project" | "initiative" | "cycle" | "document" | "customer" | "customerRequest" | "releasePipeline" | "release" | "issueTemplate";
type Row = { kind: Kind; id: string; team_id: string | null; owner_user_id: string | null; value_json: string; version: number; created_at: string; updated_at: string };
type Tool = { name: string; description: string; inputSchema: Json; annotations?: Json };

const object = (properties: Json, required: string[] = []): Json => ({ type: "object", properties, required, additionalProperties: false });
const string = (description: string): Json => ({ type: "string", description });
const limit = { type: "integer", minimum: 1, maximum: 100, description: "Maximum results, 1 to 100 (default 50)" };
const cursor = string("Offset cursor returned by a previous list call");
const id = string("Record ID, such as ENG-123, a UUID, or a URL from this workspace");
const status = string("Team workflow status name. Use a status configured for the issue's team.");
const priority = { type: "string", enum: ["Urgent", "High", "Medium", "Low", "No priority"] };
const planningStatus = { type: "string", enum: ["Planned", "In Progress", "Completed", "Canceled"] };
const strings = { type: "array", items: { type: "string" } };
const issueFields = { title: string("Issue title"), description: string("Markdown description"), status, priority, assigneeId: string("Workspace member ID"), projectId: string("Project ID"), cycle: string("Cycle name"), labels: strings, dueDate: string("Due date, YYYY-MM-DD"), startDate: string("Start date, YYYY-MM-DD"), estimate: { type: "integer", minimum: 0, maximum: 1000 }, parentId: string("Parent issue ID"), relatedIds: strings, blockedByIds: strings, milestoneId: string("Project milestone ID") };
const projectFields = { name: string("Project name"), description: string("Markdown description"), status: planningStatus, lead: string("Project lead"), target: string("Target date"), initiativeId: string("Initiative ID"), teamIds: strings, priority, startDate: string("Start date, YYYY-MM-DD"), labels: strings, memberIds: strings, blockedByProjectIds: strings };
const initiativeFields = { name: string("Initiative name"), description: string("Markdown description"), status: planningStatus, owner: string("Initiative owner"), target: string("Target date"), parentIds: strings };
const documentFields = { name: string("Document title"), content: string("Document content"), projectId: string("Linked project ID"), initiativeId: string("Linked initiative ID") };
const customerFields = { name: string("Customer name"), domain: string("Customer domain"), tier: string("Customer tier"), status: string("Customer status"), revenue: { type: "number", minimum: 0 }, notes: string("Notes") };
const customerRequestFields = { title: string("Request summary"), description: string("Request details"), customerId: string("Customer ID"), issueId: string("Linked issue ID"), projectId: string("Linked project ID"), source: string("Source"), requester: string("Requester") };
const releasePipelineFields = { name: string("Pipeline name"), description: string("Description"), type: { type: "string", enum: ["continuous", "scheduled"] }, environment: string("Environment"), branch: string("Connected GitHub branch") };
const releaseFields = { name: string("Release name"), pipelineId: string("Pipeline ID"), status: { type: "string", enum: ["planned", "inProgress", "completed", "canceled"] }, date: string("Release date, YYYY-MM-DD"), commitSha: string("Git commit SHA"), issueIds: strings, notes: string("Release notes") };
const issueTemplateFields = { name: string("Template name"), title: string("Default issue title"), description: string("Default description"), status, priority, labels: strings };
const readOnly = { readOnlyHint: true };

export const tools: Tool[] = [
  { name: "list_teams", description: "List teams visible to the current workspace member.", inputSchema: object({}), annotations: readOnly },
  { name: "list_issue_statuses", description: "List configured issue statuses, categories, order, and defaults for visible teams. Supply teamId before creating or moving an issue.", inputSchema: object({ teamId: string("Team ID or key") }), annotations: readOnly },
  { name: "list_members", description: "List active workspace members. Guests can only see themselves.", inputSchema: object({}), annotations: readOnly },
  { name: "list_issues", description: "Find issues with optional text, team, status, assignee, project, and priority filters. Results are paginated.", inputSchema: object({ query: string("Search title, description, or issue ID"), teamId: string("Team ID or key"), status, assigneeId: string("Member ID"), projectId: string("Project ID"), priority, limit, cursor }), annotations: readOnly },
  { name: "get_issue", description: "Get an issue and its comments by ID or workspace URL.", inputSchema: object({ id }, ["id"]), annotations: readOnly },
  { name: "list_issue_activity", description: "Read the issue's chronological history, including property changes and comments, with permission checks.", inputSchema: object({ issueId: id, limit, cursor }, ["issueId"]), annotations: readOnly },
  { name: "list_comments", description: "List comments on an issue visible to the current member.", inputSchema: object({ issueId: id, limit, cursor }, ["issueId"]), annotations: readOnly },
  { name: "create_issue", description: "Create an issue in a writable team.", inputSchema: object({ teamId: string("Team ID or key"), ...issueFields }, ["teamId", "title"]) },
  { name: "update_issue", description: "Update issue fields. Optionally pass expectedVersion to reject a stale edit.", inputSchema: object({ id, ...issueFields, expectedVersion: { type: "integer", minimum: 1 } }, ["id"]) },
  { name: "create_comment", description: "Comment on an issue or reply to a comment thread.", inputSchema: object({ issueId: id, text: string("Comment text, up to 10,000 characters"), parentId: string("Comment ID to reply to"), expectedVersion: { type: "integer", minimum: 1 } }, ["issueId", "text"]) },
  { name: "edit_comment", description: "Edit a comment written by the current member.", inputSchema: object({ issueId: id, commentId: string("Comment ID"), text: string("New text"), expectedVersion: { type: "integer", minimum: 1 } }, ["issueId", "commentId", "text"]) },
  { name: "delete_comment", description: "Delete a comment written by the current member.", inputSchema: object({ issueId: id, commentId: string("Comment ID"), expectedVersion: { type: "integer", minimum: 1 } }, ["issueId", "commentId"]) },
  { name: "react_to_comment", description: "Toggle the current member's emoji reaction on a comment.", inputSchema: object({ issueId: id, commentId: string("Comment ID"), emoji: string("Emoji reaction"), expectedVersion: { type: "integer", minimum: 1 } }, ["issueId", "commentId", "emoji"]) },
  { name: "resolve_comment_thread", description: "Resolve or reopen a top-level comment thread.", inputSchema: object({ issueId: id, commentId: string("Top-level comment ID"), resolved: { type: "boolean" }, expectedVersion: { type: "integer", minimum: 1 } }, ["issueId", "commentId", "resolved"]) },
  { name: "subscribe_issue", description: "Subscribe the current member to an issue's updates.", inputSchema: object({ issueId: id }, ["issueId"]) },
  { name: "unsubscribe_issue", description: "Unsubscribe the current member from an issue's updates.", inputSchema: object({ issueId: id }, ["issueId"]) },
  { name: "list_projects", description: "List visible projects with optional text or team filter.", inputSchema: object({ query: string("Search project name or description"), teamId: string("Team ID or key"), limit, cursor }), annotations: readOnly },
  { name: "get_project", description: "Get a project by ID or workspace URL.", inputSchema: object({ id }, ["id"]), annotations: readOnly },
  { name: "create_project", description: "Create a project in a writable team.", inputSchema: object({ teamId: string("Lead team ID or key"), ...projectFields }, ["teamId", "name"]) },
  { name: "update_project", description: "Update a project. Optionally pass expectedVersion.", inputSchema: object({ id, ...projectFields, expectedVersion: { type: "integer", minimum: 1 } }, ["id"]) },
  { name: "list_cycles", description: "List visible team cycles.", inputSchema: object({ teamId: string("Team ID or key"), limit, cursor }), annotations: readOnly },
  { name: "list_initiatives", description: "List workspace initiatives. Guests cannot access initiatives.", inputSchema: object({ query: string("Search name or description"), limit, cursor }), annotations: readOnly },
  { name: "get_initiative", description: "Get an initiative by ID or workspace URL.", inputSchema: object({ id }, ["id"]), annotations: readOnly },
  { name: "create_initiative", description: "Create a workspace initiative.", inputSchema: object(initiativeFields, ["name"]) },
  { name: "update_initiative", description: "Update an initiative. Optionally pass expectedVersion.", inputSchema: object({ id, ...initiativeFields, expectedVersion: { type: "integer", minimum: 1 } }, ["id"]) },
  { name: "list_documents", description: "List documents visible to the member.", inputSchema: object({ query: string("Search document title or content"), teamId: string("Team ID or key"), limit, cursor }), annotations: readOnly },
  { name: "get_document", description: "Get document content by ID.", inputSchema: object({ id }, ["id"]), annotations: readOnly },
  { name: "create_document", description: "Create a team document.", inputSchema: object({ teamId: string("Team ID or key"), ...documentFields }, ["teamId", "name"]) },
  { name: "update_document", description: "Update a document.", inputSchema: object({ id, ...documentFields, expectedVersion: { type: "integer", minimum: 1 } }, ["id"]) },
  { name: "list_customers", description: "List workspace customers.", inputSchema: object({ query: string("Search customer name, domain or notes"), limit, cursor }), annotations: readOnly },
  { name: "get_customer", description: "Get a customer by ID.", inputSchema: object({ id }, ["id"]), annotations: readOnly },
  { name: "create_customer", description: "Create a workspace customer.", inputSchema: object(customerFields, ["name"]) },
  { name: "update_customer", description: "Update a customer.", inputSchema: object({ id, ...customerFields, expectedVersion: { type: "integer", minimum: 1 } }, ["id"]) },
  { name: "list_customer_requests", description: "List customer requests visible to the member.", inputSchema: object({ query: string("Search request summary or details"), teamId: string("Team ID or key"), limit, cursor }), annotations: readOnly },
  { name: "get_customer_request", description: "Get a customer request by ID.", inputSchema: object({ id }, ["id"]), annotations: readOnly },
  { name: "create_customer_request", description: "Link a customer request to an issue or project.", inputSchema: object({ teamId: string("Team ID or key"), ...customerRequestFields }, ["teamId", "title", "customerId"]) },
  { name: "list_release_pipelines", description: "List team release pipelines.", inputSchema: object({ teamId: string("Team ID or key"), limit, cursor }), annotations: readOnly },
  { name: "create_release_pipeline", description: "Create a release pipeline for one team.", inputSchema: object({ teamId: string("Team ID or key"), ...releasePipelineFields }, ["teamId", "name", "type"]) },
  { name: "list_releases", description: "List releases visible to the member.", inputSchema: object({ query: string("Search release name or notes"), teamId: string("Team ID or key"), limit, cursor }), annotations: readOnly },
  { name: "get_release", description: "Get a release and its linked issue IDs.", inputSchema: object({ id }, ["id"]), annotations: readOnly },
  { name: "create_release", description: "Create a release in a team pipeline.", inputSchema: object({ teamId: string("Team ID or key"), ...releaseFields }, ["teamId", "name", "pipelineId"]) },
  { name: "update_release", description: "Update a release.", inputSchema: object({ id, ...releaseFields, expectedVersion: { type: "integer", minimum: 1 } }, ["id"]) },
  { name: "list_issue_templates", description: "List issue templates for visible teams.", inputSchema: object({ teamId: string("Team ID or key"), limit, cursor }), annotations: readOnly },
  { name: "create_issue_template", description: "Create an issue template for a team.", inputSchema: object({ teamId: string("Team ID or key"), ...issueTemplateFields }, ["teamId", "name", "title"]) },
];

const toolByName = new Map(tools.map(tool => [tool.name, tool]));
const kinds: Record<string, Kind> = { issues: "issue", projects: "project", initiatives: "initiative", cycles: "cycle", documents: "document", customers: "customer", customer_requests: "customerRequest", release_pipelines: "releasePipeline", releases: "release", issue_templates: "issueTemplate" };
const singularKinds: Record<string, Kind> = { issue: "issue", project: "project", initiative: "initiative", document: "document", customer: "customer", customer_request: "customerRequest", release_pipeline: "releasePipeline", release: "release", issue_template: "issueTemplate" };

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, `${label} is required`);
  return value.trim();
}

function recordId(value: unknown, kind: Kind): string {
  const raw = requiredString(value, "ID");
  if (raw.length > 2048) throw new ApiError(400, "Invalid ID");
  if (!/^https?:\/\//.test(raw)) return raw;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new ApiError(400, "Invalid record URL"); }
  const prefix = `${kind}/`;
  if (!parsed.hash.startsWith(`#${prefix}`)) throw new ApiError(400, "URL does not identify this record type");
  try { return decodeURIComponent(parsed.hash.slice(prefix.length + 1)); }
  catch { throw new ApiError(400, "Invalid record URL"); }
}

function teamId(ctx: Context, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const input = requiredString(value, "Team");
  const team = ctx.teams.find(team => team.id === input || team.key.toLowerCase() === input.toLowerCase());
  if (!team) throw new ApiError(404, "Team not found");
  return team.id;
}

async function projectTeams(ctx: Context): Promise<Map<string, string[]>> {
  const rows = (await ctx.db.prepare("SELECT project_id, team_id FROM project_teams").all<{ project_id: string; team_id: string }>()).results;
  const result = new Map<string, string[]>();
  for (const row of rows) result.set(row.project_id, [...(result.get(row.project_id) || []), row.team_id]);
  return result;
}

function visible(ctx: Context, row: Row, teams: Map<string, string[]>): boolean {
  if (ctx.member.role === "guest" && !["issue", "project"].includes(row.kind)) return false;
  if (row.kind === "project") {
    const memberships = teams.get(row.id);
    if (memberships?.length) return memberships.some(team => canReadTeam(ctx, team));
  }
  return canReadTeam(ctx, row.team_id);
}

function present(row: Row, origin: string, teams: Map<string, string[]>, detail: boolean): Json {
  const value = safeParse<Json>(row.value_json, {});
  const routeKey = row.kind === "cycle" && typeof value.name === "string" ? value.name : row.id;
  const result: Json = { ...value, id: row.id, teamId: row.team_id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
  if (["issue", "project", "initiative", "cycle"].includes(row.kind)) result.url = `${origin}/#${row.kind}/${encodeURIComponent(routeKey)}`;
  if (row.kind === "project") result.teamIds = teams.get(row.id) || [row.team_id].filter(Boolean);
  if (row.kind === "issue" && !detail) delete result.comments;
  return result;
}

async function allRows(ctx: Context, kind: Kind): Promise<Row[]> {
  return (await ctx.db.prepare("SELECT kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at FROM records WHERE kind = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5000")
    .bind(kind).all<Row>()).results;
}

async function getRow(ctx: Context, kind: Kind, input: unknown): Promise<{ row: Row; teams: Map<string, string[]> }> {
  const key = recordId(input, kind);
  const row = await ctx.db.prepare("SELECT kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at FROM records WHERE kind = ? AND id = ? AND deleted_at IS NULL")
    .bind(kind, key).first<Row>();
  const teams = kind === "project" ? await projectTeams(ctx) : new Map<string, string[]>();
  if (!row || !visible(ctx, row, teams)) throw new ApiError(404, "Record not found");
  return { row, teams };
}

function pagination(args: Json, items: Json[]): Json {
  const pageSize = args.limit === undefined ? 50 : Number(args.limit);
  const offset = args.cursor === undefined ? 0 : Number(args.cursor);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(offset) || offset < 0 || offset > 5000) throw new ApiError(400, "Invalid pagination");
  return { items: items.slice(offset, offset + pageSize), nextCursor: offset + pageSize < items.length ? String(offset + pageSize) : null };
}

async function list(ctx: Context, kind: Kind, args: Json): Promise<Json> {
  if (ctx.member.role === "guest" && !["issue", "project"].includes(kind)) throw new ApiError(403, "Guest access is limited to team issues and projects");
  const selectedTeam = teamId(ctx, args.teamId);
  const teams = kind === "project" ? await projectTeams(ctx) : new Map<string, string[]>();
  const rows = await allRows(ctx, kind);
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  const results = rows.filter(row => {
    if (!visible(ctx, row, teams)) return false;
    if (selectedTeam && (kind === "project" ? !(teams.get(row.id) || [row.team_id]).includes(selectedTeam) : row.team_id !== selectedTeam)) return false;
    const value = safeParse<Json>(row.value_json, {});
    if (query && ![row.id, value.title, value.name, value.description, value.domain, value.notes, value.content].some(text => typeof text === "string" && text.toLowerCase().includes(query))) return false;
    if (kind === "issue") {
      for (const field of ["status", "assigneeId", "projectId", "priority"] as const) if (args[field] !== undefined && value[field] !== args[field]) return false;
    }
    return true;
  }).map(row => present(row, new URL(ctx.request.url).origin, teams, false));
  return pagination(args, results);
}

async function mutation(ctx: Context, kind: Kind, action: "create" | "update" | "comment", args: Json): Promise<Json> {
  const body: Json = { action, kind };
  if (action === "create") {
    if (!["initiative", "customer"].includes(kind)) requiredString(args.teamId, "Team");
    const selectedTeam = teamId(ctx, args.teamId);
    if (!["initiative", "customer"].includes(kind)) body.teamId = selectedTeam;
    const input = { ...args };
    delete input.teamId;
    if (kind === "issue") { input.priority ??= "No priority"; input.labels ??= []; }
    if (kind === "project" || kind === "initiative") input.status ??= "Planned";
    if (kind === "document") input.content ??= "";
    if (kind === "releasePipeline") input.teamIds = [selectedTeam];
    if (kind === "release") { input.status ??= "planned"; input.issueIds ??= []; }
    if (kind === "issueTemplate") { input.priority ??= "No priority"; input.labels ??= []; }
    body.value = input;
  } else {
    const { row } = await getRow(ctx, kind, args.id ?? args.issueId);
    body.id = row.id;
    body.expectedVersion = args.expectedVersion ?? row.version;
    if (action === "comment") { body.text = args.text; body.parentId = args.parentId; }
    else {
      const patch = { ...args };
      delete patch.id;
      delete patch.expectedVersion;
      if (!Object.keys(patch).length) throw new ApiError(400, "At least one field is required");
      body.patch = patch;
    }
  }
  const response = await mutateRecord(ctx, body);
  const result = await response.json() as Json;
  if (!response.ok) throw new ApiError(response.status, String(result.error || "Record operation failed"));
  return result;
}

export async function callTool(ctx: Context, name: string, args: Json): Promise<Json> {
  const tool = toolByName.get(name);
  if (!tool) throw new ApiError(404, "Unknown tool");
  if (ctx.mcpReadOnly && !tool.annotations?.readOnlyHint) throw new ApiError(403, "MCP token is read-only");
  const schema = tool.inputSchema;
  const properties = schema.properties as Json;
  for (const field of Object.keys(args)) if (!(field in properties)) throw new ApiError(400, `Unknown argument: ${field}`);
  for (const field of schema.required as string[]) if (args[field] === undefined) throw new ApiError(400, `${field} is required`);
  if (name === "list_teams") return { items: ctx.teams.filter(team => canReadTeam(ctx, team.id)) };
  if (name === "list_issue_statuses") {
    const selectedTeam = teamId(ctx, args.teamId);
    if (selectedTeam && !canReadTeam(ctx, selectedTeam)) throw new ApiError(403, "Team access denied");
    return { items: (await listIssueStatuses(ctx.db, selectedTeam)).filter(row => canReadTeam(ctx, row.team_id)) };
  }
  if (name === "list_issue_activity") return readIssueActivity(ctx, recordId(args.issueId, "issue"), args.limit === undefined ? 50 : Number(args.limit), args.cursor === undefined ? 0 : Number(args.cursor));
  if (name === "list_members") {
    const rows = (await ctx.db.prepare("SELECT user_id, display_name, email, role FROM members WHERE status = 'active' ORDER BY display_name LIMIT 5000")
      .all<{ user_id: string; display_name: string; email: string; role: string }>()).results;
    return { items: ctx.member.role === "guest" ? rows.filter(row => row.user_id === ctx.user.userId) : rows };
  }
  if (name === "list_comments") {
    const { row } = await getRow(ctx, "issue", args.issueId);
    const value = safeParse<Json>(row.value_json, {});
    return pagination(args, Array.isArray(value.comments) ? value.comments.filter(item => item && typeof item === "object") as Json[] : []);
  }
  if (name.startsWith("list_")) {
    const kind = kinds[name.slice(5)];
    if (kind) return list(ctx, kind, args);
  }
  if (name.startsWith("get_")) {
    const kind = singularKinds[name.slice(4)];
    if (kind) {
      const { row, teams } = await getRow(ctx, kind, args.id);
      return { record: present(row, new URL(ctx.request.url).origin, teams, true) };
    }
  }
  if (name === "create_comment") return mutation(ctx, "issue", "comment", args);
  const commentActions: Record<string, string> = { edit_comment: "comment.edit", delete_comment: "comment.delete", react_to_comment: "comment.react", resolve_comment_thread: "comment.resolve" };
  if (commentActions[name]) {
    const { row } = await getRow(ctx, "issue", args.issueId);
    const response = await mutateRecord(ctx, { kind: "issue", action: commentActions[name], id: row.id, commentId: args.commentId, text: args.text, emoji: args.emoji, resolved: args.resolved, expectedVersion: args.expectedVersion ?? row.version });
    const result = await response.json() as Json;
    if (!response.ok) throw new ApiError(response.status, String(result.error || "Comment operation failed"));
    return result;
  }
  if (name === "subscribe_issue" || name === "unsubscribe_issue") {
    const issueId = recordId(args.issueId, "issue");
    const response = await mutateRecord(ctx, { kind: "issue", action: name === "subscribe_issue" ? "subscribe" : "unsubscribe", id: issueId });
    const result = await response.json() as Json;
    if (!response.ok) throw new ApiError(response.status, String(result.error || "Subscription failed"));
    return result;
  }
  if (name.startsWith("create_")) {
    const kind = singularKinds[name.slice(7)];
    if (kind) return mutation(ctx, kind, "create", args);
  }
  if (name.startsWith("update_")) {
    const kind = singularKinds[name.slice(7)];
    if (kind) return mutation(ctx, kind, "update", args);
  }
  throw new ApiError(404, "Unknown tool");
}

function rpcResult(id: unknown, result: unknown): Json { return { jsonrpc: "2.0", id, result }; }
function rpcError(id: unknown, code: number, message: string): Json { return { jsonrpc: "2.0", id, error: { code, message } }; }

export async function handleMcp(request: Request, getContext: (request: Request) => Promise<Context> = requireContext): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response("Forbidden origin", { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 256_000) return new Response("Request too large", { status: 413 });
  let message: Json;
  try {
    const body = await request.text();
    if (body.length > 256_000) return new Response("Request too large", { status: 413 });
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON-RPC request");
    message = parsed as Json;
  } catch { return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 }); }
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return Response.json(rpcError(message.id ?? null, -32600, "Invalid Request"), { status: 400 });
  if (message.method.startsWith("notifications/")) return new Response(null, { status: 202 });
  const params = message.params && typeof message.params === "object" && !Array.isArray(message.params) ? message.params as Json : {};
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  try {
    // Sites authenticates the caller. requireContext additionally enforces membership,
    // suspension, team permissions, and the workspace IP policy.
    const ctx = await getContext(request);
    let result: unknown;
    if (message.method === "server/discover") result = { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } };
    else if (message.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "Blanch Linear", version: "1.0.0" } };
    else if (message.method === "ping") result = {};
    else if (message.method === "tools/list") result = { tools: ctx.mcpReadOnly ? tools.filter(tool => tool.annotations?.readOnlyHint) : tools };
    else if (message.method === "tools/call") {
      const name = requiredString(params.name, "Tool name");
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Json : {};
      try {
        const data = await callTool(ctx, name, args);
        result = { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
      } catch (error) {
        result = { content: [{ type: "text", text: error instanceof ApiError ? error.message : "Tool failed" }], isError: true };
      }
    } else return Response.json(rpcError(message.id ?? null, -32601, "Method not found"), { status: 404, headers });
    return Response.json(rpcResult(message.id ?? null, result), { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status === 500) console.error("MCP request failed", error);
    return Response.json(rpcError(message.id ?? null, -32000, error instanceof ApiError ? error.message : "Internal server error"), { status, headers });
  }
}
