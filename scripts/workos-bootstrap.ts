/**
 * `pnpm workos:bootstrap`: makes a WorkOS environment ready for this app.
 * Idempotent. Run once per environment (staging, then production) with that
 * environment's WORKOS_API_KEY in .env.local or the shell.
 *
 * - Roles: owner, admin, member, guest (D-16). WorkOS ships admin and member.
 * - Audit Log schemas: one per action in convex/lib/auditActions.ts (D-22).
 */
import { WorkOS } from "@workos-inc/node";
import { auditActions } from "../convex/lib/auditActions";

const roles = [
  { slug: "owner", name: "Owner", description: "Full control, including billing and other owners." },
  { slug: "admin", name: "Admin", description: "Manages members, teams, and workspace settings." },
  { slug: "member", name: "Member", description: "Works in all public teams and teams they join." },
  { slug: "guest", name: "Guest", description: "Sees only the teams they are added to." },
];

function client(): WorkOS {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    console.error("WORKOS_API_KEY is not set. Run with: node --env-file=.env.local --import tsx scripts/workos-bootstrap.ts");
    process.exit(1);
  }
  if (apiKey.startsWith("sk_live") && !process.argv.includes("--production")) {
    console.error("This is a production key. Re-run with --production to confirm.");
    process.exit(1);
  }
  return new WorkOS(apiKey, { clientId: process.env.WORKOS_CLIENT_ID });
}

function sameShape(a: unknown, b: unknown): boolean {
  const normalize = (value: unknown) => JSON.stringify(value ?? {}, Object.keys((value ?? {}) as object).sort());
  return normalize(a) === normalize(b);
}

async function main() {
  const workos = client();

  const existing = new Set((await workos.authorization.listEnvironmentRoles()).data.map((role) => role.slug));
  for (const role of roles) {
    if (existing.has(role.slug)) {
      console.log(`role ${role.slug}: exists`);
      continue;
    }
    await workos.authorization.createEnvironmentRole(role);
    console.log(`role ${role.slug}: created`);
  }

  for (const [action, spec] of Object.entries(auditActions)) {
    const metadata = "metadata" in spec ? spec.metadata : undefined;
    const wanted = { action, targets: spec.targets.map((type) => ({ type })), ...(metadata ? { metadata } : {}) };
    let latest;
    try {
      const schemas = await workos.auditLogs.listSchemas(action);
      latest = schemas.data.sort((a, b) => b.version - a.version)[0];
    } catch {
      latest = undefined; // WorkOS answers 404 when the action has no schema yet.
    }
    const targetsMatch = latest && sameShape(latest.targets.map((t) => t.type).sort(), [...spec.targets].sort());
    const metadataMatch = latest && sameShape(latest.metadata ? Object.keys(latest.metadata).sort() : [], metadata ? Object.keys(metadata).sort() : []);
    if (latest && targetsMatch && metadataMatch) {
      console.log(`audit ${action}: v${latest.version} up to date`);
      continue;
    }
    const created = await workos.auditLogs.createSchema(wanted);
    console.log(`audit ${action}: created v${created.version}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
