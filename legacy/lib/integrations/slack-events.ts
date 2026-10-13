import { safeParse } from "../workspace-server";
import { createExternalIssue, appendExternalComment } from "./issues";
import { findConnection, upsertLink, type Connection } from "./store";
import { decryptCredentials } from "./crypto";

type AnyRecord = Record<string, unknown>;
type SlackSettings = { teamChannels?: Record<string, string>; unfurls?: boolean; mentions?: boolean };

function obj(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

async function slackApi<T extends { ok?: boolean; error?: string }>(token: string, method: string, body: AnyRecord): Promise<T> {
  const response = await fetch("https://slack.com/api/" + method, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as T;
  if (!response.ok || !result.ok) throw new Error("Slack " + method + " failed: " + String(result.error || response.status));
  return result;
}

function mappedTeam(settings: SlackSettings, channel: string): string | null {
  return Object.entries(settings.teamChannels || {}).find(([, value]) => value === channel)?.[0] || null;
}

async function createFromSlack(db: D1Database, connection: Connection, channel: string, text: string, user: string, ts: string, origin: string) {
  const settings = safeParse<SlackSettings>(connection.settings_json, {});
  const teamId = mappedTeam(settings, channel);
  if (!teamId) return;
  const credentials = await decryptCredentials<{ botToken: string }>(connection.credentials_json, connection.id);
  const cleaned = text.replace(/<@[A-Z0-9]+>/g, "").replace(/^\s*(?:create|ask|issue)\s*/i, "").trim();
  const [first, ...rest] = cleaned.split(/\n/);
  if (!first) return;
  const recovered = ts ? await db.prepare("SELECT id FROM records WHERE kind = 'issue' AND team_id = ? AND deleted_at IS NULL AND json_extract(value_json, '$.source.provider') = 'slack' AND json_extract(value_json, '$.source.workspaceId') = ? AND json_extract(value_json, '$.source.channel') = ? AND json_extract(value_json, '$.source.messageTs') = ? LIMIT 1")
    .bind(teamId, connection.external_id, channel, ts).first<{ id: string }>() : null;
  const issueId = recovered?.id || await createExternalIssue(db, "slack", teamId, first.slice(0, 180), rest.join("\n"),
    { workspaceId: connection.external_id, channel, messageTs: ts }, "Slack user " + user);
  if (ts) {
    const linked = await db.prepare("SELECT 1 AS present FROM integration_links WHERE connection_id = ? AND provider = 'slack' AND external_id = ?")
      .bind(connection.id, channel + ":" + ts).first();
    if (linked) return;
  }
  const url = origin + "/#issue/" + encodeURIComponent(issueId);
  const posted = await slackApi<{ ok: boolean; ts?: string }>(credentials.botToken, "chat.postMessage", {
    channel, thread_ts: ts || undefined, text: "Created <" + url + "|" + issueId + "> from this Slack message.", unfurl_links: false,
  });
  await upsertLink(db, connection.id, "slack", channel + ":" + (ts || posted.ts || issueId), issueId, null, "thread",
    { channel, threadTs: ts || posted.ts, url });
}

async function unfurl(db: D1Database, connection: Connection, event: AnyRecord, origin: string) {
  const settings = safeParse<SlackSettings>(connection.settings_json, {});
  if (settings.unfurls === false) return;
  const links = Array.isArray(event.links) ? event.links.slice(0, 10) : [];
  const blocks: Record<string, AnyRecord> = {};
  for (const item of links) {
    const raw = obj(item).url;
    if (typeof raw !== "string") continue;
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (url.origin !== origin) continue;
    const issueId = decodeURIComponent(url.hash.replace(/^#issue\//, ""));
    if (!/^#[Ii]ssue\//.test(url.hash) || !/^[A-Z][A-Z0-9]{1,11}-\d+$/.test(issueId)) continue;
    const row = await db.prepare("SELECT r.value_json, t.visibility FROM records r JOIN teams t ON t.id = r.team_id WHERE r.kind = 'issue' AND r.id = ? AND r.deleted_at IS NULL")
      .bind(issueId).first<{ value_json: string; visibility: string }>();
    if (!row || row.visibility !== "public") continue;
    const issue = safeParse<{ title?: string; status?: string; description?: string }>(row.value_json, {});
    blocks[raw] = { text: issueId + " · " + String(issue.title || "Issue"), blocks: [
      { type: "section", text: { type: "mrkdwn", text: "*<" + raw + "|" + issueId + ">* · " + String(issue.title || "Issue").slice(0, 180) } },
      { type: "context", elements: [{ type: "mrkdwn", text: "Status: " + String(issue.status || "Backlog") }] },
    ] };
  }
  if (!Object.keys(blocks).length) return;
  const credentials = await decryptCredentials<{ botToken: string }>(connection.credentials_json, connection.id);
  await slackApi(credentials.botToken, "chat.unfurl", { channel: event.channel, ts: event.message_ts, unfurls: blocks });
}

export async function processSlackEvent(db: D1Database, payload: AnyRecord, origin: string) {
  const workspaceId = String(payload.team_id || obj(payload.team).id || "");
  if (!workspaceId) return;
  const connection = await findConnection(db, "slack", workspaceId);
  if (!connection) return;
  const event = obj(payload.event);
  const eventType = String(event.type || "");
  const settings = safeParse<SlackSettings>(connection.settings_json, {});
  if (eventType === "link_shared") return unfurl(db, connection, event, origin);
  if (eventType === "app_mention" && settings.mentions !== false) {
    await createFromSlack(db, connection, String(event.channel || ""), String(event.text || ""), String(event.user || ""), String(event.ts || ""), origin);
    return;
  }
  if (eventType !== "message" || event.subtype || event.bot_id || !event.thread_ts || !event.ts) return;
  const channel = String(event.channel || "");
  if (!mappedTeam(settings, channel)) return;
  const link = await db.prepare("SELECT issue_id FROM integration_links WHERE connection_id = ? AND provider = 'slack' AND external_id = ?")
    .bind(connection.id, channel + ":" + String(event.thread_ts)).first<{ issue_id: string | null }>();
  if (link?.issue_id) await appendExternalComment(db, "slack", link.issue_id, "slack:" + channel + ":" + event.ts,
    String(event.text || ""), "Slack user " + String(event.user || ""));
}

export async function processSlackCommand(db: D1Database, params: URLSearchParams, origin: string) {
  if (params.get("command") !== "/blanch") return;
  const workspaceId = params.get("team_id") || "";
  const connection = await findConnection(db, "slack", workspaceId);
  if (!connection) return;
  await createFromSlack(db, connection, params.get("channel_id") || "", params.get("text") || "",
    params.get("user_id") || "", "", origin);
}

export async function processSlackShortcut(db: D1Database, payload: AnyRecord, origin: string) {
  const connection = await findConnection(db, "slack", String(obj(payload.team).id || ""));
  if (!connection || payload.type !== "message_action" || payload.callback_id !== "create_issue") return;
  const message = obj(payload.message);
  await createFromSlack(db, connection, String(obj(payload.channel).id || ""), String(message.text || ""),
    String(obj(payload.user).id || ""), String(message.ts || ""), origin);
}
