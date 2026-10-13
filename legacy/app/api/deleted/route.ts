import { canWriteTeam, errorResponse, json, requireContext, safeParse } from "../../../lib/workspace-server";
import { purgeExpiredRecords } from "../../../lib/deleted-records";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireContext(request);
    await purgeExpiredRecords(ctx);
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const rows = (await ctx.db.prepare("SELECT kind, id, team_id, owner_user_id, value_json, version, deleted_at FROM records WHERE deleted_at >= ? ORDER BY deleted_at DESC LIMIT 500")
      .bind(cutoff).all<{ kind: string; id: string; team_id: string | null; owner_user_id: string | null; value_json: string; version: number; deleted_at: string }>()).results;
    const projectTeams = (await ctx.db.prepare("SELECT project_id, team_id FROM project_teams").all<{ project_id: string; team_id: string }>()).results;
    return json({ records: rows.filter(row => (row.kind === "dashboard" ? row.owner_user_id === ctx.user.userId || ctx.member.role === "owner" && safeParse<{ visibility?: string }>(row.value_json, {}).visibility === "workspace" : canWriteTeam(ctx, row.team_id) || row.kind === "project" && projectTeams.some(team => team.project_id === row.id && canWriteTeam(ctx, team.team_id))) && !["notification", "appRequest", "announcement"].includes(row.kind))
      .map(row => ({ kind: row.kind, id: row.id, teamId: row.team_id, value: safeParse(row.value_json, {}), version: row.version, deletedAt: row.deleted_at })) });
  } catch (error) { return errorResponse(error); }
}
