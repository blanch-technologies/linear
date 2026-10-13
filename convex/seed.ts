import { internalMutation } from "./_generated/server";

/**
 * Demo data for local and preview deployments. Idempotent. The schema has no
 * tables yet; Phase 1 fills this with multi-team, multi-role data (O-11).
 */
export const run = internalMutation({
  args: {},
  handler: async () => {
    return { inserted: 0 };
  },
});
