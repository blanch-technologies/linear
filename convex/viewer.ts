import { query } from "./_generated/server";

/** The signed-in WorkOS identity, or null. Proves the auth round trip. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return {
      subject: identity.subject,
      email: identity.email ?? null,
      name: identity.name ?? null,
    };
  },
});
