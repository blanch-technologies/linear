/**
 * `pnpm setup`: create .env.local, provision a Convex dev deployment, sync
 * Convex env vars, validate everything, and seed demo data (D-40).
 * Safe to re-run.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseEnv as parseDotenv } from "node:util";
import { EnvError, parseEnv, serverSchema } from "../src/lib/env/schema";

const ENV_FILE = ".env.local";

class SetupError extends Error {}

function readEnvFile(): Record<string, string> {
  return parseDotenv(readFileSync(ENV_FILE, "utf8")) as Record<string, string>;
}

function setEnvValue(key: string, value: string) {
  const text = readFileSync(ENV_FILE, "utf8");
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(ENV_FILE, pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`);
}

function convex(...args: string[]) {
  execFileSync("pnpm", ["exec", "convex", ...args], { stdio: "inherit" });
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  if (!existsSync(ENV_FILE)) {
    copyFileSync(".env.example", ENV_FILE);
    console.log(`Created ${ENV_FILE} from .env.example`);
  }

  // Add any variables from .env.example that .env.local lacks (e.g. when
  // `convex dev` created the file first), so every key has a line to fill in.
  let env = readEnvFile();
  const example = parseDotenv(readFileSync(".env.example", "utf8")) as Record<string, string>;
  for (const [key, value] of Object.entries(example)) {
    if (!(key in env)) setEnvValue(key, value);
  }
  env = readEnvFile();
  if (!env.WORKOS_COOKIE_PASSWORD) {
    setEnvValue("WORKOS_COOKIE_PASSWORD", randomBytes(32).toString("base64url"));
    console.log("Generated WORKOS_COOKIE_PASSWORD");
  }

  for (const key of ["WORKOS_CLIENT_ID", "WORKOS_API_KEY"] as const) {
    if (env[key]) continue;
    if (!process.stdin.isTTY) {
      throw new SetupError(
        `${key} is missing from ${ENV_FILE}. Add it there (dashboard.workos.com > staging > API keys) and re-run.`,
      );
    }
    setEnvValue(key, await prompt(`${key} (WorkOS dashboard > API keys, staging): `));
  }

  env = readEnvFile();
  if (!env.CONVEX_DEPLOYMENT) {
    console.log("\nNo Convex deployment yet; creating a dev deployment.");
    convex("dev", "--once", "--configure");
    env = readEnvFile();
  }

  // Convex validates AuthKit tokens with this (convex/auth.config.ts).
  convex("env", "set", "WORKOS_CLIENT_ID", env.WORKOS_CLIENT_ID);
  convex("dev", "--once");

  parseEnv("server", serverSchema, readEnvFile());
  console.log(`\n${ENV_FILE} is valid.`);

  convex("run", "seed:run");
  console.log("\nSetup complete. Run `pnpm dev` and open http://localhost:3000");
}

main().catch((error: unknown) => {
  const known = error instanceof EnvError || error instanceof SetupError;
  console.error(known ? `\n${error.message}` : error);
  process.exit(1);
});
