import { env } from "cloudflare:workers";
import { getChatGPTUser, type ChatGPTUser } from "../app/chatgpt-auth";
import { ipAllowed } from "./ip-policy";
import { ensureDefaultIssueStatuses } from "./issue-workflow";

export type Role = "owner" | "admin" | "member" | "guest";
export type Member = {
  user_id: string;
  email: string;
  display_name: string;
  role: Role;
  status: string;
};
export type Team = {
  id: string;
  name: string;
  key: string;
  parent_id: string | null;
  visibility: "public" | "restricted" | "private";
  triage_enabled: number;
  cycle_duration_days: number;
  cycle_start_date: string | null;
};
export type Context = {
  db: D1Database;
  user: ChatGPTUser;
  member: Member;
  teams: Team[];
  teamMemberships: Set<string>;
  workspaceSettings: Record<string, unknown>;
  request: Request;
  mcpReadOnly?: boolean;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const now = () => new Date().toISOString();
export const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: "Internal server error" }, 500);
}

function database(): D1Database {
  if (!env.DB) throw new ApiError(503, "Workspace database is unavailable");
  return env.DB;
}

export async function requireContext(request: Request): Promise<Context> {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError(401, "Sign in required");
  const db = database();
  const timestamp = now();
  const workspace = await db.prepare("SELECT owner_user_id FROM workspaces WHERE id = ?").bind("default").first<{ owner_user_id: string }>();
  if (!workspace) {
    if (env.BOOTSTRAP_OWNER_EMAIL && user.email.toLowerCase() !== env.BOOTSTRAP_OWNER_EMAIL.toLowerCase())
      throw new ApiError(403, "Workspace setup is reserved for the site owner");
    await db.prepare("INSERT OR IGNORE INTO workspaces (id, name, owner_user_id, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("default", "Linear Workspace", user.userId, JSON.stringify(defaultSettings), timestamp, timestamp).run();
  }
  const ownerRow = await db.prepare("SELECT owner_user_id FROM workspaces WHERE id = ?").bind("default").first<{ owner_user_id: string }>();
  if (ownerRow?.owner_user_id === user.userId) {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO members (user_id, email, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(user.userId, user.email.toLowerCase(), user.displayName, "owner", "active", timestamp, timestamp),
      db.prepare("INSERT OR IGNORE INTO teams (id, name, key, parent_id, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("engineering", "Linear Workspace", "LIN", null, "public", timestamp, timestamp),
      db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)").bind("engineering", user.userId, "owner"),
      db.prepare("INSERT OR IGNORE INTO team_counters (team_id, next_issue_number) VALUES (?, ?)").bind("engineering", 1),
    ]);
    await ensureDefaultIssueStatuses(db, "engineering");
  }
  let member = await db.prepare("SELECT user_id, email, display_name, role, status FROM members WHERE user_id = ?").bind(user.userId).first<Member>();
  if (!member) {
    const invitation = await db.prepare("SELECT * FROM invitations WHERE email = ? AND status = 'pending'").bind(user.email.toLowerCase()).first<{ id: string; role: Role; team_ids_json: string }>();
    if (!invitation) throw new ApiError(403, "You are not a workspace member");
    const teamIds = safeParse<string[]>(invitation.team_ids_json, []);
    if (invitation.role !== "guest") {
      const hierarchy = (await db.prepare("SELECT id, parent_id FROM teams").all<{ id: string; parent_id: string | null }>()).results;
      for (const selected of [...teamIds]) {
        let parent = hierarchy.find(team => team.id === selected)?.parent_id;
        while (parent) {
          if (!teamIds.includes(parent)) teamIds.push(parent);
          parent = hierarchy.find(team => team.id === parent)?.parent_id || null;
        }
      }
    }
    await db.batch([
      db.prepare("INSERT INTO members (user_id, email, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(user.userId, user.email.toLowerCase(), user.displayName, invitation.role, "active", timestamp, timestamp),
      db.prepare("UPDATE invitations SET status = 'accepted', accepted_at = ? WHERE id = ?").bind(timestamp, invitation.id),
      ...teamIds.map(teamId => db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").bind(teamId, user.userId)),
    ]);
    member = await db.prepare("SELECT user_id, email, display_name, role, status FROM members WHERE user_id = ?").bind(user.userId).first<Member>();
    if (!member) throw new ApiError(500, "Could not join workspace");
    await audit({ db, user, request }, "member.join", "member", user.userId, { invitationId: invitation.id });
  }
  if (member.status !== "active") throw new ApiError(403, "Your workspace access is suspended");
  return buildContext(request, db, user, member);
}

export async function contextForMemberId(request: Request, userId: string): Promise<Context> {
  const db = database();
  const member = await db.prepare("SELECT user_id, email, display_name, role, status FROM members WHERE user_id = ?")
    .bind(userId).first<Member>();
  if (!member || member.status !== "active") throw new ApiError(403, "Workspace access is unavailable");
  const user: ChatGPTUser = { userId: member.user_id, email: member.email, displayName: member.display_name, fullName: member.display_name };
  return buildContext(request, db, user, member);
}

async function buildContext(request: Request, db: D1Database, user: ChatGPTUser, member: Member): Promise<Context> {
  const workspaceRow = await db.prepare("SELECT settings_json FROM workspaces WHERE id = ?").bind("default").first<{ settings_json: string }>();
  const workspaceSettings = safeParse<Record<string, unknown>>(workspaceRow?.settings_json, defaultSettings);
  const ipAllowlist = Array.isArray(workspaceSettings.ipAllowlist) ? workspaceSettings.ipAllowlist.filter(x => typeof x === "string") : [];
  if (ipAllowlist.length) {
    const ip = request.headers.get("cf-connecting-ip");
    if (!ipAllowed(ip, ipAllowlist)) throw new ApiError(403, "This network is not allowed by workspace policy");
  }
  const teams = (await db.prepare("SELECT id, name, key, parent_id, visibility, triage_enabled, cycle_duration_days, cycle_start_date FROM teams ORDER BY created_at, name").all<Team>()).results;
  const rows = (await db.prepare("SELECT team_id FROM team_members WHERE user_id = ?").bind(user.userId).all<{ team_id: string }>()).results;
  return { db, user, member, teams, teamMemberships: new Set(rows.map(row => row.team_id)), workspaceSettings, request };
}

export const defaultSettings = {
  name: "Linear Workspace",
  welcomeMessage: "",
  defaultHome: "my",
  invitePolicy: "admins",
  teamCreationPolicy: "admins",
  allowedDomains: [] as string[],
  ipAllowlist: [] as string[],
};

export function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function requireAdmin(ctx: Context, ownerOnly = false) {
  if (ownerOnly ? ctx.member.role !== "owner" : !["owner", "admin"].includes(ctx.member.role))
    throw new ApiError(403, "Administrator access required");
}

export function canReadTeam(ctx: Context, teamId: string | null | undefined): boolean {
  if (!teamId) return ctx.member.role !== "guest";
  const team = ctx.teams.find(item => item.id === teamId);
  if (!team) return false;
  if (ctx.teamMemberships.has(teamId)) return true;
  if (team.visibility === "private") return false;
  if (team.visibility === "restricted") {
    const parent = team.parent_id && ctx.teams.find(item => item.id === team.parent_id);
    return !!parent && ctx.teamMemberships.has(parent.id) && ctx.member.role !== "guest";
  }
  return ctx.member.role !== "guest";
}

export function canWriteTeam(ctx: Context, teamId: string | null | undefined): boolean {
  if (!teamId) return ctx.member.role !== "guest";
  const team = ctx.teams.find(item => item.id === teamId);
  if (!team) return false;
  if (ctx.teamMemberships.has(teamId)) return true;
  if (team.visibility !== "public") return false;
  return ctx.member.role !== "guest";
}

export async function audit(
  source: Pick<Context, "db" | "user" | "request">,
  action: string,
  targetKind: string,
  targetId: string,
  details: Record<string, unknown> = {},
) {
  const ip = source.request.headers.get("cf-connecting-ip");
  const country = source.request.headers.get("cf-ipcountry");
  await source.db.prepare("INSERT INTO audit_events (id, actor_user_id, actor_email, action, target_kind, target_id, details_json, ip_address, country, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), source.user.userId, source.user.email, action, targetKind, targetId, JSON.stringify(details), ip, country, now()).run();
}
