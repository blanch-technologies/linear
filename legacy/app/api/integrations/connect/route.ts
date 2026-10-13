import { env } from "cloudflare:workers";
import { ApiError, errorResponse, requireAdmin, requireContext } from "../../../../lib/workspace-server";
import { newOpaqueState } from "../../../../lib/integrations/crypto";
import { createState, type Provider } from "../../../../lib/integrations/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireContext(request);
    const provider = new URL(request.url).searchParams.get("provider") as Provider;
    if (!["slack", "github", "notion"].includes(provider)) throw new ApiError(400, "Unknown integration");
    if (provider !== "notion") requireAdmin(ctx, true);
    const state = newOpaqueState();
    await createState(ctx, provider, state, { stage: provider === "github" ? "user" : "connect" });
    const origin = new URL(request.url).origin;
    const redirect = origin + "/api/integrations/callback";
    let url: URL;
    if (provider === "slack") {
      if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET || !env.SLACK_SIGNING_SECRET || !env.INTEGRATION_ENCRYPTION_KEY)
        throw new ApiError(503, "Slack app setup is incomplete");
      url = new URL("https://slack.com/oauth/v2/authorize");
      url.searchParams.set("client_id", env.SLACK_CLIENT_ID);
      url.searchParams.set("scope", "app_mentions:read,channels:history,channels:read,chat:write,commands,groups:history,groups:read,links:read,links:write");
    } else if (provider === "notion") {
      if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET || !env.INTEGRATION_ENCRYPTION_KEY)
        throw new ApiError(503, "Notion connection setup is incomplete");
      url = new URL("https://api.notion.com/v1/oauth/authorize");
      url.searchParams.set("client_id", env.NOTION_CLIENT_ID);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("owner", "user");
    } else {
      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.GITHUB_APP_ID || !env.GITHUB_APP_SLUG || !env.GITHUB_APP_PRIVATE_KEY || !env.INTEGRATION_ENCRYPTION_KEY)
        throw new ApiError(503, "GitHub App setup is incomplete");
      url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    }
    url.searchParams.set("redirect_uri", redirect);
    url.searchParams.set("state", state);
    return Response.redirect(url.toString(), 302);
  } catch (error) { return errorResponse(error); }
}
