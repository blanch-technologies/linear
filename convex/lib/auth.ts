import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";

type AuthCtx = { auth: { getUserIdentity(): Promise<UserIdentity | null> } };

/** Resolves the WorkOS identity behind the request or throws. */
export async function requireIdentity(ctx: AuthCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity;
}
