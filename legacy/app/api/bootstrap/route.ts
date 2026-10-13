import { audit, canReadTeam, errorResponse, json, requireContext, safeParse } from "../../../lib/workspace-server";
import { migrateLegacyData } from "../../../lib/legacy-data";
import { ensureTeamCycles } from "../../../lib/cycles";
import { purgeExpiredRecords } from "../../../lib/deleted-records";
import { listIssueStatuses } from "../../../lib/issue-workflow";

export const dynamic = "force-dynamic";

type RecordRow = {
  kind: string;
  id: string;
  team_id: string | null;
  owner_user_id: string | null;
  value_json: string;
  version: number;
};

export async function GET(request: Request) {
  try {
    const ctx = await requireContext(request);
    await purgeExpiredRecords(ctx);
    await migrateLegacyData(ctx);
    await ensureTeamCycles(ctx);
    const rows = (await ctx.db.prepare("SELECT kind, id, team_id, owner_user_id, value_json, version FROM records WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5000").all<RecordRow>()).results;
    const projectMemberships = (await ctx.db.prepare("SELECT project_id, team_id FROM project_teams").all<{ project_id: string; team_id: string }>()).results;
    const issueStatuses = (await listIssueStatuses(ctx.db)).filter(status => canReadTeam(ctx, status.team_id));
    const visible = rows.filter(row => {
      if (ctx.member.role === "guest" && ["initiative", "request", "view", "cycle", "dashboard", "document", "customer", "customerRequest", "releasePipeline", "release", "issueTemplate"].includes(row.kind)) return false;
      if (row.kind === "notification") return row.owner_user_id === ctx.user.userId && (!row.team_id || canReadTeam(ctx, row.team_id));
      if (row.kind === "dashboard") return row.owner_user_id === ctx.user.userId || safeParse<{ visibility?: string }>(row.value_json, {}).visibility === "workspace";
      if (row.kind === "view" && row.owner_user_id) return row.owner_user_id === ctx.user.userId && canReadTeam(ctx, row.team_id);
      if (row.kind === "project" && projectMemberships.some(team => team.project_id === row.id)) return projectMemberships.some(team => team.project_id === row.id && canReadTeam(ctx, team.team_id));
      return canReadTeam(ctx, row.team_id);
    });
    const data = { issues: [] as unknown[], projects: [] as unknown[], cycles: [] as unknown[], views: [] as unknown[], notifications: [] as unknown[], initiatives: [] as unknown[], requests: [] as unknown[], dashboards: [] as unknown[], documents: [] as unknown[], customers: [] as unknown[], customerRequests: [] as unknown[], releasePipelines: [] as unknown[], releases: [] as unknown[], issueTemplates: [] as unknown[], nextIssue: 1 };
    const announcements = rows.filter(row => row.kind === "announcement" && ctx.member.role !== "guest" && canReadTeam(ctx, row.team_id)).map(row => safeParse(row.value_json, {}));
    const appRequests = rows.filter(row => row.kind === "appRequest" && ctx.member.role !== "guest" && (["owner", "admin"].includes(ctx.member.role) || safeParse<{ requestedById?: string }>(row.value_json, {}).requestedById === ctx.user.userId)).map(row => safeParse(row.value_json, {}));
    const keyMap: Record<string, keyof typeof data> = { issue: "issues", project: "projects", cycle: "cycles", view: "views", notification: "notifications", initiative: "initiatives", request: "requests", dashboard: "dashboards", document: "documents", customer: "customers", customerRequest: "customerRequests", releasePipeline: "releasePipelines", release: "releases", issueTemplate: "issueTemplates" };
    for (const row of visible) {
      const key = keyMap[row.kind];
      if (!key || key === "nextIssue") continue;
      const value = safeParse<Record<string, unknown>>(row.value_json, {});
      if (row.kind === "cycle" && typeof value.start === "string" && typeof value.end === "string") value.current = value.start <= new Date().toISOString().slice(0, 10) && value.end >= new Date().toISOString().slice(0, 10);
      (data[key] as unknown[]).push({ ...value, _version: row.version, _ownerUserId: row.owner_user_id, teamId: row.team_id });
    }
    for (const project of data.projects as Array<Record<string, unknown>>) project.teamIds = projectMemberships.filter(row => row.project_id === project.id).map(row => row.team_id);
    const counter = await ctx.db.prepare("SELECT next_issue_number FROM team_counters WHERE team_id = ?").bind("engineering").first<{ next_issue_number: number }>();
    data.nextIssue = counter?.next_issue_number ?? 1;
    const members = (await ctx.db.prepare("SELECT user_id, email, display_name, role, status FROM members ORDER BY created_at").all<{ user_id: string; display_name: string }>()).results;
    const namesById = new Map(members.map(member => [member.user_id, member.display_name]));
    for (const issue of data.issues as Array<Record<string, unknown>>) {
      if (typeof issue.assigneeId === "string" && namesById.has(issue.assigneeId)) issue.assignee = namesById.get(issue.assigneeId);
    }
    const invitations = ["owner", "admin"].includes(ctx.member.role)
      ? (await ctx.db.prepare("SELECT id, email, role, team_ids_json, invited_by, status, created_at FROM invitations ORDER BY created_at DESC").all()).results
      : (await ctx.db.prepare("SELECT id, email, role, team_ids_json, invited_by, status, created_at FROM invitations WHERE invited_by = ? ORDER BY created_at DESC").bind(ctx.user.userId).all()).results;
    const teamMembers = (await ctx.db.prepare("SELECT team_id, user_id, role FROM team_members").all<{ team_id: string; user_id: string; role: string }>()).results
      .filter(row => canReadTeam(ctx, row.team_id) && (ctx.member.role !== "guest" || row.user_id === ctx.user.userId));
    const auditRows = ctx.member.role === "owner"
      ? (await ctx.db.prepare("SELECT id, actor_email, action, target_kind, target_id, details_json, ip_address, country, created_at FROM audit_events WHERE created_at >= ? ORDER BY created_at DESC LIMIT 200").bind(new Date(Date.now() - 90 * 86400000).toISOString()).all()).results
      : [];
    const subscriptions = (await ctx.db.prepare("SELECT issue_id FROM issue_subscriptions WHERE user_id = ?")
      .bind(ctx.user.userId).all<{ issue_id: string }>()).results.map(row => row.issue_id)
      .filter(id => (data.issues as Array<{ id: string }>).some(issue => issue.id === id));
    const activity = (await ctx.db.prepare("SELECT e.issue_id FROM issue_events e LEFT JOIN issue_subscriptions s ON s.issue_id = e.issue_id AND s.user_id = ? WHERE e.actor_user_id = ? OR s.user_id IS NOT NULL GROUP BY e.issue_id ORDER BY MAX(e.created_at) DESC LIMIT 200")
      .bind(ctx.user.userId, ctx.user.userId).all<{ issue_id: string }>()).results.map(row => row.issue_id)
      .filter(id => (data.issues as Array<{ id: string }>).some(issue => issue.id === id));
    const visibleIssueIds = new Set((data.issues as Array<{ id: string }>).map(issue => issue.id));
    const integrationLinks = (await ctx.db.prepare("SELECT provider, issue_id, kind, metadata_json FROM integration_links WHERE issue_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1000")
      .all<{ provider: string; issue_id: string; kind: string; metadata_json: string }>()).results
      .filter(row => visibleIssueIds.has(row.issue_id))
      .map(row => ({ provider: row.provider, issueId: row.issue_id, kind: row.kind, metadata: safeParse(row.metadata_json, {}) }));
    const welcome = await ctx.db.prepare("SELECT welcome_seen_at FROM members WHERE user_id = ?")
      .bind(ctx.user.userId).first<{ welcome_seen_at: string | null }>();
    return json({
      user: { id: ctx.user.userId, email: ctx.user.email, displayName: ctx.user.displayName, role: ctx.member.role, welcomeSeenAt: welcome?.welcome_seen_at || null },
      workspace: { name: String(ctx.workspaceSettings.name || "Linear Workspace"), settings: ctx.workspaceSettings },
      teams: ctx.teams.filter(team => canReadTeam(ctx, team.id) || ["owner", "admin"].includes(ctx.member.role)),
      teamMemberships: [...ctx.teamMemberships],
      members: ctx.member.role === "guest" ? members.filter(member => member.user_id === ctx.user.userId) : members,
      invitations,
      teamMembers,
      issueStatuses,
      audit: auditRows,
      announcements,
      appRequests,
      mySubscribedIds: subscriptions,
      myActivityIds: activity,
      integrationLinks,
      data,
      needsImport: rows.length === 0,
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext(request);
    if (ctx.member.role !== "owner") return json({ error: "Owner access required" }, 403);
    const count = await ctx.db.prepare("SELECT COUNT(*) AS count FROM records").first<{ count: number }>();
    if ((count?.count ?? 0) > 0) return json({ error: "Workspace has already been initialized" }, 409);
    const body = await request.json() as Record<string, unknown>;
    const source = body.data as Record<string, unknown> | undefined;
    if (!source || typeof source !== "object") return json({ error: "Invalid import data" }, 400);
    if (body.sample === true) await ctx.db.prepare("UPDATE teams SET name = 'Engineering', key = 'ENG', triage_enabled = 1, updated_at = ? WHERE id = 'engineering'").bind(new Date().toISOString()).run();
    const mapping = { issues: "issue", projects: "project", cycles: "cycle", views: "view", notifications: "notification" } as const;
    const inserts: D1PreparedStatement[] = [];
    let maximumIssue = 0;
    const stamp = new Date().toISOString();
    for (const [plural, kind] of Object.entries(mapping)) {
      const values = source[plural];
      if (!Array.isArray(values) || values.length > 1000) return json({ error: `Invalid ${plural} data` }, 400);
      for (const input of values) {
        if (!input || typeof input !== "object") return json({ error: `Invalid ${kind}` }, 400);
        const value = { ...(input as Record<string, unknown>) };
        delete value._version;
        const id = String(value.id || crypto.randomUUID());
        if (id.length > 100 || !/^[A-Za-z0-9_-]+$/.test(id)) return json({ error: "Invalid record ID" }, 400);
        const teamId = kind === "notification" || kind === "view" ? null : "engineering";
        const ownerId = kind === "notification" || kind === "view" ? ctx.user.userId : null;
        if (value.assignee === "You") { value.assignee = ctx.user.displayName; value.assigneeId = ctx.user.userId; }
        if (value.createdBy === "You") { value.createdBy = ctx.user.displayName; value.createdById = ctx.user.userId; }
        if (value.lead === "You") value.lead = ctx.user.displayName;
        if (kind === "project" && (typeof value.color !== "string" || !/^#[0-9a-f]{6}$/i.test(value.color))) value.color = "#8c7df0";
        if (kind === "issue") {
          if (!Array.isArray(value.labels)) value.labels = [];
          if (!Array.isArray(value.comments)) value.comments = [];
        }
        if (kind === "issue") maximumIssue = Math.max(maximumIssue, Number(id.match(/-(\d+)$/)?.[1] || 0));
        inserts.push(ctx.db.prepare("INSERT INTO records (kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
          .bind(kind, id, teamId, ownerId, JSON.stringify({ ...value, id, teamId }), stamp, stamp));
      }
    }
    if (inserts.length) await ctx.db.batch(inserts);
    await ctx.db.prepare("UPDATE team_counters SET next_issue_number = ? WHERE team_id = ?").bind(Math.max(maximumIssue + 1, 1), "engineering").run();
    await audit(ctx, "workspace.import", "workspace", "default", { records: inserts.length });
    return json({ ok: true, records: inserts.length });
  } catch (error) { return errorResponse(error); }
}
