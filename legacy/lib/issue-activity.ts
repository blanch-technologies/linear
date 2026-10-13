import { ApiError, canReadTeam, safeParse, type Context } from "./workspace-server";

type ActivityRow = {
  id: string;
  action: string;
  actor_user_id: string;
  display_name: string | null;
  details_json: string;
  created_at: string;
};

export async function readIssueActivity(ctx: Context, issueId: string, limit = 50, cursor = 0) {
  if (!issueId || issueId.length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(cursor) || cursor < 0 || cursor > 5000) throw new ApiError(400, "Invalid activity request");
  const issue = await ctx.db.prepare("SELECT team_id FROM records WHERE kind = 'issue' AND id = ? AND deleted_at IS NULL")
    .bind(issueId).first<{ team_id: string }>();
  if (!issue || !canReadTeam(ctx, issue.team_id)) throw new ApiError(404, "Issue not found");
  const rows = (await ctx.db.prepare(
    "SELECT e.id, e.action, e.actor_user_id, m.display_name, e.details_json, e.created_at FROM issue_events e " +
    "LEFT JOIN members m ON m.user_id = e.actor_user_id WHERE e.issue_id = ? AND e.team_id = ? " +
    "ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?"
  ).bind(issueId, issue.team_id, limit + 1, cursor).all<ActivityRow>()).results;
  return {
    items: rows.slice(0, limit).map(row => ({
      id: row.id,
      action: row.action,
      actor: row.display_name || (row.actor_user_id === "system" ? "System" : row.actor_user_id.startsWith("integration:") ? row.actor_user_id.slice(12) : "Former member"),
      details: safeParse<Record<string, unknown>>(row.details_json, {}),
      createdAt: row.created_at,
    })),
    nextCursor: rows.length > limit ? String(cursor + limit) : null,
  };
}
