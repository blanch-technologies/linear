import { systemMutation } from "./lib/functions";

/**
 * Demo data for local and preview deployments. Idempotent. Filled in by the
 * seed PR (O-11) once WorkOS organizations can be created from scripts.
 */
export const run = systemMutation({
  args: {},
  handler: async () => {
    return { inserted: 0 };
  },
});
