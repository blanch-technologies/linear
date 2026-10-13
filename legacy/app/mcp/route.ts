import { handleMcp } from "../../lib/mcp-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) { return handleMcp(request); }
export async function GET() { return new Response(null, { status: 405, headers: { Allow: "POST" } }); }
