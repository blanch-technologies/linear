import { audit, now, safeParse, type Context } from "./workspace-server";

export async function migrateLegacyData(ctx: Context) {
  if (ctx.workspaceSettings.triageLegacyBackfillDone !== true) {
    await ctx.db.prepare("UPDATE teams SET triage_enabled = 1 WHERE triage_enabled = 0 AND EXISTS (SELECT 1 FROM records r WHERE r.kind = 'issue' AND r.team_id = teams.id AND r.deleted_at IS NULL AND json_extract(r.value_json, '$.status') = 'Triage')")
      .run();
    const triageTeams = (await ctx.db.prepare("SELECT id FROM teams WHERE triage_enabled = 1").all<{ id: string }>()).results;
    for (const team of ctx.teams) if (triageTeams.some(row => row.id === team.id)) team.triage_enabled = 1;
    ctx.workspaceSettings.triageLegacyBackfillDone = true;
    await ctx.db.prepare("UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = 'default'")
      .bind(JSON.stringify(ctx.workspaceSettings), now()).run();
  }
  await ctx.db.prepare("UPDATE records SET value_json = json_set(value_json, '$.status', CASE json_extract(value_json, '$.status') WHEN 'approved' THEN 'reviewed' WHEN 'denied' THEN 'dismissed' ELSE 'suggested' END), version = version + 1 WHERE kind = 'appRequest' AND json_extract(value_json, '$.status') IN ('approved', 'denied', 'pending')")
    .run();
  const projects = (await ctx.db.prepare("SELECT id, team_id, value_json FROM records WHERE kind = 'project' AND deleted_at IS NULL LIMIT 1000")
    .all<{ id: string; team_id: string | null; value_json: string }>()).results;
  for (const project of projects) {
    if (!project.team_id) continue;
    await ctx.db.prepare("INSERT OR IGNORE INTO project_teams (project_id, team_id) VALUES (?, ?)").bind(project.id, project.team_id).run();
    const name = safeParse<{ name?: string }>(project.value_json, {}).name;
    if (name) await ctx.db.prepare("UPDATE records SET value_json = json_set(value_json, '$.projectId', ?), version = version + 1 WHERE kind = 'issue' AND team_id = ? AND deleted_at IS NULL AND json_extract(value_json, '$.project') = ? AND json_extract(value_json, '$.projectId') IS NULL")
      .bind(project.id, project.team_id, name).run();
  }

  const requests = (await ctx.db.prepare("SELECT id, team_id, value_json FROM records WHERE kind = 'request' AND deleted_at IS NULL LIMIT 100")
    .all<{ id: string; team_id: string | null; value_json: string }>()).results;
  for (const request of requests) {
    const value = safeParse<Record<string, unknown>>(request.value_json, {});
    if (!request.team_id) continue;
    const team = ctx.teams.find(item => item.id === request.team_id);
    if (!team) continue;
    const existingId = typeof value.linkedIssueId === "string" ? value.linkedIssueId : null;
    if (existingId) {
      await ctx.db.prepare("UPDATE records SET value_json = json_set(value_json, '$.sourceRequestId', ?, '$.requesterId', ?, '$.requesterName', ?), version = version + 1 WHERE kind = 'issue' AND id = ? AND deleted_at IS NULL")
        .bind(request.id, String(value.submittedById || ""), String(value.submittedBy || ""), existingId).run();
      await ctx.db.prepare("DELETE FROM records WHERE kind = 'request' AND id = ?").bind(request.id).run();
      continue;
    }
    if (value.status === "New") await ctx.db.prepare("UPDATE teams SET triage_enabled = 1 WHERE id = ?").bind(team.id).run();
    const counter = await ctx.db.prepare("UPDATE team_counters SET next_issue_number = next_issue_number + 1 WHERE team_id = ? RETURNING next_issue_number")
      .bind(team.id).first<{ next_issue_number: number }>();
    if (!counter) continue;
    const issueId = `${team.key}-${counter.next_issue_number - 1}`;
    const stamp = now();
    const issue = { id: issueId, teamId: team.id, title: String(value.title || "Untitled request"), description: String(value.description || ""), status: value.status === "Declined" ? "Canceled" : "Triage", priority: "No priority", assignee: "", project: "", projectId: null, cycle: "", labels: ["Request"], created: stamp.slice(0, 10), createdBy: String(value.submittedBy || "Unknown"), comments: [], source: "Ask", sourceRequestId: request.id, requesterId: String(value.submittedById || ""), requesterName: String(value.submittedBy || "") };
    await ctx.db.batch([
      ctx.db.prepare("INSERT OR IGNORE INTO records (kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at) VALUES ('issue', ?, ?, NULL, ?, 1, ?, ?)")
        .bind(issueId, team.id, JSON.stringify(issue), stamp, stamp),
      ctx.db.prepare("DELETE FROM records WHERE kind = 'request' AND id = ?").bind(request.id),
    ]);
    await audit(ctx, "request.migrate", "issue", issueId, { legacyRequestId: request.id });
  }
}
