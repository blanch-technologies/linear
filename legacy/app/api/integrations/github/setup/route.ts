import { env } from "cloudflare:workers";
import { ApiError, audit, errorResponse, requireAdmin, requireContext } from "../../../../../lib/workspace-server";
import { decryptCredentials } from "../../../../../lib/integrations/crypto";
import { githubApi, githubAppJwt } from "../../../../../lib/integrations/github";
import { consumeState, saveConnection } from "../../../../../lib/integrations/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireContext(request);
    requireAdmin(ctx, true);
    const params = new URL(request.url).searchParams;
    const state = params.get("state") || "";
    const installId = Number(params.get("installation_id"));
    if (!state || !Number.isSafeInteger(installId) || installId <= 0) throw new ApiError(400, "Invalid GitHub installation");
    const context = await consumeState(ctx, "github", state);
    if (!context || context.stage !== "install" || typeof context.tokenCipher !== "string") throw new ApiError(400, "GitHub installation expired");
    const tokens = await decryptCredentials<{ accessToken: string; refreshToken?: string; expiresAt?: number }>(context.tokenCipher, state);
    let authorized = false;
    for (let page = 1; page <= 5 && !authorized; page++) {
      const result = await githubApi<{ installations: Array<{ id: number }> }>("/user/installations?per_page=100&page=" + page, tokens.accessToken);
      authorized = result.installations.some(item => item.id === installId);
      if (result.installations.length < 100) break;
    }
    if (!authorized) throw new ApiError(403, "GitHub installation does not belong to your account");
    const installation = await githubApi<{ id: number; app_id: number; account?: { login?: string }; suspended_at?: string | null }>(
      "/app/installations/" + installId, await githubAppJwt());
    if (String(installation.app_id) !== env.GITHUB_APP_ID || installation.suspended_at) throw new ApiError(403, "GitHub App installation is unavailable");
    const id = await saveConnection(ctx.db, "github", String(installId), installation.account?.login || "GitHub installation", null,
      { installationId: installId },
      { automateOnOpen: "In Progress", automateOnMerge: "Done", issueSync: false, repositories: [], repoTeams: {} });
    await audit(ctx, "integration.connect", "integration", id, { provider: "github", installationId: installId });
    const target = new URL("/", request.url);
    target.searchParams.set("integration", "github-connected");
    target.hash = "integrations";
    return Response.redirect(target.toString(), 302);
  } catch (error) { return errorResponse(error); }
}
