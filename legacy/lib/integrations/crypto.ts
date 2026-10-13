import { env } from "cloudflare:workers";

const utf8 = new TextEncoder();
const decoder = new TextDecoder();

function fromBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromHex(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) return new Uint8Array();
  return Uint8Array.from(value.match(/../g) || [], pair => parseInt(pair, 16));
}

export async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) throw new Error("Integration encryption key is not configured");
  const bytes = fromBase64(raw);
  if (bytes.length !== 32) throw new Error("Integration encryption key must contain 32 bytes");
  return crypto.subtle.importKey("raw", new Uint8Array(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptCredentials(value: Record<string, unknown>, associatedId: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: utf8.encode(associatedId) },
    await encryptionKey(),
    utf8.encode(JSON.stringify(value)),
  ));
  return "v1." + toBase64(nonce) + "." + toBase64(encrypted);
}

export async function decryptCredentials<T extends Record<string, unknown>>(value: string, associatedId: string): Promise<T> {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Invalid integration credentials");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(fromBase64(parts[1])), additionalData: utf8.encode(associatedId) },
    await encryptionKey(),
    new Uint8Array(fromBase64(parts[2])),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function verifyHmacSha256(secret: string, message: string, signatureHex: string): Promise<boolean> {
  const signature = fromHex(signatureHex);
  if (signature.length !== 32) return false;
  const key = await crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, new Uint8Array(signature), utf8.encode(message));
}

export function newOpaqueState(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}
