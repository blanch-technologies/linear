import { env } from "cloudflare:workers";

const utf8 = new TextEncoder();
function b64url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function derLength(length: number): number[] {
  if (length < 128) return [length];
  const bytes: number[] = [];
  while (length) { bytes.unshift(length & 255); length >>>= 8; }
  return [128 | bytes.length, ...bytes];
}
function pemBytes(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, "\n");
  const pkcs1 = normalized.includes("BEGIN RSA PRIVATE KEY");
  const content = normalized.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\s/g, "");
  const bytes = Uint8Array.from(atob(content), char => char.charCodeAt(0));
  if (!pkcs1) return bytes;
  const wrapped = [4, ...derLength(bytes.length), ...bytes];
  const inner = [2, 1, 0, 48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0, ...wrapped];
  return Uint8Array.from([48, ...derLength(inner.length), ...inner]);
}

export async function githubAppJwt(): Promise<string> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new Error("GitHub App credentials are not configured");
  const key = await crypto.subtle.importKey("pkcs8", new Uint8Array(pemBytes(env.GITHUB_APP_PRIVATE_KEY)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const seconds = Math.floor(Date.now() / 1000);
  const input = b64url(utf8.encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))) + "." +
    b64url(utf8.encode(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: env.GITHUB_APP_ID })));
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8.encode(input)));
  return input + "." + b64url(signature);
}

export async function githubApi<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch("https://api.github.com" + path, {
    ...options,
    headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Linear-Workspace-Rebuild", ...options.headers },
  });
  if (!response.ok) throw new Error("GitHub API returned " + response.status);
  return response.json() as Promise<T>;
}

export async function installationToken(installationId: number): Promise<string> {
  const result = await githubApi<{ token: string }>("/app/installations/" + installationId + "/access_tokens", await githubAppJwt(), { method: "POST" });
  return result.token;
}
