export interface Env {
  SITE_URL: string;
  SITE_SERVICE_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  GITHUB_WEBHOOK_SECRET: string;
}

const utf8 = new TextEncoder();

async function verify(secret: string, input: string, signature: string): Promise<boolean> {
  if (!secret || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g) || [], pair => parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", key, bytes, utf8.encode(input));
}

const gateway = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);
    const provider = incoming.pathname === "/webhook/slack" ? "slack" : incoming.pathname === "/webhook/github" ? "github" : null;
    if (!provider) return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (Number(request.headers.get("content-length") || 0) > 1_000_000) return new Response("Too large", { status: 413 });
    const raw = await request.text();
    if (raw.length > 1_000_000) return new Response("Too large", { status: 413 });
    let verified = false;
    if (provider === "slack") {
      const timestamp = request.headers.get("x-slack-request-timestamp") || "";
      const signature = request.headers.get("x-slack-signature") || "";
      verified = /^\d{10}$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300 &&
        /^v0=[0-9a-f]{64}$/i.test(signature) &&
        await verify(env.SLACK_SIGNING_SECRET, "v0:" + timestamp + ":" + raw, signature.slice(3));
    } else {
      const signature = request.headers.get("x-hub-signature-256") || "";
      verified = /^sha256=[0-9a-f]{64}$/i.test(signature) && await verify(env.GITHUB_WEBHOOK_SECRET, raw, signature.slice(7));
    }
    if (!verified) return new Response("Invalid signature", { status: 401 });
    const target = new URL("/api/integrations/webhook?provider=" + provider, env.SITE_URL);
    const headers = new Headers({
      "Content-Type": request.headers.get("content-type") || "application/json",
      "OAI-Sites-Authorization": "Bearer " + env.SITE_SERVICE_TOKEN,
    });
    for (const name of provider === "slack"
      ? ["x-slack-request-timestamp", "x-slack-signature"]
      : ["x-hub-signature-256", "x-github-delivery", "x-github-event"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstream = await fetch(target, { method: "POST", headers, body: raw, redirect: "manual" });
    const responseHeaders = new Headers({ "Content-Type": upstream.headers.get("content-type") || "application/json" });
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  },
};

export default gateway;
