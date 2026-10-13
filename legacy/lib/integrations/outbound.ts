import { safeParse } from "../workspace-server";
import { decryptCredentials } from "./crypto";
import { githubApi, installationToken } from "./github";
import { upsertLink, type Connection } from "./store";
import { statusForTeam } from "../issue-workflow";

type Issue = Record<string, unknown>;
type SlackSettings = { teamChannels?: Record<string, string> };
type GitHubSettings = { repositories?: string[]; repoTeams?: Record<string, string>; issueSync?: boolean };
type LinkedRow = { connection_id: string; metadata_json: string };

function slackText(value: unknown) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 1500);
}

async function postSlack(token: string, channel: string, text: string, threadTs?: string) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text, thread_ts: threadTs, parse: "none", link_names: false, unfurl_links: false }),
  });
  const body = await response.json() as { ok?: boolean; ts?: string; error?: string };
  if (!response.ok || !body.ok) throw new Error("Slack post failed: " + String(body.error || response.status));
  return body.ts || "";
}

async function syncSlack(db: D1Database, issue: Issue, action: "create" | "update" | "comment", origin: string, detail: string) {
  const rows = (await db.prepare("SELECT * FROM integration_connections WHERE provider = 'slack' AND status = 'connected'")
    .all<Connection>()).results;
  const issueId = String(issue.id || "");
  const teamId = String(issue.teamId || "");
  for (const connection of rows) {
    const settings = safeParse<SlackSettings>(connection.settings_json, {});
    const channel = settings.teamChannels?.[teamId];
    if (!channel) continue;
    const credentials = await decryptCredentials<{ botToken: string }>(connection.credentials_json, connection.id);
    const url = origin + "/#issue/" + encodeURIComponent(issueId);
    if (action === "create") {
      const text = "New issue <" + url + "|" + issueId + "> · " + slackText(issue.title);
      const ts = await postSlack(credentials.botToken, channel, text);
      await upsertLink(db, connection.id, "slack", channel + ":" + ts, issueId, null, "thread", { channel, threadTs: ts });
      continue;
    }
    const link = await db.prepare("SELECT metadata_json FROM integration_links WHERE connection_id = ? AND provider = 'slack' AND issue_id = ? AND kind = 'thread' ORDER BY created_at DESC LIMIT 1")
      .bind(connection.id, issueId).first<{ metadata_json: string }>();
    if (!link) continue;
    const metadata = safeParse<{ channel?: string; threadTs?: string }>(link.metadata_json, {});
    if (metadata.channel !== channel || !metadata.threadTs) continue;
    const text = action === "comment" ? "New comment on <" + url + "|" + issueId + ">: " + slackText(detail)
      : "<" + url + "|" + issueId + "> updated: " + slackText(detail);
    await postSlack(credentials.botToken, channel, text, metadata.threadTs);
  }
}

async function syncGitHub(db: D1Database, issue: Issue, action: "create" | "update" | "comment", detail: string, commentId?: string) {
  if (action === "create") return;
  const links = (await db.prepare("SELECT connection_id, metadata_json FROM integration_links WHERE provider = 'github' AND kind = 'issue' AND issue_id = ?")
    .bind(String(issue.id)).all<LinkedRow>()).results;
  for (const link of links) {
    const metadata = safeParse<{ repository?: string; number?: number }>(link.metadata_json, {});
    if (!metadata.repository || !Number.isSafeInteger(metadata.number) || !/^[-\w.]+\/[-\w.]+$/.test(metadata.repository)) continue;
    const connection = await db.prepare("SELECT * FROM integration_connections WHERE id = ? AND provider = 'github' AND status = 'connected'")
      .bind(link.connection_id).first<Connection>();
    if (!connection) continue;
    const settings = safeParse<GitHubSettings>(connection.settings_json, {});
    if (!settings.issueSync || !settings.repositories?.includes(metadata.repository) || settings.repoTeams?.[metadata.repository] !== issue.teamId) continue;
    const credentials = await decryptCredentials<{ installationId: number }>(connection.credentials_json, connection.id);
    const token = await installationToken(credentials.installationId);
    const path = "/repos/" + metadata.repository + "/issues/" + metadata.number;
    if (action === "comment") {
      await githubApi(path + "/comments", token, { method: "POST", body: JSON.stringify({ body: detail.slice(0, 9_900) + (commentId ? "\n\n<!-- blanch-linear-comment:" + commentId + " -->" : "") }) });
    } else {
      const status = await statusForTeam(db, String(issue.teamId), String(issue.status));
      await githubApi(path, token, { method: "PATCH", body: JSON.stringify({
        title: String(issue.title || "Issue").slice(0, 180), body: String(issue.description || "").slice(0, 50_000),
        state: status && ["completed", "canceled", "duplicate"].includes(status.category) ? "closed" : "open",
      }) });
    }
  }
}

export async function syncIssueOutbound(db: D1Database, issue: Issue, action: "create" | "update" | "comment", origin: string, detail: string, commentId?: string) {
  const results = await Promise.allSettled([syncSlack(db, issue, action, origin, detail), syncGitHub(db, issue, action, detail, commentId)]);
  for (const result of results) if (result.status === "rejected") console.error("Integration delivery failed", result.reason);
}
