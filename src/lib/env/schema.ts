import { z } from "zod";

/**
 * Typed environment schema (D-40). This folder is the only place in `src/`
 * that reads `process.env`; everything else imports `clientEnv` or `serverEnv`.
 * `scripts/setup.ts` reuses these schemas to validate `.env.local`.
 */

export const clientSchema = z.object({
  NEXT_PUBLIC_CONVEX_URL: z.url({
    error: "Convex deployment URL. `npx convex dev` writes it to .env.local.",
  }),
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: z
    .url({ error: "AuthKit callback, e.g. http://localhost:3000/callback." })
    .optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
});

const vercelEnv = z.enum(["production", "preview", "development"]).optional();

export const serverSchema = z
  .object({
    WORKOS_CLIENT_ID: z
      .string({ error: "WorkOS client ID (dashboard > API keys)." })
      .startsWith("client_", { error: "WorkOS client IDs start with client_." }),
    WORKOS_API_KEY: z
      .string({ error: "WorkOS API key (dashboard > API keys)." })
      .startsWith("sk_", { error: "WorkOS API keys start with sk_." }),
    WORKOS_COOKIE_PASSWORD: z
      .string({ error: "Session cookie secret; `pnpm setup` generates one." })
      .min(32, { error: "Must be at least 32 characters." }),
    // D-41: test-only auth path for e2e. Never allowed in production.
    BLANCH_TEST_AUTH: z.enum(["0", "1"]).default("0"),
    VERCEL_ENV: vercelEnv,
    VERCEL_BRANCH_URL: z.string().optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  })
  .extend(clientSchema.shape)
  .superRefine((env, ctx) => {
    if (env.BLANCH_TEST_AUTH === "1" && env.VERCEL_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["BLANCH_TEST_AUTH"],
        message: "Test auth must never be enabled in production.",
      });
    }
    if (!env.NEXT_PUBLIC_WORKOS_REDIRECT_URI && !vercelHost(env)) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_WORKOS_REDIRECT_URI"],
        message: "Required outside Vercel deployments.",
      });
    }
  });

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export class EnvError extends Error {
  constructor(scope: string, error: z.ZodError) {
    const lines = error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    super(
      `Invalid ${scope} environment variables:\n${lines.join("\n")}\n` +
        "Fix .env.local (see .env.example) or run `pnpm setup`.",
    );
    this.name = "EnvError";
  }
}

export function parseEnv<S extends z.ZodType>(
  scope: string,
  schema: S,
  values: Record<string, string | undefined>,
): z.infer<S> {
  // Treat empty strings as unset so `FOO=` in a .env file reads as missing.
  const cleaned = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) throw new EnvError(scope, result.error);
  return result.data;
}

type VercelVars = Pick<ServerEnv, "VERCEL_ENV" | "VERCEL_BRANCH_URL" | "VERCEL_PROJECT_PRODUCTION_URL">;

/** Host Vercel serves this deployment under: the stable branch URL or the production domain. */
function vercelHost(env: VercelVars): string | undefined {
  if (env.VERCEL_ENV === "preview") return env.VERCEL_BRANCH_URL;
  if (env.VERCEL_ENV === "production") return env.VERCEL_PROJECT_PRODUCTION_URL;
  return undefined;
}

/**
 * AuthKit callback URL. An explicit NEXT_PUBLIC_WORKOS_REDIRECT_URI wins
 * locally and in production; previews always use their branch URL.
 */
export function workosRedirectUri(env: ServerEnv): string {
  const host = vercelHost(env);
  if (env.VERCEL_ENV === "preview" && host) return `https://${host}/callback`;
  return env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ?? `https://${host}/callback`;
}
