import { safeParse } from "../workspace-server";
import { createExternalIssue, updateExternalIssue, appendExternalComment } from "./issues";
import { findConnection, upsertLink } from "./store";
import { firstStatusInCategory, statusForTeam } from "../issue-workflow";

type AnyRecord = Record<string, unknown>;
type GitHubSettings = { repositories?: string[]; repoTeams?: Record<string, string>; automateOnOpen?: string; automateOnMerge?: string; issueSync?: boolean };
type IssueRow = { id: string; team_id: string };

export function issueIdsFromText(...parts: unknown[]): string[] {
  const matches = parts.filter((part): part is string => typeof part === "string").join("\n").match(/\b[A-Z][A-Z0-9]{1,11}-\d+\b/g) || [];
  return [...new Set(matches)].slice(0, 20);
}

function object(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

async function eligibleIssue(db: D1Database, id: string, mappedTeam: string | undefined) {
  const row = await db.prepare("SELECT id, team_id FROM records WHERE kind = 'issue' AND id = ? AND deleted_at IS NULL")
    .bind(id).first<IssueRow>();
  if (!row) return null;
  if (mappedTeam) return row.team_id === mappedTeam ? row : null;
  const team = await db.prepare("SELECT visibility FROM teams WHERE id = ?").bind(row.team_id).first<{ visibility: string }>();
  return team?.visibility === "public" ? row : null;
}

async function updateLinkedMetadata(db: D1Database, connectionId: string, externalPrefix: string, patch: AnyRecord) {
  const rows = (await db.prepare("SELECT id, metadata_json FROM integration_links WHERE provider = 'github' AND connection_id = ? AND external_id LIKE ?")
    .bind(connectionId, externalPrefix + "%").all<{ id: string; metadata_json: string }>()).results;
  for (const row of rows) {
    const metadata = { ...safeParse<AnyRecord>(row.metadata_json, {}), ...patch };
    await db.prepare("UPDATE integration_links SET metadata_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(metadata), new Date().toISOString(), row.id).run();
  }
}

export async function processGitHubEvent(db: D1Database, event: string, payload: AnyRecord) {
  const installation = object(payload.installation);
  const repo = object(payload.repository);
  const repository = typeof repo.full_name === "string" ? repo.full_name : "";
  const installationId = Number(installation.id);
  if (!Number.isSafeInteger(installationId)) return;
  const action = String(payload.action || "");
  if (event === "installation") {
    const next = action === "deleted" ? "disconnected" : action === "suspend" ? "suspended" : action === "unsuspend" ? "connected" : "";
    if (next) await db.prepare("UPDATE integration_connections SET status = ?, updated_at = ? WHERE provider = 'github' AND external_id = ?")
      .bind(next, new Date().toISOString(), String(installationId)).run();
    return;
  }
  const connection = await findConnection(db, "github", String(installationId));
  if (!connection) return;
  if (!repository) return;
  const settings = safeParse<GitHubSettings>(connection.settings_json, {});
  if (!settings.repositories?.includes(repository)) return;
  const mappedTeam = settings.repoTeams?.[repository];

  if (event === "pull_request") {
    const pr = object(payload.pull_request);
    const head = object(pr.head);
    const merged = pr.merged === true;
    const number = Number(pr.number);
    if (!Number.isSafeInteger(number)) return;
    const prefix = repository + "#pr-" + number;
    const metadata = {
      repository, number, url: String(pr.html_url || ""), title: String(pr.title || "").slice(0, 300),
      state: String(pr.state || ""), draft: pr.draft === true, merged,
      updatedAt: String(pr.updated_at || new Date().toISOString()),
    };
    for (const id of issueIdsFromText(head.ref, pr.title, pr.body)) {
      const issue = await eligibleIssue(db, id, mappedTeam);
      if (!issue) continue;
      await upsertLink(db, connection.id, "github", prefix + ":" + issue.id, issue.id, null, "pull_request", metadata);
      const nextStatus = merged && action === "closed" ? settings.automateOnMerge
        : ["opened", "reopened", "ready_for_review"].includes(action) ? settings.automateOnOpen : "";
      if (nextStatus && await statusForTeam(db, issue.team_id, nextStatus))
        await updateExternalIssue(db, "github", issue.id, { status: nextStatus }, "github.pr." + action);
    }
    if (["closed", "synchronize", "edited", "ready_for_review", "converted_to_draft"].includes(action))
      await updateLinkedMetadata(db, connection.id, prefix + ":", metadata);
    return;
  }

  if (event === "push") {
    const commits = Array.isArray(payload.commits) ? payload.commits.slice(0, 40) : [];
    const shippedIssues = new Set<string>();
    for (const item of commits) {
      const commit = object(item);
      const sha = typeof commit.id === "string" ? commit.id : "";
      if (!/^[a-f0-9]{40}$/.test(sha)) continue;
      for (const id of issueIdsFromText(commit.message)) {
        const issue = await eligibleIssue(db, id, mappedTeam);
        if (!issue) continue;
        shippedIssues.add(issue.id);
        await upsertLink(db, connection.id, "github", repository + "#commit-" + sha + ":" + issue.id, issue.id, null, "commit",
          { repository, sha, url: String(commit.url || ""), message: String(commit.message || "").slice(0, 300) });
      }
    }
    const headSha = String(payload.after || "");
    const branch = String(payload.ref || "").replace(/^refs\/heads\//, "");
    if (mappedTeam && /^[a-f0-9]{40}$/.test(headSha) && branch) {
      const pipelines = (await db.prepare("SELECT id, team_id, value_json FROM records WHERE kind = 'releasePipeline' AND deleted_at IS NULL AND team_id = ?")
        .bind(mappedTeam).all<{ id: string; team_id: string; value_json: string }>()).results;
      for (const pipeline of pipelines) {
        const settings = safeParse<{ name?: string; type?: string; branch?: string; teamIds?: string[] }>(pipeline.value_json, {});
        if (settings.type !== "continuous" || (settings.branch || "main") !== branch || !settings.teamIds?.includes(mappedTeam)) continue;
        const id = `${pipeline.id}_${headSha}`;
        const timestamp = new Date().toISOString();
        const value = { id, teamId: mappedTeam, name: `${settings.name || "Release"} · ${headSha.slice(0, 8)}`, pipelineId: pipeline.id,
          status: "completed", date: timestamp.slice(0, 10), commitSha: headSha, issueIds: [...shippedIssues], notes: "Created from a GitHub push" };
        await db.prepare("INSERT OR IGNORE INTO records (kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at) VALUES ('release', ?, ?, NULL, ?, 1, ?, ?)")
          .bind(id, mappedTeam, JSON.stringify(value), timestamp, timestamp).run();
      }
    }
    return;
  }

  if (event === "issues" && settings.issueSync && mappedTeam) {
    const source = object(payload.issue);
    if (source.pull_request) return;
    const number = Number(source.number);
    if (!Number.isSafeInteger(number)) return;
    const externalId = repository + "#issue-" + number;
    const existing = await db.prepare("SELECT issue_id FROM integration_links WHERE connection_id = ? AND external_id = ?")
      .bind(connection.id, externalId).first<{ issue_id: string | null }>();
    let issueId = existing?.issue_id || null;
    if (!issueId) {
      const recovered = await db.prepare("SELECT id FROM records WHERE kind = 'issue' AND team_id = ? AND deleted_at IS NULL AND json_extract(value_json, '$.source.provider') = 'github' AND json_extract(value_json, '$.source.repository') = ? AND json_extract(value_json, '$.source.number') = ? LIMIT 1")
        .bind(mappedTeam, repository, number).first<{ id: string }>();
      issueId = recovered?.id || null;
    }
    if (!issueId && action === "opened") {
      issueId = await createExternalIssue(db, "github", mappedTeam, String(source.title || "GitHub issue"),
        String(source.body || ""), { repository, number, url: source.html_url }, String(object(source.user).login || "GitHub"));
    }
    if (!issueId) return;
    if (["opened", "edited", "reopened", "closed", "labeled", "unlabeled"].includes(action)) {
      const labels = Array.isArray(source.labels) ? source.labels.map(label => String(object(label).name || "")).filter(Boolean).slice(0, 30) : [];
      const patch: AnyRecord = { title: String(source.title || "GitHub issue").slice(0, 300), description: String(source.body || "").slice(0, 20_000), labels };
      if (action === "closed") patch.status = (await firstStatusInCategory(db, mappedTeam, "completed"))?.name;
      if (action === "reopened") patch.status = (await firstStatusInCategory(db, mappedTeam, "unstarted"))?.name;
      await updateExternalIssue(db, "github", issueId, patch, "github.issue." + action);
    }
    await upsertLink(db, connection.id, "github", externalId, issueId, null, "issue",
      { repository, number, url: String(source.html_url || ""), state: String(source.state || ""), title: String(source.title || "") });
    return;
  }

  if (event === "issue_comment" && settings.issueSync) {
    const source = object(payload.issue);
    const number = Number(source.number);
    const comment = object(payload.comment);
    if (!Number.isSafeInteger(number) || action !== "created" || !comment.id || /<!-- blanch-linear-comment:[0-9a-f-]{36} -->/.test(String(comment.body || ""))) return;
    const link = await db.prepare("SELECT issue_id FROM integration_links WHERE connection_id = ? AND external_id = ?")
      .bind(connection.id, repository + "#issue-" + number).first<{ issue_id: string | null }>();
    if (link?.issue_id) await appendExternalComment(db, "github", link.issue_id, "github:" + comment.id,
      String(comment.body || ""), String(object(comment.user).login || "GitHub"));
    return;
  }

  if (event === "pull_request_review" || event === "check_run") {
    const pr = object(payload.pull_request);
    const checkPulls = object(payload.check_run).pull_requests;
    const firstCheckPull = Array.isArray(checkPulls) ? object(checkPulls[0]) : {};
    const number = Number(pr.number || firstCheckPull.number);
    if (Number.isSafeInteger(number)) await updateLinkedMetadata(db, connection.id, repository + "#pr-" + number + ":",
      { lastReviewAction: event === "pull_request_review" ? action : undefined, lastCheckAction: event === "check_run" ? action : undefined });
  }
}
