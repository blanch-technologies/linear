import { env } from "cloudflare:workers";
import { ApiError, audit, errorResponse, requireContext } from "../../../../lib/workspace-server";
import { encryptCredentials, newOpaqueState, sha256 } from "../../../../lib/integrations/crypto";
import { consumeState, createState, saveConnection, type Provider } from "../../../../lib/integrations/store";

export const dynamic = "force-dynamic";

function home(request: Request, status: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("integration", status);
  url.hash = "integrations";
  return Response.redirect(url.toString(), 302);
}

export async function GET(request: Request) {
  try {
    const ctx = await requireContext(request);
    const params = new URL(request.url).searchParams;
    const state = params.get("state") || "";
    if (!/^[A-Za-z0-9_-]{40,80}$/.test(state)) throw new ApiError(400, "Invalid integration state");
    const pending = await ctx.db.prepare("SELECT provider FROM integration_states WHERE state_hash = ?")
      .bind(await sha256(state)).first<{ provider: Provider }>();
    const provider = pending?.provider;
    if (!provider || !["slack", "github", "notion"].includes(provider)) throw new ApiError(400, "Unknown integration");
    const context = await consumeState(ctx, provider, state);
    if (!context || context.stage !== (provider === "github" ? "user" : "connect")) throw new ApiError(400, "Integration authorization expired");
    if (params.has("error")) return home(request, "cancelled");
    const code = params.get("code");
    if (!code || code.length > 1000) throw new ApiError(400, "Missing authorization code");
    const redirectUri = new URL(request.url).origin + "/api/integrations/callback";

    if (provider === "slack") {
      if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) throw new ApiError(503, "Slack app setup is incomplete");
      const response = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env.SLACK_CLIENT_ID, client_secret: env.SLACK_CLIENT_SECRET, code, redirect_uri: redirectUri }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; access_token?: string; team?: { id?: string; name?: string }; bot_user_id?: string; authed_user?: { id?: string }; scope?: string };
      if (!response.ok || !result.ok || !result.access_token || !result.team?.id) throw new ApiError(502, "Slack authorization failed");
      const id = await saveConnection(ctx.db, "slack", result.team.id, result.team.name || result.team.id, null,
        { botToken: result.access_token, botUserId: result.bot_user_id, installerSlackUserId: result.authed_user?.id, scopes: result.scope });
      await audit(ctx, "integration.connect", "integration", id, { provider: "slack", externalId: result.team.id });
      return home(request, "slack-connected");
    }

    if (provider === "notion") {
      if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) throw new ApiError(503, "Notion app setup is incomplete");
      const response = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(env.NOTION_CLIENT_ID + ":" + env.NOTION_CLIENT_SECRET), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      });
      const result = await response.json() as { access_token?: string; refresh_token?: string; workspace_id?: string; workspace_name?: string; bot_id?: string };
      if (!response.ok || !result.access_token || !result.workspace_id) throw new ApiError(502, "Notion authorization failed");
      const id = await saveConnection(ctx.db, "notion", result.workspace_id, result.workspace_name || "Notion workspace", ctx.user.userId,
        { accessToken: result.access_token, refreshToken: result.refresh_token, botId: result.bot_id });
      await audit(ctx, "integration.connect", "integration", id, { provider: "notion", externalId: result.workspace_id });
      return home(request, "notion-connected");
    }

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.GITHUB_APP_SLUG) throw new ApiError(503, "GitHub App setup is incomplete");
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri }),
    });
    const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; error?: string };
    if (!response.ok || !result.access_token) throw new ApiError(502, "GitHub authorization failed");
    const installState = newOpaqueState();
    const tokenCipher = await encryptCredentials({
      accessToken: result.access_token, refreshToken: result.refresh_token,
      expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : null,
    }, installState);
    await createState(ctx, "github", installState, { stage: "install", tokenCipher });
    const install = new URL("https://github.com/apps/" + encodeURIComponent(env.GITHUB_APP_SLUG) + "/installations/new");
    install.searchParams.set("state", installState);
    return Response.redirect(install.toString(), 302);
  } catch (error) { return errorResponse(error); }
}
