import { now, safeParse } from "../workspace-server";
import type { Provider } from "./store";
import { defaultStatusForTeam } from "../issue-workflow";

type IssueRow = { id: string; team_id: string; value_json: string; version: number };

export async function createExternalIssue(
  db: D1Database, provider: Provider, teamId: string, title: string, description: string,
  source: Record<string, unknown>, requesterName: string,
): Promise<string> {
  const team = await db.prepare("SELECT key, triage_enabled FROM teams WHERE id = ?")
    .bind(teamId).first<{ key: string; triage_enabled: number }>();
  if (!team) throw new Error("Integration target team is unavailable");
  const counter = await db.prepare("UPDATE team_counters SET next_issue_number = next_issue_number + 1 WHERE team_id = ? RETURNING next_issue_number")
    .bind(teamId).first<{ next_issue_number: number }>();
  if (!counter) throw new Error("Issue counter unavailable");
  const id = team.key + "-" + (counter.next_issue_number - 1);
  const stamp = now();
  const defaultStatus = await defaultStatusForTeam(db, teamId);
  const value = {
    id, teamId, title: title.slice(0, 300), description: description.slice(0, 20_000),
    status: team.triage_enabled ? "Triage" : defaultStatus?.name || "Backlog", priority: "No priority",
    assignee: "", assigneeId: null, project: "", projectId: null, cycle: "",
    labels: [provider === "github" ? "GitHub" : "Slack"],
    created: stamp.slice(0, 10), createdBy: requesterName, createdById: null,
    comments: [], source: { provider, ...source },
  };
  await db.batch([
    db.prepare("INSERT INTO records (kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at) VALUES ('issue', ?, ?, NULL, ?, 1, ?, ?)")
      .bind(id, teamId, JSON.stringify(value), stamp, stamp),
    db.prepare("INSERT INTO issue_events (id, issue_id, team_id, actor_user_id, action, details_json, created_at) VALUES (?, ?, ?, ?, 'create', ?, ?)")
      .bind(crypto.randomUUID(), id, teamId, "integration:" + provider, JSON.stringify({ title: value.title, status: value.status }), stamp),
  ]);
  return id;
}

export async function updateExternalIssue(
  db: D1Database, provider: Provider, issueId: string, patch: Record<string, unknown>,
  action: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.prepare("SELECT id, team_id, value_json, version FROM records WHERE kind = 'issue' AND id = ? AND deleted_at IS NULL")
      .bind(issueId).first<IssueRow>();
    if (!row) return;
    const current = safeParse<Record<string, unknown>>(row.value_json, {});
    if (Object.entries(patch).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value))) return;
    const value = { ...current, ...patch };
    const stamp = now();
    const result = await db.prepare("UPDATE records SET value_json = ?, version = version + 1, updated_at = ? WHERE kind = 'issue' AND id = ? AND version = ?")
      .bind(JSON.stringify(value), stamp, issueId, row.version).run();
    if (result.meta.changes) {
      const changes = Object.keys(patch).filter(field => JSON.stringify(current[field]) !== JSON.stringify(value[field]))
        .map(field => field === "description" ? { field } : { field, from: String(current[field] ?? "None").slice(0, 240), to: String(value[field] ?? "None").slice(0, 240) });
      await db.prepare("INSERT INTO issue_events (id, issue_id, team_id, actor_user_id, action, details_json, created_at) VALUES (?, ?, ?, ?, 'update', ?, ?)")
        .bind(crypto.randomUUID(), issueId, row.team_id, "integration:" + provider, JSON.stringify({ changes }), stamp).run();
      return;
    }
  }
  throw new Error("Issue changed during integration update");
}

export async function appendExternalComment(
  db: D1Database, provider: Provider, issueId: string, externalCommentId: string, text: string, author: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.prepare("SELECT id, team_id, value_json, version FROM records WHERE kind = 'issue' AND id = ? AND deleted_at IS NULL")
      .bind(issueId).first<IssueRow>();
    if (!row) return;
    const value = safeParse<Record<string, unknown>>(row.value_json, {});
    const comments = Array.isArray(value.comments) ? value.comments as Array<Record<string, unknown>> : [];
    if (comments.some(comment => comment.externalId === externalCommentId)) return;
    const stamp = now();
    const commentId = crypto.randomUUID();
    value.comments = [...comments, { id: commentId, externalId: externalCommentId, text: text.slice(0, 10_000), by: author, date: stamp.slice(0, 10), createdAt: stamp }];
    const result = await db.prepare("UPDATE records SET value_json = ?, version = version + 1, updated_at = ? WHERE kind = 'issue' AND id = ? AND version = ?")
      .bind(JSON.stringify(value), stamp, issueId, row.version).run();
    if (result.meta.changes) {
      await db.prepare("INSERT INTO issue_events (id, issue_id, team_id, actor_user_id, action, details_json, created_at) VALUES (?, ?, ?, ?, 'comment', ?, ?)")
        .bind(crypto.randomUUID(), issueId, row.team_id, "integration:" + provider, JSON.stringify({ commentId }), stamp).run();
      return;
    }
  }
  throw new Error("Issue changed during integration comment");
}
