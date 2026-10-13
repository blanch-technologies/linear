import { ApiError, audit, errorResponse, json, now, requireContext } from "../../../lib/workspace-server";
import { createMcpToken } from "../../../lib/mcp-tokens";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireContext(request);
    const rows = (await ctx.db.prepare("SELECT id, name, scope, expires_at, revoked_at, last_used_at, created_at FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(ctx.user.userId).all()).results;
    return json({ tokens: rows });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext(request);
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "create") {
      const scope = body.scope === "read" ? "read" : body.scope === "read write" ? "read write" : null;
      if (!scope) throw new ApiError(400, "Invalid token scope");
      const token = await createMcpToken(ctx.user.userId, String(body.name || ""), scope, Number(body.days));
      await audit(ctx, "mcp_token.create", "mcp_token", token.id, { scope, expiresAt: token.expiresAt });
      return json(token, 201);
    }
    if (body.action === "revoke") {
      const id = String(body.id || "");
      const result = await ctx.db.prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
        .bind(now(), id, ctx.user.userId).run();
      if (!result.meta.changes) throw new ApiError(404, "Token not found");
      await audit(ctx, "mcp_token.revoke", "mcp_token", id);
      return json({ revoked: true });
    }
    throw new ApiError(400, "Unsupported token action");
  } catch (error) { return errorResponse(error); }
}
