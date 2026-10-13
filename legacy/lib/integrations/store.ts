import { encryptCredentials, sha256 } from "./crypto";
import { now, type Context } from "../workspace-server";

export type Provider = "slack" | "github" | "notion";
export type Connection = {
  id: string;
  provider: Provider;
  external_id: string;
  display_name: string;
  owner_user_id: string | null;
  status: string;
  credentials_json: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
};

export async function createState(ctx: Context, provider: Provider, state: string, context: Record<string, unknown> = {}) {
  const stamp = now();
  await ctx.db.prepare("DELETE FROM integration_states WHERE expires_at < ?").bind(stamp).run();
  await ctx.db.prepare("INSERT INTO integration_states (state_hash, provider, user_id, expires_at, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256(state), provider, ctx.user.userId, new Date(Date.now() + 10 * 60_000).toISOString(), JSON.stringify(context), stamp).run();
}

export async function consumeState(ctx: Context, provider: Provider, state: string) {
  const hash = await sha256(state);
  const row = await ctx.db.prepare("SELECT user_id, expires_at, context_json FROM integration_states WHERE state_hash = ? AND provider = ?")
    .bind(hash, provider).first<{ user_id: string; expires_at: string; context_json: string }>();
  await ctx.db.prepare("DELETE FROM integration_states WHERE state_hash = ?").bind(hash).run();
  return row && row.user_id === ctx.user.userId && row.expires_at > now() ? JSON.parse(row.context_json) as Record<string, unknown> : null;
}

export async function saveConnection(
  db: D1Database, provider: Provider, externalId: string, displayName: string,
  ownerUserId: string | null, credentials: Record<string, unknown>, settings: Record<string, unknown> = {},
) {
  const existing = await db.prepare("SELECT id, settings_json FROM integration_connections WHERE provider = ? AND external_id = ? AND owner_user_id IS ?")
    .bind(provider, externalId, ownerUserId).first<{ id: string; settings_json: string }>();
  const id = existing?.id || crypto.randomUUID();
  const encrypted = await encryptCredentials(credentials, id);
  const stamp = now();
  await db.prepare("INSERT INTO integration_connections (id, provider, external_id, display_name, owner_user_id, status, credentials_json, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, status = 'connected', credentials_json = excluded.credentials_json, settings_json = excluded.settings_json, updated_at = excluded.updated_at")
    .bind(id, provider, externalId, displayName.slice(0, 180), ownerUserId, encrypted, existing?.settings_json || JSON.stringify(settings), stamp, stamp).run();
  return id;
}

export async function findConnection(db: D1Database, provider: Provider, externalId: string) {
  return db.prepare("SELECT * FROM integration_connections WHERE provider = ? AND external_id = ? AND status = 'connected' LIMIT 1")
    .bind(provider, externalId).first<Connection>();
}

export async function recordDelivery(db: D1Database, provider: Provider, deliveryId: string): Promise<boolean> {
  const stamp = now();
  const result = await db.prepare("INSERT OR IGNORE INTO integration_deliveries (provider, delivery_id, status, created_at, updated_at) VALUES (?, ?, 'received', ?, ?)")
    .bind(provider, deliveryId, stamp, stamp).run();
  if (result.meta.changes) return true;
  const retried = await db.prepare("UPDATE integration_deliveries SET status = 'received', error = NULL, updated_at = ? WHERE provider = ? AND delivery_id = ? AND status = 'failed'")
    .bind(stamp, provider, deliveryId).run();
  return !!retried.meta.changes;
}

export async function finishDelivery(db: D1Database, provider: Provider, deliveryId: string, error?: string) {
  await db.prepare("UPDATE integration_deliveries SET status = ?, error = ?, updated_at = ? WHERE provider = ? AND delivery_id = ?")
    .bind(error ? "failed" : "processed", error?.slice(0, 300) || null, now(), provider, deliveryId).run();
}

export async function upsertLink(
  db: D1Database, connectionId: string, provider: Provider, externalId: string,
  issueId: string | null, projectId: string | null, kind: string, metadata: Record<string, unknown>,
) {
  const existing = await db.prepare("SELECT id FROM integration_links WHERE connection_id = ? AND provider = ? AND external_id = ?")
    .bind(connectionId, provider, externalId).first<{ id: string }>();
  const stamp = now();
  await db.prepare("INSERT INTO integration_links (id, connection_id, provider, external_id, issue_id, project_id, kind, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET issue_id = excluded.issue_id, project_id = excluded.project_id, kind = excluded.kind, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at")
    .bind(existing?.id || crypto.randomUUID(), connectionId, provider, externalId, issueId, projectId, kind, JSON.stringify(metadata), stamp, stamp).run();
}
