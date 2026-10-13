/**
 * The only place Convex functions read process.env (D-40). Values are set per
 * deployment with `convex env set`; `pnpm setup` sets them for local dev.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set on this Convex deployment. Run \`pnpm setup\` or \`convex env set ${name}\`.`);
  }
  return value;
}

export const convexEnv = {
  workosApiKey: () => required("WORKOS_API_KEY", process.env.WORKOS_API_KEY),
  workosClientId: () => required("WORKOS_CLIENT_ID", process.env.WORKOS_CLIENT_ID),
};
