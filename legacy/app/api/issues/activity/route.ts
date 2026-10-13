import { errorResponse, json, requireContext } from "../../../../lib/workspace-server";
import { readIssueActivity } from "../../../../lib/issue-activity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireContext(request);
    const url = new URL(request.url);
    const issueId = url.searchParams.get("issue") || "";
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 50;
    const cursor = url.searchParams.has("cursor") ? Number(url.searchParams.get("cursor")) : 0;
    return json(await readIssueActivity(ctx, issueId, limit, cursor));
  } catch (error) { return errorResponse(error); }
}
