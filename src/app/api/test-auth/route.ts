import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";
import { serverEnv } from "@/lib/env/server";

/*
 * D-41: test-only sign-in for e2e. Enabled only with BLANCH_TEST_AUTH=1, which
 * the env schema refuses in production. It signs in real WorkOS users, so
 * Convex accepts their tokens exactly as in production, but only on the
 * reserved `blanch.test` domain: it can never sign in as a real person.
 *
 * POST { "email": "owner@blanch.test", "name"?: "Olive Owner", "acceptInvitations"?: true }
 *   Creates the WorkOS user if needed, sets a fresh random password, signs in
 *   with it, and stores the session cookie. No email is sent. With
 *   `acceptInvitations`, first accepts the address's pending invitations, as
 *   clicking the emailed link would.
 * DELETE { "prefix": "E2E abc", "emailPrefix": "e2e-abc" }
 *   Cleanup after a run: deletes WorkOS organizations whose name starts with
 *   `prefix` and that only test users belong to, then the test users whose
 *   address starts with `emailPrefix`.
 */

const testEmail = /^[a-z0-9][a-z0-9._+-]*@blanch\.test$/;

function disabled() {
  return serverEnv.BLANCH_TEST_AUTH !== "1";
}

export async function POST(request: NextRequest) {
  if (disabled()) return new NextResponse(null, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; name?: unknown; acceptInvitations?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!testEmail.test(email)) {
    return NextResponse.json({ error: "Only @blanch.test addresses can use test auth." }, { status: 400 });
  }
  const [firstName = "Test", ...rest] = (typeof body.name === "string" && body.name.trim() ? body.name : email.split("@")[0]!).split(/\s+/);
  const lastName = rest.join(" ") || "User";

  try {
    return await signIn(email, firstName, lastName, body.acceptInvitations === true, request);
  } catch (error) {
    // Surface WorkOS failures (rate limits, password rules) to the e2e run instead of an empty 500.
    const message = error instanceof Error ? error.message : String(error);
    const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function signIn(email: string, firstName: string, lastName: string, acceptInvitations: boolean, request: NextRequest) {
  const workos = getWorkOS();
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const existing = (await workos.userManagement.listUsers({ email })).data[0];
  if (existing) {
    await workos.userManagement.updateUser({ userId: existing.id, password, firstName, lastName, emailVerified: true });
  } else {
    await workos.userManagement.createUser({ email, password, emailVerified: true, firstName, lastName });
  }
  if (acceptInvitations) {
    const invitations = await (await workos.userManagement.listInvitations({ email, limit: 100 })).autoPagination();
    for (const invitation of invitations) {
      if (invitation.state === "pending") await workos.userManagement.acceptInvitation(invitation.id);
    }
  }
  const auth = await workos.userManagement
    .authenticateWithPassword({ clientId: serverEnv.WORKOS_CLIENT_ID, email, password })
    .catch(async (error: { code?: string; pendingAuthenticationToken?: string; rawData?: { organizations?: { id: string }[] } }) => {
      // A user in several workspaces must pick one; any works, since the app rescopes from the URL.
      const organizationId = error.rawData?.organizations?.[0]?.id;
      if (error.code !== "organization_selection_required" || !error.pendingAuthenticationToken || !organizationId) throw error;
      return workos.userManagement.authenticateWithOrganizationSelection({
        clientId: serverEnv.WORKOS_CLIENT_ID,
        pendingAuthenticationToken: error.pendingAuthenticationToken,
        organizationId,
      });
    });
  await saveSession(auth, request);
  return NextResponse.json({ userId: auth.user.id });
}

export async function DELETE(request: NextRequest) {
  if (disabled()) return new NextResponse(null, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { prefix?: unknown; emailPrefix?: unknown };
  const prefix = typeof body.prefix === "string" ? body.prefix : "";
  const emailPrefix = typeof body.emailPrefix === "string" ? body.emailPrefix.toLowerCase() : "";
  if (prefix.length < 6 || emailPrefix.length < 6) {
    return NextResponse.json({ error: "prefix and emailPrefix are required" }, { status: 400 });
  }

  const workos = getWorkOS();
  const organizations = await (await workos.organizations.listOrganizations({ limit: 100 })).autoPagination();
  const deleted: string[] = [];
  for (const organization of organizations) {
    if (!organization.name.startsWith(prefix)) continue;
    const members = await (
      await workos.userManagement.listOrganizationMemberships({ organizationId: organization.id, limit: 100 })
    ).autoPagination();
    const emails = await Promise.all(members.map(async (m) => (await workos.userManagement.getUser(m.userId)).email));
    if (emails.some((address) => !testEmail.test(address))) continue;
    await workos.organizations.deleteOrganization(organization.id);
    deleted.push(organization.id);
  }
  const users = await (await workos.userManagement.listUsers({ limit: 100 })).autoPagination();
  let deletedUsers = 0;
  for (const user of users) {
    if (user.email.startsWith(emailPrefix) && testEmail.test(user.email)) {
      await workos.userManagement.deleteUser(user.id);
      deletedUsers += 1;
    }
  }
  return NextResponse.json({ deleted, deletedUsers });
}
