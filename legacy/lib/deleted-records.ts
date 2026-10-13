import { env } from "cloudflare:workers";
import { safeParse, type Context } from "./workspace-server";

const retentionMs = 30 * 86400000;

export async function purgeExpiredRecords(ctx: Context) {
  const cutoff = new Date(Date.now() - retentionMs).toISOString();
  const expired = (await ctx.db.prepare("SELECT kind, id, team_id, value_json FROM records WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at LIMIT 100")
    .bind(cutoff).all<{ kind: string; id: string; team_id: string | null; value_json: string }>()).results;
  for (const row of expired) {
    if (row.kind === "issue") {
      const value = safeParse<{ attachments?: Array<{ key?: string }> }>(row.value_json, {});
      const prefix = `${row.team_id}/${row.id}/`;
      const keys = (value.attachments || []).map(item => item.key).filter((key): key is string => typeof key === "string" && key.startsWith(prefix));
      if (keys.length && !env.BUCKET) continue;
      try { await Promise.all(keys.map(key => env.BUCKET!.delete(key))); }
      catch (error) { console.error("Could not purge issue attachments", row.id, error); continue; }
    }
    await ctx.db.prepare("DELETE FROM records WHERE kind = ? AND id = ? AND deleted_at < ?").bind(row.kind, row.id, cutoff).run();
    if (row.kind === "issue") await ctx.db.batch([
      ctx.db.prepare("DELETE FROM issue_subscriptions WHERE issue_id = ?").bind(row.id),
      ctx.db.prepare("DELETE FROM issue_events WHERE issue_id = ?").bind(row.id),
    ]);
    if (row.kind === "project") await ctx.db.prepare("DELETE FROM project_teams WHERE project_id = ?").bind(row.id).run();
  }
}
