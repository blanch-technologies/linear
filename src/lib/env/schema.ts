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
    const derivesRedirect = env.VERCEL_ENV === "preview" && env.VERCEL_BRANCH_URL;
    if (!env.NEXT_PUBLIC_WORKOS_REDIRECT_URI && !derivesRedirect) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_WORKOS_REDIRECT_URI"],
        message: "Required outside Vercel preview deployments.",
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

/** AuthKit callback URL; Vercel previews derive it from the stable branch URL. */
export function workosRedirectUri(env: ServerEnv): string {
  if (env.VERCEL_ENV === "preview" && env.VERCEL_BRANCH_URL) {
    return `https://${env.VERCEL_BRANCH_URL}/callback`;
  }
  return env.NEXT_PUBLIC_WORKOS_REDIRECT_URI!;
}
