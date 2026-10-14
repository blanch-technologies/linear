/**
 * `pnpm seed [--owner you@company.com] [--perf]`: a demo workspace (O-11) in
 * the local Convex dev deployment.
 *
 * Creates (once) a WorkOS organization "Acme (demo)" for this deployment, demo
 * people on @blanch.test with every role, and teams covering public, private,
 * and restricted visibility, with sample issues. `--owner` adds your own
 * WorkOS account as an owner (sign in to the app once first). `--perf` adds a
 * PERF team with 10,000 issues for the large-list spike (ADR 0005).
 * No email is sent. Idempotent: re-running only adds what's missing.
 */
import { execFileSync } from "node:child_process";
import { WorkOS } from "@workos-inc/node";

type Role = "owner" | "admin" | "member" | "guest";

const demoPeople: Array<{ key: string; name: string; role: Role }> = [
  { key: "ola", name: "Ola Owner", role: "owner" },
  { key: "ada", name: "Ada Admin", role: "admin" },
  { key: "mo", name: "Mo Member", role: "member" },
  { key: "lin", name: "Lin Designer", role: "member" },
  { key: "sam", name: "Sam Platform", role: "member" },
  { key: "gus", name: "Gus Guest", role: "guest" },
];
const email = (key: string) => `demo-${key}@blanch.test`;

const perfIssues = 10_000;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function convexRun(fn: string, args: unknown): unknown {
  const out = execFileSync("pnpm", ["exec", "convex", "run", fn, JSON.stringify(args)], { encoding: "utf8" });
  try {
    return JSON.parse(out);
  } catch {
    return out.trim();
  }
}

async function main() {
  const apiKey = process.env.WORKOS_API_KEY;
  const deployment = process.env.CONVEX_DEPLOYMENT;
  if (!apiKey || !deployment) {
    throw new Error("WORKOS_API_KEY and CONVEX_DEPLOYMENT must be set (run `pnpm setup` first).");
  }
  if (!deployment.startsWith("dev:") && !deployment.startsWith("anonymous")) {
    throw new Error(`Refusing to seed ${deployment}: seed only targets dev deployments.`);
  }
  const workos = new WorkOS(apiKey, { clientId: process.env.WORKOS_CLIENT_ID });
  const ownerEmail = arg("--owner")?.toLowerCase();
  const perf = process.argv.includes("--perf");

  // One demo organization per Convex deployment, found again by external id.
  const externalId = `blanch-demo-${deployment.replace(/[^a-z0-9-]/gi, "-")}`;
  let organization = await workos.organizations.getOrganizationByExternalId(externalId).catch(() => null);
  organization ??= await workos.organizations.createOrganization({
    name: "Acme (demo)",
    externalId,
    metadata: { app: "blanch", seed: "true" },
  });
  console.log(`WorkOS organization: ${organization.name} (${organization.id})`);

  const memberships = await (
    await workos.userManagement.listOrganizationMemberships({ organizationId: organization.id, limit: 100 })
  ).autoPagination();

  async function ensureMember(user: { id: string; email: string; firstName: string | null; lastName: string | null }, role: Role) {
    const existing = memberships.find((m) => m.userId === user.id);
    const membership = existing ?? (await workos.userManagement.createOrganizationMembership({ organizationId: organization!.id, userId: user.id, roleSlug: role }));
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
    return { workosUserId: user.id, email: user.email.toLowerCase(), name, workosMembershipId: membership.id, role };
  }

  const people = [];
  for (const demo of demoPeople) {
    const address = email(demo.key);
    const [firstName, lastName] = demo.name.split(" ");
    const user =
      (await workos.userManagement.listUsers({ email: address })).data[0] ??
      (await workos.userManagement.createUser({ email: address, emailVerified: true, firstName, lastName }));
    people.push(await ensureMember(user, demo.role));
  }
  if (ownerEmail) {
    const user = (await workos.userManagement.listUsers({ email: ownerEmail })).data[0];
    if (user) people.push(await ensureMember(user, "owner"));
    else console.warn(`No WorkOS user ${ownerEmail} yet: sign in to the app once, then run \`pnpm seed --owner ${ownerEmail}\` again.`);
  }
  const you = ownerEmail && people.some((p) => p.email === ownerEmail) ? [ownerEmail] : [];

  const teams = [
    { key: "ENG", name: "Engineering", description: "Product engineering.", visibility: "public", members: [email("ola"), email("ada"), email("mo"), email("lin"), ...you], issues: 40 },
    { key: "DES", name: "Design", description: "Product design and research.", visibility: "public", members: [email("lin"), email("mo")], issues: 15 },
    { key: "PLAT", name: "Platform", description: "Infrastructure and developer platform.", visibility: "private", members: [email("ada"), email("sam"), ...you], issues: 20 },
    { key: "INFRA", name: "Infra", description: "Restricted sub-team of Platform.", visibility: "restricted", parentKey: "PLAT", members: [email("sam"), email("ada")], issues: 10 },
    // The owner isn't in Security: owners see it exists but not its issues (D-17).
    { key: "SEC", name: "Security", description: "Private: incident response.", visibility: "private", members: [email("ada")], issues: 8 },
    { key: "PART", name: "Partners", description: "Shared with a guest.", visibility: "public", members: [email("mo"), email("gus")], issues: 5 },
    ...(perf ? [{ key: "PERF", name: "Performance", description: "10,000 issues for the large-list spike.", visibility: "public", members: [email("ada"), ...you], issues: 0 }] : []),
  ];

  const result = convexRun("seed:run", {
    workspace: { workosOrganizationId: organization.id, name: organization.name, urlKey: "acme-demo" },
    people,
    teams,
  }) as { workspaceId: string; created: string[] };
  console.log(`Convex: workspace ${result.workspaceId}; new teams: ${result.created.join(", ") || "none"}`);

  if (perf) {
    for (let total = 0; total < perfIssues; ) {
      const batch = convexRun("seed:issues", { workspaceId: result.workspaceId, teamKey: "PERF", target: perfIssues }) as { total: number };
      total = batch.total;
      process.stdout.write(`\rPERF issues: ${total}/${perfIssues}`);
    }
    process.stdout.write("\n");
  }

  console.log(`\nDemo workspace: /acme-demo. Sign in as yourself (with --owner) or, with test auth on, as ${email("ada")} and friends.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
