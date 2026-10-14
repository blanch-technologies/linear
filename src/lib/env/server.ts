import "server-only";
import { parseEnv, serverSchema, workosRedirectUri } from "./schema";

export const serverEnv = parseEnv("server", serverSchema, {
  ...process.env,
  // NEXT_PUBLIC_* values can exist only at build time (e.g. `convex deploy`
  // injects NEXT_PUBLIC_CONVEX_URL into the build), so reference them
  // literally for Next.js to inline rather than reading them at runtime.
  NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});
export const redirectUri = workosRedirectUri(serverEnv);
