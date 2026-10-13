import { clientSchema, parseEnv } from "./schema";

// Next.js inlines NEXT_PUBLIC_* only for literal `process.env.X` references.
export const clientEnv = parseEnv("client", clientSchema, {
  NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});
