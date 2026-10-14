/**
 * Input rules shared by forms and Convex functions, so the UI and the server
 * reject the same things with the same words.
 */

/** Paths under / that can never be workspace URL keys. */
const reservedUrlKeys = new Set([
  "api", "app", "auth", "callback", "sign-in", "sign-out", "sign-up", "login", "logout",
  "onboarding", "join", "invite", "settings", "monitoring", "admin", "help", "docs",
  "static", "public", "assets", "_next", "favicon.ico", "icon.svg", "new",
]);

export type Validation = { ok: true; value: string } | { ok: false; message: string };

const ok = (value: string): Validation => ({ ok: true, value });
const no = (message: string): Validation => ({ ok: false, message });

export function validateName(input: string, label = "Name"): Validation {
  const value = input.trim().replace(/\s+/g, " ");
  if (!value) return no(`${label} is required.`);
  if (value.length > 64) return no(`${label} must be 64 characters or fewer.`);
  return ok(value);
}

export function validateUrlKey(input: string): Validation {
  const value = input.trim().toLowerCase();
  if (value.length < 3 || value.length > 32) return no("URL must be 3 to 32 characters.");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) {
    return no("Use lowercase letters, numbers, and single hyphens.");
  }
  if (value.includes("--")) return no("Use lowercase letters, numbers, and single hyphens.");
  if (reservedUrlKeys.has(value)) return no("That URL is reserved.");
  return ok(value);
}

export function validateTeamKey(input: string): Validation {
  const value = input.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,6}$/.test(value)) {
    return no("Team identifiers are 1 to 7 letters or numbers, starting with a letter.");
  }
  return ok(value);
}

export function validateEmail(input: string): Validation {
  const value = input.trim().toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return no("Enter a valid email address.");
  return ok(value);
}

export function validateDescription(input: string | undefined, max = 1000): Validation {
  const value = (input ?? "").trim();
  if (value.length > max) return no(`Description must be ${max} characters or fewer.`);
  return ok(value);
}

/** "Acme Labs" -> "acme-labs" (then validated by validateUrlKey). */
export function suggestUrlKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

/** "Platform Engineering" -> "PE", "Design" -> "DES". */
export function suggestTeamKey(name: string): string {
  const words = name.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 3);
  const cleaned = key.replace(/^[0-9]+/, "").slice(0, 7);
  return cleaned || "TEAM";
}
