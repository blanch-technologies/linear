"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Token = { id: string; name: string; scope: string; expires_at: string; revoked_at: string | null; last_used_at: string | null };
const gateway = "https://blanch-linear-mcp.sleekbat64.chatgpt.site/mcp";

export default function McpSetupPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("Claude Code");
  const [scope, setScope] = useState<"read" | "read write">("read write");
  const [days, setDays] = useState(90);
  const [revealed, setRevealed] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/mcp-tokens", { cache: "no-store" });
    const data = await response.json() as { tokens?: Token[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Could not load access tokens");
    setTokens(data.tokens || []);
  }

  useEffect(() => {
    fetch("/api/mcp-tokens", { cache: "no-store" })
      .then(async response => {
        const data = await response.json() as { tokens?: Token[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load access tokens");
        setTokens(data.tokens || []);
      })
      .catch(cause => setError(String(cause)));
  }, []);

  async function act(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mcp-tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { token?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Token request failed");
      if (data.token) setRevealed(data.token);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Token request failed"); }
    finally { setBusy(false); }
  }

  return <main className="mcp-page">
    <Link href="/">← Back to workspace</Link>
    <h1>Connect an AI client</h1>
    <p>Use your workspace data in Claude Code through a personal MCP access token. The server follows your team permissions. You can revoke a token at any time.</p>
    <section>
      <h2>Create an access token</h2>
      <label>Name<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
      <div className="two">
        <label>Access<select value={scope} onChange={event => setScope(event.target.value as "read" | "read write")}><option value="read write">Read and write</option><option value="read">Read only</option></select></label>
        <label>Expires<select value={days} onChange={event => setDays(Number(event.target.value))}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>365 days</option></select></label>
      </div>
      <button disabled={busy || !name.trim()} onClick={() => act({ action: "create", name, scope, days })}>Create token</button>
      {revealed && <div className="secret"><strong>Copy this token now. It will not be shown again.</strong><code>{revealed}</code><button onClick={() => navigator.clipboard.writeText(revealed)}>Copy token</button></div>}
    </section>
    <section>
      <h2>Connect Claude Code</h2>
      <p>Add the server in a terminal, replacing <code>YOUR_TOKEN</code> with the token above. Then run <code>/mcp</code> in Claude Code to check the connection.</p>
      <pre>{`claude mcp add --transport http blanch-linear ${gateway} --header "Authorization: Bearer YOUR_TOKEN"`}</pre>
      <p className="muted">The token grants access as you. Keep it private and revoke it if a device is lost.</p>
    </section>
    <section>
      <h2>Your tokens</h2>
      {tokens.length ? tokens.map(token => <div className="token" key={token.id}><div><strong>{token.name}</strong><small>{token.scope === "read" ? "Read only" : "Read and write"} · Expires {token.expires_at.slice(0, 10)}{token.last_used_at ? ` · Last used ${token.last_used_at.slice(0, 10)}` : ""}{token.revoked_at ? " · Revoked" : ""}</small></div>{!token.revoked_at && <button disabled={busy} onClick={() => act({ action: "revoke", id: token.id })}>Revoke</button>}</div>) : <p className="muted">No tokens yet.</p>}
    </section>
    {error && <p role="alert" className="error">{error}</p>}
    <style>{`*{box-sizing:border-box}body{background:#111216;color:#f0eef5;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.mcp-page{max-width:760px;margin:48px auto;padding:0 24px 64px}.mcp-page>a{color:#b3aaff;text-decoration:none}.mcp-page h1{font-size:34px;letter-spacing:-.03em;margin:32px 0 12px}.mcp-page h2{font-size:19px;margin:0 0 18px}.mcp-page p{color:#bbb9c6;line-height:1.55}.mcp-page section{background:#1b1c23;border:1px solid #30313a;border-radius:12px;padding:24px;margin:24px 0}.mcp-page label{display:block;color:#dddbe6;font-size:13px;margin:12px 0}.mcp-page input,.mcp-page select{display:block;width:100%;margin-top:8px;background:#252630;color:#f0eef5;border:1px solid #41414e;border-radius:7px;padding:10px;font:inherit}.mcp-page button{background:#7668db;color:white;border:0;border-radius:7px;padding:10px 16px;font:inherit;cursor:pointer}.mcp-page button:disabled{opacity:.5;cursor:default}.mcp-page .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.mcp-page .secret{margin-top:18px;padding:16px;border:1px solid #7668db;border-radius:8px}.mcp-page .secret code{display:block;margin:12px 0;overflow-wrap:anywhere}.mcp-page pre{overflow:auto;background:#111216;border-radius:8px;padding:15px;color:#d4cdfd}.mcp-page code{font-family:ui-monospace,SFMono-Regular,monospace}.mcp-page .muted,.mcp-page small{color:#9b9aa7}.mcp-page .token{display:flex;justify-content:space-between;align-items:center;gap:16px;border-top:1px solid #34343d;padding:14px 0}.mcp-page .token strong,.mcp-page .token small{display:block}.mcp-page .token button{background:#393942}.mcp-page .error{color:#ff9ea8}@media(max-width:580px){.mcp-page .two{grid-template-columns:1fr}.mcp-page{margin:24px auto}}`}</style>
  </main>;
}
