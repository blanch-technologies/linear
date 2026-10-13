import { describe, expect, it } from "vitest";
import { EnvError, parseEnv, serverSchema, workosRedirectUri } from "./schema";

const valid = {
  NEXT_PUBLIC_CONVEX_URL: "https://happy-otter-123.convex.cloud",
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://localhost:3000/callback",
  WORKOS_CLIENT_ID: "client_123",
  WORKOS_API_KEY: "sk_test_123",
  WORKOS_COOKIE_PASSWORD: "x".repeat(32),
};

describe("serverSchema", () => {
  it("accepts a complete local config", () => {
    const env = parseEnv("server", serverSchema, valid);
    expect(env.BLANCH_TEST_AUTH).toBe("0");
    expect(workosRedirectUri(env)).toBe("http://localhost:3000/callback");
  });

  it("names every missing or malformed variable", () => {
    const run = () =>
      parseEnv("server", serverSchema, { ...valid, WORKOS_API_KEY: "", WORKOS_COOKIE_PASSWORD: "short" });
    expect(run).toThrow(EnvError);
    expect(run).toThrow(/WORKOS_API_KEY/);
    expect(run).toThrow(/WORKOS_COOKIE_PASSWORD: Must be at least 32 characters/);
  });

  it("refuses test auth in production (D-41)", () => {
    expect(() =>
      parseEnv("server", serverSchema, { ...valid, BLANCH_TEST_AUTH: "1", VERCEL_ENV: "production" }),
    ).toThrow(/Test auth must never be enabled in production/);
  });

  it("derives the callback from the branch URL on previews", () => {
    const env = parseEnv("server", serverSchema, {
      ...valid,
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: undefined,
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "blanch-git-feature-acme.vercel.app",
    });
    expect(workosRedirectUri(env)).toBe("https://blanch-git-feature-acme.vercel.app/callback");
  });

  it("requires a callback outside previews", () => {
    expect(() =>
      parseEnv("server", serverSchema, { ...valid, NEXT_PUBLIC_WORKOS_REDIRECT_URI: undefined }),
    ).toThrow(/NEXT_PUBLIC_WORKOS_REDIRECT_URI/);
  });
});
