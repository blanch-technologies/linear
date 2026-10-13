import { ApiError, audit, canReadTeam, errorResponse, json, now, requireAdmin, requireContext, safeParse, type Context, type Role } from "../../../lib/workspace-server";
import { ipAllowed, validIpRange } from "../../../lib/ip-policy";
import { ensureDefaultIssueStatuses, issueStatusCategories, listIssueStatuses, type IssueStatusCategory } from "../../../lib/issue-workflow";

export const dynamic = "force-dynamic";

const roles = new Set<Role>(["owner", "admin", "member", "guest"]);
const visibilityOptions = new Set(["public", "restricted", "private"]);

function policyAllows(ctx: Context, key: "invitePolicy" | "teamCreationPolicy") {
  const policy = String(ctx.workspaceSettings[key] || "admins");
  if (ctx.member.role === "owner") return true;
  if (ctx.member.role === "admin") return policy !== "owners";
  return ctx.member.role === "member" && policy === "members";
}

async function canManageTeam(ctx: Context, teamId: string): Promise<boolean> {
  if (["owner", "admin"].includes(ctx.member.role)) return true;
  const row = await ctx.db.prepare("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?")
    .bind(teamId, ctx.user.userId).first<{ role: string }>();
  if (row?.role === "owner") return true;
  const team = ctx.teams.find(item => item.id === teamId);
  return !!team?.parent_id && await canManageTeam(ctx, team.parent_id);
}

function textValue(value: unknown, max = 180): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ApiError(400, "Invalid text value");
  return value.trim();
}

function descendantsDepth(ctx: Context, teamId: string, seen = new Set<string>()): number {
  if (seen.has(teamId)) throw new ApiError(400, "Team hierarchy contains a cycle");
  seen.add(teamId);
  const children = ctx.teams.filter(team => team.parent_id === teamId);
  const depth = children.length ? 1 + Math.max(...children.map(child => descendantsDepth(ctx, child.id, new Set(seen)))) : 1;
  return depth;
}

async function teamDepth(ctx: Context, parentId: string | null): Promise<number> {
  let depth = 0;
  const visited = new Set<string>();
  while (parentId) {
    if (visited.has(parentId)) throw new ApiError(400, "Team hierarchy contains a cycle");
    visited.add(parentId);
    const parent = ctx.teams.find(team => team.id === parentId);
    if (!parent) throw new ApiError(404, "Parent team not found");
    depth++;
    parentId = parent.parent_id;
  }
  return depth;
}

