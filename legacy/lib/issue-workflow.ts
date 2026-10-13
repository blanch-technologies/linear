export type IssueStatusCategory = "backlog" | "unstarted" | "started" | "completed" | "canceled" | "duplicate";
export type IssueStatus = {
  id: string;
  team_id: string;
  name: string;
  description: string;
  category: IssueStatusCategory;
  position: number;
  is_default: number;
};

export const issueStatusCategories: IssueStatusCategory[] = ["backlog", "unstarted", "started", "completed", "canceled", "duplicate"];
export const defaultIssueStatuses = [
  { slug: "backlog", name: "Backlog", category: "backlog", isDefault: 1 },
  { slug: "todo", name: "Todo", category: "unstarted", isDefault: 0 },
  { slug: "in-progress", name: "In Progress", category: "started", isDefault: 0 },
  { slug: "done", name: "Done", category: "completed", isDefault: 0 },
  { slug: "canceled", name: "Canceled", category: "canceled", isDefault: 0 },
  { slug: "duplicate", name: "Duplicate", category: "duplicate", isDefault: 0 },
] as const;

export async function ensureDefaultIssueStatuses(db: D1Database, teamId: string) {
  const count = await db.prepare("SELECT COUNT(*) AS count FROM issue_statuses WHERE team_id = ?")
    .bind(teamId).first<{ count: number }>();
  if (count?.count) return;
  const stamp = new Date().toISOString();
  await db.batch(defaultIssueStatuses.map((item, position) => db.prepare(
    "INSERT OR IGNORE INTO issue_statuses (id, team_id, name, description, category, position, is_default, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)"
  ).bind(`${teamId}:${item.slug}`, teamId, item.name, item.category, position, item.isDefault, stamp, stamp)));
}

export async function listIssueStatuses(db: D1Database, teamId?: string): Promise<IssueStatus[]> {
  const query = teamId
    ? db.prepare("SELECT id, team_id, name, description, category, position, is_default FROM issue_statuses WHERE team_id = ? ORDER BY CASE category WHEN 'backlog' THEN 0 WHEN 'unstarted' THEN 1 WHEN 'started' THEN 2 WHEN 'completed' THEN 3 WHEN 'canceled' THEN 4 ELSE 5 END, position, created_at").bind(teamId)
    : db.prepare("SELECT id, team_id, name, description, category, position, is_default FROM issue_statuses ORDER BY team_id, CASE category WHEN 'backlog' THEN 0 WHEN 'unstarted' THEN 1 WHEN 'started' THEN 2 WHEN 'completed' THEN 3 WHEN 'canceled' THEN 4 ELSE 5 END, position, created_at");
  return (await query.all<IssueStatus>()).results;
}

export async function statusForTeam(db: D1Database, teamId: string, name: string): Promise<IssueStatus | null> {
  return db.prepare("SELECT id, team_id, name, description, category, position, is_default FROM issue_statuses WHERE team_id = ? AND name = ?")
    .bind(teamId, name).first<IssueStatus>();
}

export async function defaultStatusForTeam(db: D1Database, teamId: string): Promise<IssueStatus | null> {
  return db.prepare("SELECT id, team_id, name, description, category, position, is_default FROM issue_statuses WHERE team_id = ? ORDER BY is_default DESC, position, created_at LIMIT 1")
    .bind(teamId).first<IssueStatus>();
}

export async function firstStatusInCategory(db: D1Database, teamId: string, category: IssueStatusCategory): Promise<IssueStatus | null> {
  return db.prepare("SELECT id, team_id, name, description, category, position, is_default FROM issue_statuses WHERE team_id = ? AND category = ? ORDER BY position, created_at LIMIT 1")
    .bind(teamId, category).first<IssueStatus>();
}
