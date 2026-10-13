import { env } from "cloudflare:workers";
import { getRequestExecutionContext } from "vinext/shims/request-context";
import { ApiError, audit, canReadTeam, errorResponse, json, now, requireAdmin, requireContext, safeParse, type Context } from "../../../lib/workspace-server";

export const dynamic = "force-dynamic";

type ExportType = "issues" | "members" | "views" | "backup";
type Row = { kind: string; id: string; team_id: string | null; owner_user_id: string | null; value_json: string; created_at: string; updated_at: string };
type Job = { id: string; user_id: string; type: ExportType; status: string; storage_key: string | null; error: string | null; created_at: string };
type ExportFile = { body: string; contentType: string; filename: string };

const csv = (columns: string[], rows: unknown[][]) => [columns, ...rows].map(row => row.map(value => {
  const raw = String(value ?? "");
  const safe = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}).join(",")).join("\r\n") + "\r\n";

function exportType(value: unknown): ExportType {
  if (value === "issues" || value === "members" || value === "views" || value === "backup") return value;
  throw new ApiError(400, "Invalid export type");
}
function authorize(ctx: Context, type: ExportType) {
  if (ctx.member.role === "guest") throw new ApiError(403, "Export access denied");
  if (type === "backup") requireAdmin(ctx, true);
  if (type === "members") requireAdmin(ctx);
}
function filename(type: ExportType, date: string) {
  return type === "backup" ? "linear-workspace-backup-" + date + ".json" : "linear-" + type + "-" + date + ".csv";
}
function headers(file: Pick<ExportFile, "contentType" | "filename">) {
  return { "Content-Type": file.contentType, "Content-Disposition": 'attachment; filename="' + file.filename + '"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}

async function buildExport(ctx: Context, type: ExportType, includePrivate: boolean): Promise<ExportFile> {
  authorize(ctx, type);
  const visible = (teamId: string | null) => canReadTeam(ctx, teamId) && (includePrivate || !ctx.teams.some(team => team.id === teamId && team.visibility === "private"));
  const projectMemberships = (await ctx.db.prepare("SELECT project_id, team_id FROM project_teams").all<{ project_id: string; team_id: string }>()).results;
  const visibleRecord = (row: Row) => {
    if (row.kind === "dashboard") return row.owner_user_id === ctx.user.userId || safeParse<{ visibility?: string }>(row.value_json, {}).visibility === "workspace";
    if (row.kind === "view") return (!row.owner_user_id || row.owner_user_id === ctx.user.userId) && visible(row.team_id);
    if (row.kind === "project") return projectMemberships.some(team => team.project_id === row.id && visible(team.team_id));
    return visible(row.team_id);
  };
  const records: Row[] = [];
  if (type !== "members") {
    for (let offset = 0; ; offset += 500) {
      const page = (await ctx.db.prepare("SELECT kind, id, team_id, owner_user_id, value_json, created_at, updated_at FROM records WHERE deleted_at IS NULL ORDER BY kind, id LIMIT 500 OFFSET ?")
        .bind(offset).all<Row>()).results;
      records.push(...page.filter(row => (type === "backup" || row.kind === (type === "issues" ? "issue" : "view")) && visibleRecord(row)));
      if (page.length < 500) break;
      if (offset >= 19_500) throw new Error("Export exceeds the supported size");
    }
  }
  const date = now().slice(0, 10);
  let body: string;
  let contentType = "text/csv; charset=utf-8";
  if (type === "issues") {
    body = csv(["ID", "Title", "Description", "Status", "Priority", "Assignee", "Team", "Project", "Cycle", "Labels", "Start date", "Due date", "Estimate", "Parent ID", "Related IDs", "Blocked by IDs", "Milestone ID", "Created", "Updated"], records.map(row => {
      const value = safeParse<Record<string, unknown>>(row.value_json, {});
      return [row.id, value.title, value.description, value.status, value.priority, value.assignee, ctx.teams.find(team => team.id === row.team_id)?.name, value.project, value.cycle, Array.isArray(value.labels) ? value.labels.join(", ") : "", value.startDate, value.dueDate, value.estimate, value.parentId, Array.isArray(value.relatedIds) ? value.relatedIds.join(", ") : "", Array.isArray(value.blockedByIds) ? value.blockedByIds.join(", ") : "", value.milestoneId, row.created_at, row.updated_at];
    }));
  } else if (type === "members") {
    const members = (await ctx.db.prepare("SELECT email, display_name, role, status, created_at FROM members ORDER BY created_at").all<{ email: string; display_name: string; role: string; status: string; created_at: string }>()).results;
    body = csv(["Email", "Name", "Role", "Status", "Joined"], members.map(row => [row.email, row.display_name, row.role, row.status, row.created_at]));
  } else if (type === "views") {
    body = csv(["ID", "Name", "Description", "Filter", "Team", "Owner"], records.map(row => {
      const value = safeParse<Record<string, unknown>>(row.value_json, {});
      return [row.id, value.name, value.description, value.type, row.team_id, row.owner_user_id];
    }));
  } else {
    const [teams, members, invitations, workspace] = await Promise.all([
      ctx.db.prepare("SELECT id, name, key, parent_id, visibility FROM teams").all<{ id: string }>(),
      ctx.db.prepare("SELECT user_id, email, display_name, role, status FROM members").all(),
      ctx.db.prepare("SELECT email, role, team_ids_json, status FROM invitations").all(),
      ctx.db.prepare("SELECT name, settings_json FROM workspaces WHERE id = 'default'").first<{ name: string; settings_json: string }>(),
    ]);
    body = JSON.stringify({ format: "linear-workspace-backup", version: 2, exportedAt: now(), workspace: { name: workspace?.name, settings: safeParse(workspace?.settings_json, {}) }, teams: teams.results.filter(team => visible(team.id)), members: members.results, invitations: invitations.results, records: records.map(row => ({ kind: row.kind, id: row.id, teamId: row.team_id, ownerUserId: row.owner_user_id, value: safeParse(row.value_json, {}), createdAt: row.created_at, updatedAt: row.updated_at })), note: "Only teams you can access are included. Attachment files are stored separately." }, null, 2);
    contentType = "application/json; charset=utf-8";
  }
  await audit(ctx, "workspace.export", "workspace", "default", { type, includePrivate, rows: records.length });
  return { body, contentType, filename: filename(type, date) };
}

async function findJob(ctx: Context, id: string): Promise<Job> {
  const job = await ctx.db.prepare("SELECT id, user_id, type, status, storage_key, error, created_at FROM export_jobs WHERE id = ? AND user_id = ?")
    .bind(id, ctx.user.userId).first<Job>();
  if (!job) throw new ApiError(404, "Export job not found");
  if (job.created_at < new Date(Date.now() - 7 * 86400_000).toISOString()) {
    if (job.storage_key && env.BUCKET) await env.BUCKET.delete(job.storage_key);
    await ctx.db.prepare("DELETE FROM export_jobs WHERE id = ?").bind(job.id).run();
    throw new ApiError(404, "Export has expired");
  }
  return job;
}
async function cleanup(ctx: Context) {
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const expired = (await ctx.db.prepare("SELECT id, storage_key FROM export_jobs WHERE created_at < ? LIMIT 25").bind(cutoff).all<{ id: string; storage_key: string | null }>()).results;
  for (const job of expired) {
    if (job.storage_key && env.BUCKET) await env.BUCKET.delete(job.storage_key);
    await ctx.db.prepare("DELETE FROM export_jobs WHERE id = ?").bind(job.id).run();
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireContext(request);
    const url = new URL(request.url);
    const jobId = url.searchParams.get("job") || url.searchParams.get("download");
    if (jobId) {
      const job = await findJob(ctx, jobId);
      if (url.searchParams.has("job")) return json({ id: job.id, status: job.status, error: job.error, downloadUrl: job.status === "ready" ? "/api/export?download=" + encodeURIComponent(job.id) : null });
      if (job.status !== "ready" || !job.storage_key) throw new ApiError(409, "Export is not ready");
      const object = await env.BUCKET?.get(job.storage_key);
      if (!object) throw new ApiError(404, "Export file not found");
      return new Response(object.body, { headers: headers({ contentType: job.type === "backup" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8", filename: filename(job.type, job.created_at.slice(0, 10)) }) });
    }
    const type = exportType(url.searchParams.get("type") || "issues");
    const file = await buildExport(ctx, type, url.searchParams.get("includePrivate") === "true");
    return new Response(file.body, { headers: headers(file) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext(request);
    const body = await request.json() as { type?: string; includePrivate?: boolean };
    const type = exportType(body.type);
    authorize(ctx, type);
    if (!env.BUCKET) throw new ApiError(503, "Export storage is unavailable");
    const id = crypto.randomUUID();
    const timestamp = now();
    const includePrivate = body.includePrivate === true;
    await cleanup(ctx);
    await ctx.db.prepare("INSERT INTO export_jobs (id, user_id, type, include_private, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
      .bind(id, ctx.user.userId, type, includePrivate ? 1 : 0, timestamp, timestamp).run();
    const work = (async () => {
      try {
        const file = await buildExport(ctx, type, includePrivate);
        const key = "exports/" + ctx.user.userId + "/" + id + (type === "backup" ? ".json" : ".csv");
        await env.BUCKET!.put(key, file.body, { httpMetadata: { contentType: file.contentType } });
        await ctx.db.prepare("UPDATE export_jobs SET status = 'ready', storage_key = ?, updated_at = ? WHERE id = ?")
          .bind(key, now(), id).run();
      } catch (error) {
        console.error("Export job failed", error);
        await ctx.db.prepare("UPDATE export_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
          .bind(error instanceof Error ? error.message.slice(0, 300) : "Export failed", now(), id).run();
      }
    })();
    const execution = getRequestExecutionContext();
    if (execution) execution.waitUntil(work);
    else await work;
    const status = execution ? "pending" : (await findJob(ctx, id)).status;
    return json({ id, status }, 202);
  } catch (error) { return errorResponse(error); }
}
