import { env } from "cloudflare:workers";
import { getRequestExecutionContext } from "vinext/shims/request-context";
import { ApiError, errorResponse, json } from "../../../../lib/workspace-server";
import { sha256, verifyHmacSha256 } from "../../../../lib/integrations/crypto";
import { recordDelivery, finishDelivery } from "../../../../lib/integrations/store";
import { processGitHubEvent } from "../../../../lib/integrations/github-events";
import { processSlackCommand, processSlackEvent, processSlackShortcut } from "../../../../lib/integrations/slack-events";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const db = env.DB;
    if (!db) throw new ApiError(503, "Workspace database is unavailable");
    const provider = new URL(request.url).searchParams.get("provider");
    if (provider !== "slack" && provider !== "github") throw new ApiError(404, "Unknown webhook");
    if (Number(request.headers.get("content-length") || 0) > 1_000_000) throw new ApiError(413, "Webhook is too large");
    const raw = await request.text();
    if (raw.length > 1_000_000) throw new ApiError(413, "Webhook is too large");
    let deliveryId = "";
    let work: Promise<void>;
    let slackForm = false;
    if (provider === "github") {
      const signature = request.headers.get("x-hub-signature-256") || "";
      if (!env.GITHUB_WEBHOOK_SECRET || !/^sha256=[0-9a-f]{64}$/i.test(signature) ||
        !await verifyHmacSha256(env.GITHUB_WEBHOOK_SECRET, raw, signature.slice(7))) throw new ApiError(401, "Invalid GitHub signature");
      deliveryId = request.headers.get("x-github-delivery") || "";
      if (!/^[0-9a-f-]{30,40}$/i.test(deliveryId)) throw new ApiError(400, "Missing GitHub delivery ID");
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const event = request.headers.get("x-github-event") || "";
      if (event === "ping") return json({ ok: true });
      if (!await recordDelivery(db, provider, deliveryId)) return json({ ok: true, duplicate: true });
      work = processGitHubEvent(db, event, payload);
    } else {
      const timestamp = request.headers.get("x-slack-request-timestamp") || "";
      const signature = request.headers.get("x-slack-signature") || "";
      if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        !/^v0=[0-9a-f]{64}$/i.test(signature) || !env.SLACK_SIGNING_SECRET ||
        !await verifyHmacSha256(env.SLACK_SIGNING_SECRET, "v0:" + timestamp + ":" + raw, signature.slice(3)))
        throw new ApiError(401, "Invalid Slack signature");
      const origin = new URL(request.url).origin;
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        slackForm = true;
        const params = new URLSearchParams(raw);
        const shortcut = params.get("payload");
        deliveryId = shortcut ? String((JSON.parse(shortcut) as { trigger_id?: string }).trigger_id || await sha256(raw)) : await sha256(raw);
        if (!await recordDelivery(db, provider, deliveryId)) return new Response(null, { status: 200 });
        work = shortcut ? processSlackShortcut(db, JSON.parse(shortcut) as Record<string, unknown>, origin) : processSlackCommand(db, params, origin);
      } else {
        const payload = JSON.parse(raw) as Record<string, unknown>;
        if (payload.type === "url_verification") return json({ challenge: payload.challenge });
        deliveryId = String(payload.event_id || await sha256(raw));
        if (!await recordDelivery(db, provider, deliveryId)) return json({ ok: true, duplicate: true });
        work = processSlackEvent(db, payload, origin);
      }
    }
    const pending = work.then(() => finishDelivery(db, provider, deliveryId))
      .catch(error => finishDelivery(db, provider, deliveryId, String(error instanceof Error ? error.message : error)));
    const execution = getRequestExecutionContext();
    if (execution) execution.waitUntil(pending); else await pending;
    return slackForm ? new Response(null, { status: 200 }) : json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
