import { env } from "cloudflare:workers";
import { ApiError, audit, canReadTeam, canWriteTeam, errorResponse, json, now, requireContext, safeParse } from "../../../lib/workspace-server";

export const dynamic = "force-dynamic";

type IssueRow = { id: string; team_id: string | null; value_json: string; version: number };
type Attachment = { id: string; name: string; size: number; type: string; key: string; uploadedBy: string; createdAt: string };

async function issue(ctx: Awaited<ReturnType<typeof requireContext>>, id: string, write: boolean) {
  const row = await ctx.db.prepare("SELECT id, team_id, value_json, version FROM records WHERE kind = 'issue' AND id = ? AND deleted_at IS NULL").bind(id).first<IssueRow>();
  if (!row) throw new ApiError(404, "Issue not found");
  if (write ? !canWriteTeam(ctx, row.team_id) : !canReadTeam(ctx, row.team_id)) throw new ApiError(403, "Team access denied");
  return row;
}

function bucket(): R2Bucket {
  if (!env.BUCKET) throw new ApiError(503, "File storage is unavailable");
  return env.BUCKET;
}

function attachments(row: IssueRow): Attachment[] {
  const value = safeParse<{ attachments?: Attachment[] }>(row.value_json, {});
  return Array.isArray(value.attachments) ? value.attachments : [];
}

export async function GET(request: Request) {
  try {
    const ctx = await requireContext(request);
    const url = new URL(request.url);
    const row = await issue(ctx, url.searchParams.get("issue") || "", false);
    const attachment = attachments(row).find(item => item.id === url.searchParams.get("id"));
    if (!attachment) throw new ApiError(404, "Attachment not found");
    const object = await bucket().get(attachment.key);
    if (!object) throw new ApiError(404, "File not found");
    return new Response(object.body, {
      headers: {
        "Content-Type": attachment.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireContext(request);
    if (Number(request.headers.get("content-length") || 0) > 11_000_000) throw new ApiError(413, "File is too large");
    const form = await request.formData();
    const id = String(form.get("issue") || "");
    const file = form.get("file");
    if (!(file instanceof File) || !file.name || file.size > 10_000_000 || file.size === 0)
      throw new ApiError(400, "Choose a file up to 10 MB");
    const row = await issue(ctx, id, true);
    const current = safeParse<Record<string, unknown>>(row.value_json, {});
    const list = attachments(row);
    if (list.length >= 50) throw new ApiError(400, "Attachment limit reached");
    const attachment: Attachment = {
      id: crypto.randomUUID(), name: file.name.slice(0, 180), size: file.size,
      type: /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : "application/octet-stream", key: `${row.team_id}/${row.id}/${crypto.randomUUID()}`,
      uploadedBy: ctx.user.displayName, createdAt: now(),
    };
    await bucket().put(attachment.key, file.stream(), { httpMetadata: { contentType: attachment.type } });
    const value = { ...current, attachments: [...list, attachment] };
    const result = await ctx.db.prepare("UPDATE records SET value_json = ?, version = version + 1, updated_at = ? WHERE kind = 'issue' AND id = ? AND version = ?")
      .bind(JSON.stringify(value), now(), row.id, row.version).run();
    if (!result.meta.changes) {
      await bucket().delete(attachment.key);
      throw new ApiError(409, "This issue changed elsewhere. Refresh and try again.");
    }
    await audit(ctx, "issue.attachment.add", "issue", row.id, { attachmentId: attachment.id, name: attachment.name });
    return json({ attachment }, 201);
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireContext(request);
    const body = await request.json() as { issue?: string; id?: string; expectedVersion?: number };
    const row = await issue(ctx, String(body.issue || ""), true);
    if (row.version !== body.expectedVersion) throw new ApiError(409, "This issue changed elsewhere. Refresh and try again.");
    const list = attachments(row);
    const attachment = list.find(item => item.id === body.id);
    if (!attachment) throw new ApiError(404, "Attachment not found");
    const current = safeParse<Record<string, unknown>>(row.value_json, {});
    const value = { ...current, attachments: list.filter(item => item.id !== attachment.id) };
    const result = await ctx.db.prepare("UPDATE records SET value_json = ?, version = version + 1, updated_at = ? WHERE kind = 'issue' AND id = ? AND version = ?")
      .bind(JSON.stringify(value), now(), row.id, row.version).run();
    if (!result.meta.changes) throw new ApiError(409, "This issue changed elsewhere. Refresh and try again.");
    await bucket().delete(attachment.key);
    await audit(ctx, "issue.attachment.delete", "issue", row.id, { attachmentId: attachment.id });
    return json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
