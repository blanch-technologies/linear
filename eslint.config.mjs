import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // D-40: process.env is read only in the env modules.
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Import clientEnv/serverEnv from src/lib/env instead.",
        },
      ],
    },
  },
  {
    files: [
      "src/lib/env/**",
      "convex/auth.config.ts",
      "scripts/**",
      "playwright.config.ts",
      "e2e/**",
      "*.config.{ts,mts,mjs}",
    ],
    rules: { "no-restricted-properties": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "legacy/**",
    "convex/_generated/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
