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
    // D-19: Convex functions are built only from the wrappers in convex/lib/functions.ts.
    files: ["convex/**/*.ts"],
    ignores: ["convex/lib/functions.ts", "convex/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/_generated/server"],
              importNames: [
                "query",
                "mutation",
                "action",
                "internalQuery",
                "internalMutation",
                "internalAction",
                "httpAction",
              ],
              message: "Build functions with the wrappers in convex/lib/functions.ts (D-19).",
            },
          ],
        },
      ],
    },
  },
  {
    // The pure permission module stays free of Convex and React (handoff A2).
    files: ["src/lib/permissions/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["convex", "convex/*", "react", "react-dom", "@convex/*", "**/convex/**"], message: "src/lib/permissions is pure TypeScript." }] },
      ],
    },
  },
  {
    files: [
      "src/lib/env/**",
      "convex/lib/env.ts",
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
