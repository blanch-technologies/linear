import { env } from "cloudflare:workers";
import { ApiError, contextForMemberId, now, type Context } from "./workspace-server";

type TokenRow = { id: string; user_id: string; secret_hash: string; scope: string; expires_at: string; revoked_at: string | null };

function db(): D1Database {
  if (!env.DB) throw new ApiError(503, "Workspace database is unavailable");
  return env.DB;
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function equalDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

async function verifiedClientRequest(request: Request, token: string): Promise<Request> {
  const secret = env.MCP_GATEWAY_SIGNING_SECRET;
  if (!secret) throw new ApiError(503, "MCP gateway signing is not configured");
  const ip = request.headers.get("x-blanch-client-ip") || "";
  const timestamp = request.headers.get("x-blanch-client-time") || "";
  const signature = request.headers.get("x-blanch-client-signature") || "";
  if (!ip || ip.length > 100 || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 120_000 || !/^[a-f0-9]{64}$/.test(signature))
    throw new ApiError(401, "Invalid MCP gateway signature");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}\n${ip}\n${token}`));
  const hex = [...new Uint8Array(expected)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (!equalDigest(hex, signature)) throw new ApiError(401, "Invalid MCP gateway signature");
  const headers = new Headers(request.headers);
  headers.set("cf-connecting-ip", ip);
  return new Request(request.url, { method: "POST", headers });
}

export async function createMcpToken(userId: string, name: string, scope: "read" | "read write", days: number) {
  if (!name.trim() || name.length > 80) throw new ApiError(400, "Name must be 1 to 80 characters");
  if (![30, 90, 365].includes(days)) throw new ApiError(400, "Choose a 30, 90, or 365 day expiration");
  const database = db();
  const count = await database.prepare("SELECT COUNT(*) AS count FROM mcp_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?")
    .bind(userId, now()).first<{ count: number }>();
  if ((count?.count || 0) >= 10) throw new ApiError(409, "Revoke an existing MCP token before creating another");
  const id = crypto.randomUUID();
  const random = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const token = `blm_${id}_${secret}`;
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  await database.prepare("INSERT INTO mcp_tokens (id, user_id, name, secret_hash, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, userId, name.trim(), await digest(token), scope, expiresAt, now()).run();
  return { id, name: name.trim(), scope, expiresAt, token };
}

export async function contextForMcpToken(request: Request): Promise<Context> {
  const token = request.headers.get("x-blanch-mcp-token") || "";
  const match = /^blm_([a-f0-9-]{36})_([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) throw new ApiError(401, "MCP token required");
  const clientRequest = await verifiedClientRequest(request, token);
  const database = db();
  const row = await database.prepare("SELECT id, user_id, secret_hash, scope, expires_at, revoked_at FROM mcp_tokens WHERE id = ?")
    .bind(match[1]).first<TokenRow>();
  const computed = await digest(token);
  if (!row || !equalDigest(computed, row.secret_hash) || row.revoked_at || row.expires_at <= now())
    throw new ApiError(401, "MCP token is invalid or expired");
  const context = await contextForMemberId(clientRequest, row.user_id);
  context.mcpReadOnly = row.scope === "read";
  await database.prepare("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?").bind(now(), row.id).run();
  return context;
}
