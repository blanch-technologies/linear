import { now, type Context } from "./workspace-server";

const day = 86400000;
const iso = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

export async function ensureTeamCycles(ctx: Context) {
  const today = Date.parse(now().slice(0, 10) + "T00:00:00Z");
  for (const team of ctx.teams) {
    if (!team.cycle_start_date || ![7, 14, 21, 28].includes(team.cycle_duration_days)) continue;
    const anchor = Date.parse(team.cycle_start_date + "T00:00:00Z");
    if (!Number.isFinite(anchor)) continue;
    const current = Math.max(0, Math.floor((today - anchor) / (team.cycle_duration_days * day)));
    for (let index = Math.max(0, current - 1); index <= current + 2; index++) {
      const start = anchor + index * team.cycle_duration_days * day;
      const end = start + team.cycle_duration_days * day;
      const id = `cycle-${team.id}-${index + 1}`;
      const value = { id, name: `Cycle ${index + 1}`, teamId: team.id, start: iso(start), end: iso(end - day), current: index === current, generated: true };
      await ctx.db.prepare("INSERT OR IGNORE INTO records (kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at) VALUES ('cycle', ?, ?, NULL, ?, 1, ?, ?)")
        .bind(id, team.id, JSON.stringify(value), now(), now()).run();
    }
    if (current > 0) {
      const currentStart = iso(anchor + current * team.cycle_duration_days * day);
      const expired = (await ctx.db.prepare("SELECT json_extract(value_json, '$.name') AS name FROM records WHERE kind = 'cycle' AND team_id = ? AND deleted_at IS NULL AND json_extract(value_json, '$.generated') = 1 AND json_extract(value_json, '$.end') < ?")
        .bind(team.id, currentStart).all<{ name: string }>()).results;
      for (const cycle of expired) {
        const candidates = (await ctx.db.prepare("SELECT id FROM records WHERE kind = 'issue' AND team_id = ? AND deleted_at IS NULL AND json_extract(value_json, '$.cycle') = ? AND json_extract(value_json, '$.status') NOT IN ('Done', 'Canceled')")
          .bind(team.id, cycle.name).all<{ id: string }>()).results;
        if (!candidates.length) continue;
        await ctx.db.prepare("UPDATE records SET value_json = json_set(value_json, '$.cycle', ?), version = version + 1, updated_at = ? WHERE kind = 'issue' AND team_id = ? AND deleted_at IS NULL AND json_extract(value_json, '$.cycle') = ? AND json_extract(value_json, '$.status') NOT IN ('Done', 'Canceled')")
          .bind(`Cycle ${current + 1}`, now(), team.id, cycle.name).run();
        await ctx.db.batch(candidates.map(issue => ctx.db.prepare("INSERT INTO issue_events (id, issue_id, team_id, actor_user_id, action, created_at) VALUES (?, ?, ?, 'system', 'cycle.rollover', ?)")
          .bind(crypto.randomUUID(), issue.id, team.id, now())));
      }
    }
  }
}
