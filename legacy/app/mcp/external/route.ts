import { handleMcp } from "../../../lib/mcp-server";
import { contextForMcpToken } from "../../../lib/mcp-tokens";

export const dynamic = "force-dynamic";

// The separate public MCP gateway calls this route using Sites service access.
// The token still has to belong to an active workspace member.
export async function POST(request: Request) { return handleMcp(request, contextForMcpToken); }
export async function GET() { return new Response(null, { status: 405, headers: { Allow: "POST" } }); }
