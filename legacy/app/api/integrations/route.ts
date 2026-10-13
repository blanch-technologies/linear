import { env } from "cloudflare:workers";
import { ApiError, audit, canReadTeam, errorResponse, json, now, requireAdmin, requireContext, safeParse } from "../../../lib/workspace-server";
import { decryptCredentials } from "../../../lib/integrations/crypto";
import { githubApi, installationToken } from "../../../lib/integrations/github";
import type { Connection } from "../../../lib/integrations/store";
import { listIssueStatuses } from "../../../lib/issue-workflow";

export const dynamic = "force-dynamic";

function permitted(connection: Connection, userId: string, role: string) {
  return connection.provider === "notion" ? connection.owner_user_id === userId : role === "owner";
}

export async function GET(request: Request) {
  try {
    const ctx = await requireContext(request);
    const connectionId = new URL(request.url).searchParams.get("resources");
    const rows = (await ctx.db.prepare("SELECT * FROM integration_connections WHERE status = 'connected' ORDER BY provider, display_name").all<Connection>()).results
      .filter(connection => permitted(connection, ctx.user.userId, ctx.member.role));
    if (connectionId) {
      const connection = rows.find(row => row.id === connectionId);
      if (!connection) throw new ApiError(404, "Integration connection not found");
      if (connection.provider === "slack") {
        const credentials = await decryptCredentials<{ botToken: string }>(connection.credentials_json, connection.id);
        const resources: Array<{ id: string; name: string }> = [];
        let cursor = "";
        for (let page = 0; page < 5; page++) {
          const url = new URL("https://slack.com/api/conversations.list");
          url.searchParams.set("types", "public_channel,private_channel");
          url.searchParams.set("limit", "200");
          if (cursor) url.searchParams.set("cursor", cursor);
          const response = await fetch(url, { headers: { Authorization: "Bearer " + credentials.botToken } });
          const result = await response.json() as { ok?: boolean; channels?: Array<{ id: string; name: string }>; response_metadata?: { next_cursor?: string } };
          if (!response.ok || !result.ok) throw new ApiError(502, "Could not load Slack channels");
          resources.push(...(result.channels || []).map(channel => ({ id: channel.id, name: channel.name })));
          cursor = result.response_metadata?.next_cursor || "";
          if (!cursor) break;
        }
        return json({ resources });
      }
      if (connection.provider === "github") {
        const credentials = await decryptCredentials<{ installationId: number }>(connection.credentials_json, connection.id);
        const result = await githubApi<{ repositories: Array<{ full_name: string; private: boolean }> }>(
          "/installation/repositories?per_page=100", await installationToken(credentials.installationId));
        return json({ resources: result.repositories.map(repository => ({ id: repository.full_name, name: repository.full_name, private: repository.private })) });
      }
      return json({ resources: [] });
    }
    return json({
      configured: {
        slack: !!(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_SIGNING_SECRET && env.INTEGRATION_ENCRYPTION_KEY),
        github: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_SLUG && env.GITHUB_WEBHOOK_SECRET && env.INTEGRATION_ENCRYPTION_KEY),
        notion: !!(env.NOTION_CLIENT_ID && env.NOTION_CLIENT_SECRET && env.INTEGRATION_ENCRYPTION_KEY),
      },
      connections: rows.map(row => ({
        id: row.id, provider: row.provider, externalId: row.external_id, displayName: row.display_name,
        ownerUserId: row.owner_user_id, settings: safeParse(row.settings_json, {}),
        connectedAt: row.created_at, updatedAt: row.updated_at,
      })),
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext(request);
    const body = await request.json() as { action?: string; id?: string; settings?: Record<string, unknown> };
    if (!body.id || body.id.length > 100) throw new ApiError(400, "Invalid connection");
    const connection = await ctx.db.prepare("SELECT * FROM integration_connections WHERE id = ? AND status = 'connected'")
      .bind(body.id).first<Connection>();
    if (!connection || !permitted(connection, ctx.user.userId, ctx.member.role)) throw new ApiError(404, "Integration connection not found");
    if (connection.provider !== "notion") requireAdmin(ctx, true);
    if (body.action === "disconnect") {
      await ctx.db.batch([
        ctx.db.prepare("DELETE FROM integration_links WHERE connection_id = ?").bind(connection.id),
        ctx.db.prepare("DELETE FROM integration_connections WHERE id = ?").bind(connection.id),
      ]);
      await audit(ctx, "integration.disconnect", "integration", connection.id, { provider: connection.provider });
      return json({ disconnected: true });
    }
    if (body.action !== "settings" || !body.settings || typeof body.settings !== "object" || Array.isArray(body.settings))
      throw new ApiError(400, "Invalid integration action");
    let settings: Record<string, unknown>;
    if (connection.provider === "slack") {
      const teamChannels = body.settings.teamChannels;
      if (!teamChannels || typeof teamChannels !== "object" || Array.isArray(teamChannels)) throw new ApiError(400, "Invalid Slack channel settings");
      const entries = Object.entries(teamChannels);
      if (entries.length > 100 || entries.some(([teamId, channelId]) => !ctx.teams.some(team => team.id === teamId) || !canReadTeam(ctx, teamId) || typeof channelId !== "string" || channelId && !/^[CG][A-Z0-9]{8,20}$/.test(channelId)))
        throw new ApiError(400, "Invalid Slack channel mapping");
      const credentials = await decryptCredentials<{ botToken: string }>(connection.credentials_json, connection.id);
      for (const [teamId, channelId] of entries) {
        if (!channelId) continue;
        const response = await fetch("https://slack.com/api/conversations.info?channel=" + encodeURIComponent(String(channelId)),
          { headers: { Authorization: "Bearer " + credentials.botToken } });
        const result = await response.json() as { ok?: boolean; channel?: { is_private?: boolean; is_member?: boolean } };
        if (!response.ok || !result.ok || !result.channel?.is_member) throw new ApiError(400, "Invite the Slack app into each selected channel first");
        if (ctx.teams.find(team => team.id === teamId)?.visibility !== "public" && !result.channel.is_private)
          throw new ApiError(400, "Restricted and private teams require a private Slack channel");
      }
      settings = { teamChannels: Object.fromEntries(entries.filter(([, channelId]) => channelId)), unfurls: body.settings.unfurls !== false, mentions: body.settings.mentions !== false };
    } else if (connection.provider === "github") {
      const repositories = body.settings.repositories;
      if (!Array.isArray(repositories) || repositories.length > 100 || repositories.some(repo => typeof repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)))
        throw new ApiError(400, "Invalid GitHub repositories");
      const statuses = new Set(["", ...(await listIssueStatuses(ctx.db)).map(status => status.name)]);
      if (!statuses.has(String(body.settings.automateOnOpen || "")) || !statuses.has(String(body.settings.automateOnMerge || "")))
        throw new ApiError(400, "Invalid GitHub status automation");
      const repoTeams = body.settings.repoTeams;
      if (!repoTeams || typeof repoTeams !== "object" || Array.isArray(repoTeams) || Object.entries(repoTeams).some(([repo, team]) => !repositories.includes(repo) || typeof team !== "string" || !ctx.teams.some(item => item.id === team) || !canReadTeam(ctx, team)))
        throw new ApiError(400, "Invalid GitHub team mapping");
      settings = { repositories: [...new Set(repositories)], repoTeams, automateOnOpen: body.settings.automateOnOpen || "", automateOnMerge: body.settings.automateOnMerge || "", issueSync: body.settings.issueSync === true };
    } else {
      settings = {};
    }
    await ctx.db.prepare("UPDATE integration_connections SET settings_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(settings), now(), connection.id).run();
    await audit(ctx, "integration.settings", "integration", connection.id, { provider: connection.provider });
    return json({ settings });
  } catch (error) { return errorResponse(error); }
}