async function ensureOwnerRemains(ctx: Context, targetId: string) {
  const target = await ctx.db.prepare("SELECT role FROM members WHERE user_id = ?").bind(targetId).first<{ role: string }>();
  if (!target) throw new ApiError(404, "Member not found");
  if (target.role === "owner") {
    const count = await ctx.db.prepare("SELECT COUNT(*) AS count FROM members WHERE role = 'owner' AND status = 'active'").first<{ count: number }>();
    if ((count?.count ?? 0) <= 1) throw new ApiError(409, "At least one active owner is required");
  }
  return target;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const stamp = now();

    if (action === "team.create") {
      if (!policyAllows(ctx, "teamCreationPolicy")) throw new ApiError(403, "Team creation is restricted by workspace policy");
      const name = textValue(body.name, 80);
      const key = textValue(body.key, 8).toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,7}$/.test(key)) throw new ApiError(400, "Team key must use 2–8 letters or digits");
      const parentId = body.parentId ? String(body.parentId) : null;
      if (parentId && !canReadTeam(ctx, parentId)) throw new ApiError(403, "Parent team access required");
      const visibility = String(body.visibility || "public");
      if (!visibilityOptions.has(visibility)) throw new ApiError(400, "Invalid team visibility");
      if (visibility === "restricted" && (!parentId || ctx.teams.find(team => team.id === parentId)?.visibility !== "private")) throw new ApiError(400, "Restricted teams require a private parent team");
      const triageEnabled = body.triageEnabled === true ? 1 : 0;
      const cycleDurationDays = Number(body.cycleDurationDays || 14);
      if (![7, 14, 21, 28].includes(cycleDurationDays)) throw new ApiError(400, "Cycle length must be 1–4 weeks");
      if (await teamDepth(ctx, parentId) >= 5) throw new ApiError(400, "Teams can be at most five levels deep");
      const teamId = crypto.randomUUID();
      const parentMemberships: D1PreparedStatement[] = [];
      let ancestor = parentId;
      while (ancestor) {
        parentMemberships.push(ctx.db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").bind(ancestor, ctx.user.userId));
        ancestor = ctx.teams.find(item => item.id === ancestor)?.parent_id || null;
      }
      await ctx.db.batch([
        ctx.db.prepare("INSERT INTO teams (id, name, key, parent_id, visibility, triage_enabled, cycle_duration_days, cycle_start_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(teamId, name, key, parentId, visibility, triageEnabled, cycleDurationDays, stamp.slice(0, 10), stamp, stamp),
        ctx.db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')").bind(teamId, ctx.user.userId),
        ctx.db.prepare("INSERT INTO team_counters (team_id, next_issue_number) VALUES (?, 1)").bind(teamId),
        ...parentMemberships,
      ]);
      await ensureDefaultIssueStatuses(ctx.db, teamId);
      await audit(ctx, action, "team", teamId, { name, visibility, parentId });
      return json({ team: { id: teamId, name, key, parent_id: parentId, visibility } }, 201);
    }

    if (action === "team.update") {
      const teamId = textValue(body.id, 100);
      if (!await canManageTeam(ctx, teamId)) throw new ApiError(403, "Team management access required");
      const team = ctx.teams.find(item => item.id === teamId);
      if (!team) throw new ApiError(404, "Team not found");
      const name = body.name === undefined ? team.name : textValue(body.name, 80);
      const visibility = body.visibility === undefined ? team.visibility : String(body.visibility);
      const triageEnabled = body.triageEnabled === undefined ? team.triage_enabled : body.triageEnabled === true ? 1 : 0;
      const cycleDurationDays = body.cycleDurationDays === undefined ? team.cycle_duration_days : Number(body.cycleDurationDays);
      if (![7, 14, 21, 28].includes(cycleDurationDays)) throw new ApiError(400, "Cycle length must be 1–4 weeks");
      const parentId = body.parentId === undefined ? team.parent_id : body.parentId ? String(body.parentId) : null;
      if (parentId !== team.parent_id && !["owner", "admin"].includes(ctx.member.role)) throw new ApiError(403, "Workspace administrator access required to change parent team");
      if (parentId && !canReadTeam(ctx, parentId)) throw new ApiError(403, "Parent team access required");
      if (!visibilityOptions.has(visibility)) throw new ApiError(400, "Invalid team visibility");
      if (visibility === "restricted" && (!parentId || ctx.teams.find(item => item.id === parentId)?.visibility !== "private")) throw new ApiError(400, "Restricted teams require a private parent team");
      const parentDepth = await teamDepth(ctx, parentId);
      if (parentId === teamId || parentDepth + descendantsDepth(ctx, teamId) > 5) throw new ApiError(400, "Invalid team hierarchy");
      let ancestor = parentId;
      while (ancestor) {
        if (ancestor === teamId) throw new ApiError(400, "Team hierarchy contains a cycle");
        ancestor = ctx.teams.find(item => item.id === ancestor)?.parent_id || null;
      }
      await ctx.db.prepare("UPDATE teams SET name = ?, visibility = ?, parent_id = ?, triage_enabled = ?, cycle_duration_days = ?, cycle_start_date = COALESCE(cycle_start_date, ?), updated_at = ? WHERE id = ?")
        .bind(name, visibility, parentId, triageEnabled, cycleDurationDays, stamp.slice(0, 10), stamp, teamId).run();
      if (parentId && parentId !== team.parent_id) {
        const childMembers = (await ctx.db.prepare("SELECT tm.user_id FROM team_members tm JOIN members m ON m.user_id = tm.user_id WHERE tm.team_id = ? AND m.role != 'guest'")
          .bind(teamId).all<{ user_id: string }>()).results;
        const statements: D1PreparedStatement[] = [];
        let ancestor: string | null = parentId;
        while (ancestor) {
          for (const row of childMembers) statements.push(ctx.db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").bind(ancestor, row.user_id));
          ancestor = ctx.teams.find(item => item.id === ancestor)?.parent_id || null;
        }
        if (statements.length) await ctx.db.batch(statements);
      }
      await audit(ctx, action, "team", teamId, { name, visibility, parentId, triageEnabled, cycleDurationDays });
      return json({ ok: true });
    }

    if (action.startsWith("team.status.")) {
      const teamId = textValue(body.teamId, 100);
      if (!ctx.teams.some(team => team.id === teamId)) throw new ApiError(404, "Team not found");
      if (!await canManageTeam(ctx, teamId)) throw new ApiError(403, "Team management access required");
      const statuses = await listIssueStatuses(ctx.db, teamId);
      const id = typeof body.id === "string" ? body.id : "";
      const current = statuses.find(status => status.id === id);
      if (action === "team.status.create") {
        const name = textValue(body.name, 40);
        if (name.toLowerCase() === "triage" || statuses.some(status => status.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, "Status name already exists");
        const category = String(body.category) as IssueStatusCategory;
        if (!issueStatusCategories.includes(category)) throw new ApiError(400, "Invalid status category");
        const description = body.description === undefined ? "" : String(body.description).trim();
        if (description.length > 180) throw new ApiError(400, "Description is too long");
        const statusId = crypto.randomUUID();
        const position = Math.max(-1, ...statuses.filter(status => status.category === category).map(status => status.position)) + 1;
        await ctx.db.prepare("INSERT INTO issue_statuses (id, team_id, name, description, category, position, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
          .bind(statusId, teamId, name, description, category, position, stamp, stamp).run();
        await audit(ctx, action, "issueStatus", statusId, { teamId, name, category });
        return json({ status: { id: statusId, team_id: teamId, name, description, category, position, is_default: 0 } }, 201);
      }
      if (!current) throw new ApiError(404, "Status not found");
      if (action === "team.status.update") {
        const name = body.name === undefined ? current.name : textValue(body.name, 40);
        const description = body.description === undefined ? current.description : String(body.description).trim();
        const category = body.category === undefined ? current.category : String(body.category) as IssueStatusCategory;
        if (description.length > 180 || !issueStatusCategories.includes(category)) throw new ApiError(400, "Invalid status details");
        if (name.toLowerCase() === "triage" || statuses.some(status => status.id !== id && status.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, "Status name already exists");
        if (current.is_default && !["backlog", "unstarted"].includes(category)) throw new ApiError(400, "Default status must be Backlog or Unstarted");
        const position = category === current.category ? current.position : Math.max(-1, ...statuses.filter(status => status.category === category).map(status => status.position)) + 1;
        await ctx.db.batch([
          ctx.db.prepare("UPDATE issue_statuses SET name = ?, description = ?, category = ?, position = ?, updated_at = ? WHERE id = ? AND team_id = ?")
            .bind(name, description, category, position, stamp, id, teamId),
          ...(name !== current.name ? [
            ctx.db.prepare("INSERT INTO issue_events (id, issue_id, team_id, actor_user_id, action, details_json, created_at) SELECT lower(hex(randomblob(16))), id, team_id, ?, 'update', json_object('changes', json_array(json_object('field', 'status', 'from', ?, 'to', ?))), ? FROM records WHERE kind = 'issue' AND team_id = ? AND deleted_at IS NULL AND json_extract(value_json, '$.status') = ?")
              .bind(ctx.user.userId, current.name, name, stamp, teamId, current.name),
            ctx.db.prepare("UPDATE records SET value_json = json_set(value_json, '$.status', ?), version = version + 1, updated_at = ? WHERE kind IN ('issue', 'issueTemplate') AND team_id = ? AND json_extract(value_json, '$.status') = ?")
              .bind(name, stamp, teamId, current.name),
          ] : []),
        ]);
        await audit(ctx, action, "issueStatus", id, { teamId, name, category });
        return json({ ok: true });
      }
      if (action === "team.status.default") {
        if (!["backlog", "unstarted"].includes(current.category)) throw new ApiError(400, "Default status must be Backlog or Unstarted");
        await ctx.db.batch([
          ctx.db.prepare("UPDATE issue_statuses SET is_default = 0, updated_at = ? WHERE team_id = ?").bind(stamp, teamId),
          ctx.db.prepare("UPDATE issue_statuses SET is_default = 1, updated_at = ? WHERE id = ? AND team_id = ?").bind(stamp, id, teamId),
        ]);
        await audit(ctx, action, "issueStatus", id, { teamId });
        return json({ ok: true });
      }
      if (action === "team.status.delete") {
        const replacement = statuses.find(status => status.id === body.replacementId);
        if (!replacement || replacement.id === id || replacement.category !== current.category) throw new ApiError(400, "Choose a replacement status in the same category");
        await ctx.db.batch([
          ctx.db.prepare("INSERT INTO issue_events (id, issue_id, team_id, actor_user_id, action, details_json, created_at) SELECT lower(hex(randomblob(16))), id, team_id, ?, 'update', json_object('changes', json_array(json_object('field', 'status', 'from', ?, 'to', ?))), ? FROM records WHERE kind = 'issue' AND team_id = ? AND deleted_at IS NULL AND json_extract(value_json, '$.status') = ?")
            .bind(ctx.user.userId, current.name, replacement.name, stamp, teamId, current.name),
          ctx.db.prepare("UPDATE records SET value_json = json_set(value_json, '$.status', ?), version = version + 1, updated_at = ? WHERE kind IN ('issue', 'issueTemplate') AND team_id = ? AND json_extract(value_json, '$.status') = ?")
            .bind(replacement.name, stamp, teamId, current.name),
          ...(current.is_default ? [ctx.db.prepare("UPDATE issue_statuses SET is_default = 1, updated_at = ? WHERE id = ?").bind(stamp, replacement.id)] : []),
          ctx.db.prepare("DELETE FROM issue_statuses WHERE id = ? AND team_id = ?").bind(id, teamId),
        ]);
        await audit(ctx, action, "issueStatus", id, { teamId, replacementId: replacement.id });
        return json({ ok: true });
      }
      if (action === "team.status.move") {
        const direction = body.direction === "up" ? -1 : body.direction === "down" ? 1 : 0;
        const group = statuses.filter(status => status.category === current.category);
        const index = group.findIndex(status => status.id === id);
        const swap = group[index + direction];
        if (!direction || !swap) throw new ApiError(400, "Status cannot move in that direction");
        const reordered = [...group];
        [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
        await ctx.db.batch(reordered.map((status, position) =>
          ctx.db.prepare("UPDATE issue_statuses SET position = ?, updated_at = ? WHERE id = ?").bind(position, stamp, status.id)));
        await audit(ctx, action, "issueStatus", id, { teamId, direction });
        return json({ ok: true });
      }
      throw new ApiError(400, "Unsupported status action");
    }

    if (action === "member.invite") {
      if (!policyAllows(ctx, "invitePolicy")) throw new ApiError(403, "Invitations are restricted by workspace policy");
      const email = textValue(body.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Invalid email address");
      const role = String(body.role || "member") as Role;
      if (!roles.has(role)) throw new ApiError(400, "Invalid role");
      if (ctx.member.role === "member" && role !== "member") throw new ApiError(403, "Members can only invite members");
      if (role === "owner" && ctx.member.role !== "owner") throw new ApiError(403, "Only owners can invite owners");
      const teamIds = Array.isArray(body.teamIds) ? body.teamIds.map(String) : [];
      if (teamIds.some(id => !canReadTeam(ctx, id))) throw new ApiError(400, "Unknown or inaccessible team");
      if (role === "guest" && !teamIds.length) throw new ApiError(400, "Guests require at least one team");
      const existing = await ctx.db.prepare("SELECT user_id FROM members WHERE email = ?").bind(email).first();
      if (existing) throw new ApiError(409, "This person is already a member");
      const invitationId = crypto.randomUUID();
      await ctx.db.prepare("INSERT INTO invitations (id, email, role, team_ids_json, invited_by, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, team_ids_json = excluded.team_ids_json, invited_by = excluded.invited_by, status = 'pending', created_at = excluded.created_at, accepted_at = NULL")
        .bind(invitationId, email, role, JSON.stringify(teamIds), ctx.user.userId, stamp).run();
      await audit(ctx, action, "invitation", email, { role, teamIds });
      return json({ invitation: { email, role, teamIds, status: "pending" }, siteAccessRequired: true }, 201);
    }

    if (action === "member.invite.revoke") {
      const email = textValue(body.email, 254).toLowerCase();
      const invitation = await ctx.db.prepare("SELECT invited_by, status FROM invitations WHERE email = ?").bind(email).first<{ invited_by: string; status: string }>();
      if (!invitation || invitation.status !== "pending") throw new ApiError(404, "Pending invitation not found");
      if (!["owner", "admin"].includes(ctx.member.role) && invitation.invited_by !== ctx.user.userId) throw new ApiError(403, "Invitation management access required");
      await ctx.db.prepare("UPDATE invitations SET status = 'revoked' WHERE email = ? AND status = 'pending'").bind(email).run();
      await audit(ctx, action, "invitation", email);
      return json({ ok: true });
    }

    if (action === "member.role" || action === "member.status") {
      requireAdmin(ctx, action === "member.role");
      const userId = textValue(body.userId, 100);
      if (userId === ctx.user.userId && action === "member.status") throw new ApiError(400, "You cannot suspend yourself");
      const target = await ctx.db.prepare("SELECT role, status FROM members WHERE user_id = ?").bind(userId).first<{ role: string; status: string }>();
      if (!target) throw new ApiError(404, "Member not found");
      if (action === "member.role") {
        const role = String(body.role) as Role;
        if (!roles.has(role)) throw new ApiError(400, "Invalid role");
        if (target.role === "owner" && role !== "owner") await ensureOwnerRemains(ctx, userId);
        await ctx.db.prepare("UPDATE members SET role = ?, updated_at = ? WHERE user_id = ?").bind(role, stamp, userId).run();
        await audit(ctx, action, "member", userId, { role });
      } else {
        if (target.role === "owner" && ctx.member.role !== "owner") throw new ApiError(403, "Only owners can suspend owners");
        const status = String(body.status);
        if (!["active", "suspended"].includes(status)) throw new ApiError(400, "Invalid status");
        if (target.role === "owner" && target.status === "active" && status === "suspended") await ensureOwnerRemains(ctx, userId);
        await ctx.db.prepare("UPDATE members SET status = ?, updated_at = ? WHERE user_id = ?").bind(status, stamp, userId).run();
        await audit(ctx, action, "member", userId, { status });
      }
      return json({ ok: true });
    }

    if (action === "team.member.add" || action === "team.member.remove") {
      const teamId = textValue(body.teamId, 100);
      if (!await canManageTeam(ctx, teamId)) throw new ApiError(403, "Team management access required");
      const userId = textValue(body.userId, 100);
      if (!ctx.teams.some(team => team.id === teamId)) throw new ApiError(404, "Team not found");
      const member = await ctx.db.prepare("SELECT role FROM members WHERE user_id = ? AND status = 'active'").bind(userId).first<{ role: string }>();
      if (!member) throw new ApiError(404, "Active member not found");
      if (action.endsWith("remove")) {
        const child = await ctx.db.prepare("WITH RECURSIVE descendants(id) AS (SELECT id FROM teams WHERE parent_id = ? UNION ALL SELECT t.id FROM teams t JOIN descendants d ON t.parent_id = d.id) SELECT 1 AS present FROM team_members WHERE user_id = ? AND team_id IN (SELECT id FROM descendants) LIMIT 1")
          .bind(teamId, userId).first();
        if (child && member.role !== "guest") throw new ApiError(409, "Remove the member from their sub-team first");
      }
      if (action.endsWith("add")) {
        const statements: D1PreparedStatement[] = [];
        let ancestor = ctx.teams.find(item => item.id === teamId)?.parent_id;
        while (ancestor && member.role !== "guest") {
          statements.push(ctx.db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").bind(ancestor, userId));
          ancestor = ctx.teams.find(item => item.id === ancestor)?.parent_id || null;
        }
        statements.push(ctx.db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").bind(teamId, userId));
        await ctx.db.batch(statements);
      }
      else await ctx.db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").bind(teamId, userId).run();
      await audit(ctx, action, "team", teamId, { userId });
      return json({ ok: true });
    }

    if (action === "team.member.role") {
      const teamId = textValue(body.teamId, 100);
      const userId = textValue(body.userId, 100);
      if (!ctx.teams.some(team => team.id === teamId)) throw new ApiError(404, "Team not found");
      if (!await canManageTeam(ctx, teamId)) throw new ApiError(403, "Team management access required");
      const role = String(body.role);
      if (!["owner", "member"].includes(role)) throw new ApiError(400, "Invalid team role");
      const target = await ctx.db.prepare("SELECT tm.role AS team_role, m.role AS workspace_role FROM team_members tm JOIN members m ON m.user_id = tm.user_id WHERE tm.team_id = ? AND tm.user_id = ?")
        .bind(teamId, userId).first<{ team_role: string; workspace_role: string }>();
      if (!target) throw new ApiError(404, "Team member not found");
      if (role === "owner" && target.workspace_role === "guest") throw new ApiError(403, "Guests cannot own teams");
      await ctx.db.prepare("UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?").bind(role, teamId, userId).run();
      await audit(ctx, action, "team", teamId, { userId, role });
      return json({ ok: true });
    }

    if (action === "settings.update") {
      requireAdmin(ctx, true);
      const patch = body.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ApiError(400, "Invalid settings");
      const allowed = new Set(["name", "welcomeMessage", "defaultHome", "invitePolicy", "teamCreationPolicy", "allowedDomains", "ipAllowlist"]);
      const updates = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
      if (Object.keys(updates).length !== Object.keys(patch).length) throw new ApiError(400, "Unsupported setting");
      if (updates.name !== undefined) updates.name = textValue(updates.name, 80);
      if (updates.welcomeMessage !== undefined && (typeof updates.welcomeMessage !== "string" || updates.welcomeMessage.length > 2000)) throw new ApiError(400, "Invalid welcome message");
      if (updates.invitePolicy !== undefined && !["owners", "admins", "members"].includes(String(updates.invitePolicy))) throw new ApiError(400, "Invalid invitation policy");
      if (updates.teamCreationPolicy !== undefined && !["owners", "admins", "members"].includes(String(updates.teamCreationPolicy))) throw new ApiError(400, "Invalid team creation policy");
      if (updates.defaultHome !== undefined && !["my", "inbox", "dashboards"].includes(String(updates.defaultHome))) throw new ApiError(400, "Invalid default home");
      if (updates.allowedDomains !== undefined) {
        if (!Array.isArray(updates.allowedDomains) || updates.allowedDomains.some(value => typeof value !== "string" || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value))) throw new ApiError(400, "Invalid allowed domains");
        if (updates.allowedDomains.length) throw new ApiError(400, "Verify a company domain and configure Site access before enabling approved-domain self-join");
        updates.allowedDomains = updates.allowedDomains.map(value => (value as string).toLowerCase());
      }
      if (updates.ipAllowlist !== undefined) {
        if (!Array.isArray(updates.ipAllowlist) || updates.ipAllowlist.some(value => typeof value !== "string" || !validIpRange(value))) throw new ApiError(400, "Invalid IP allowlist");
        const currentIp = request.headers.get("cf-connecting-ip");
        if (updates.ipAllowlist.length && !ipAllowed(currentIp, updates.ipAllowlist as string[])) throw new ApiError(400, "Include your current IP before enabling the allowlist");
      }
      const settings = { ...ctx.workspaceSettings, ...updates };
      await ctx.db.prepare("UPDATE workspaces SET name = ?, settings_json = ?, updated_at = ? WHERE id = 'default'")
        .bind(String(settings.name || "Linear Workspace"), JSON.stringify(settings), stamp).run();
      await audit(ctx, action, "workspace", "default", { fields: Object.keys(updates) });
      return json({ settings });
    }

    if (action === "announcement.create") {
      requireAdmin(ctx);
      const title = textValue(body.title, 140);
      const bodyText = textValue(body.body, 5000);
      const teamId = body.teamId ? String(body.teamId) : null;
      if (teamId && !ctx.teams.some(team => team.id === teamId)) throw new ApiError(404, "Team not found");
      const id = crypto.randomUUID();
      const recipients = teamId
        ? (await ctx.db.prepare("SELECT m.user_id FROM members m JOIN team_members tm ON tm.user_id = m.user_id WHERE tm.team_id = ? AND m.status = 'active' AND m.role != 'guest'")
          .bind(teamId).all<{ user_id: string }>()).results
        : (await ctx.db.prepare("SELECT user_id FROM members WHERE status = 'active' AND role != 'guest'").all<{ user_id: string }>()).results;
      const value = { id, title, body: bodyText, teamId, createdBy: ctx.user.displayName, createdAt: stamp, delivery: { inbox: recipients.length, email: "not configured", slack: "not configured" } };
      const statements = [ctx.db.prepare("INSERT INTO records (kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at) VALUES ('announcement', ?, ?, NULL, ?, 1, ?, ?)")
        .bind(id, teamId, JSON.stringify(value), stamp, stamp)];
      for (const recipient of recipients) {
        const noticeId = crypto.randomUUID();
        statements.push(ctx.db.prepare("INSERT INTO records (kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at) VALUES ('notification', ?, ?, ?, ?, 1, ?, ?)")
          .bind(noticeId, teamId, recipient.user_id, JSON.stringify({ id: noticeId, announcementId: id, issue: "", text: `Announcement: ${title}`, time: "Now", read: false, createdAt: stamp }), stamp, stamp));
      }
      await ctx.db.batch(statements);
      await audit(ctx, action, "announcement", id, { teamId, recipients: recipients.length });
      return json({ announcement: value }, 201);
    }

    if (action === "welcome.seen") {
      await ctx.db.prepare("UPDATE members SET welcome_seen_at = ? WHERE user_id = ? AND welcome_seen_at IS NULL").bind(stamp, ctx.user.userId).run();
      return json({ ok: true });
    }

    if (action === "app.request") {
      if (ctx.member.role === "guest") throw new ApiError(403, "Guests cannot request workspace applications");
      const name = textValue(body.name, 140);
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 2000) : "";
      const id = crypto.randomUUID();
      const value = { id, name, reason, status: "suggested", requestedBy: ctx.user.displayName, requestedById: ctx.user.userId, createdAt: stamp };
      await ctx.db.prepare("INSERT INTO records (kind, id, team_id, owner_user_id, value_json, version, created_at, updated_at) VALUES ('appRequest', ?, NULL, NULL, ?, 1, ?, ?)")
        .bind(id, JSON.stringify(value), stamp, stamp).run();
      await audit(ctx, action, "appRequest", id, { name });
      return json({ request: value }, 201);
    }

    if (action === "app.decide") {
      requireAdmin(ctx, true);
      const id = textValue(body.id, 100);
      const decision = String(body.decision);
      if (!["reviewed", "dismissed"].includes(decision)) throw new ApiError(400, "Invalid decision");
      const row = await ctx.db.prepare("SELECT value_json, version FROM records WHERE kind = 'appRequest' AND id = ?").bind(id).first<{ value_json: string; version: number }>();
      if (!row) throw new ApiError(404, "Request not found");
      const value = { ...safeParse<Record<string, unknown>>(row.value_json, {}), status: decision, decidedBy: ctx.user.displayName, decidedAt: stamp };
      await ctx.db.prepare("UPDATE records SET value_json = ?, version = version + 1, updated_at = ? WHERE kind = 'appRequest' AND id = ?")
        .bind(JSON.stringify(value), stamp, id).run();
      await audit(ctx, action, "appRequest", id, { decision });
      return json({ request: value });
    }

    throw new ApiError(400, "Unsupported action");
  } catch (error) { return errorResponse(error); }
}
