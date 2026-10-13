import { NextResponse, type NextRequest } from "next/server";
import { getSignInUrl, refreshSession } from "@workos-inc/authkit-nextjs";
import { safeReturnPath } from "@/lib/safe-redirect";

/**
 * Scopes the session to another WorkOS organization, then returns to the app.
 * WorkOS refuses organizations the user isn't a member of, and sends users
 * through SSO or MFA when the organization requires it (ADR 0004).
 */
export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("returnTo"));
  if (!organizationId || !/^org_[A-Za-z0-9]+$/.test(organizationId)) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }
  try {
    await refreshSession({ organizationId, ensureSignedIn: true });
  } catch (error) {
    const cause = (error as { cause?: { error?: string; rawData?: { authkit_redirect_url?: string } } }).cause;
    if (cause?.rawData?.authkit_redirect_url) return NextResponse.redirect(cause.rawData.authkit_redirect_url);
    if (cause?.error === "sso_required" || cause?.error === "mfa_enrollment") {
      return NextResponse.redirect(await getSignInUrl({ organizationId }));
    }
    // Not a member (or removed): back to the workspace list.
    const url = new URL("/", request.url);
    url.searchParams.set("switchFailed", "1");
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL(returnTo, request.url));
}
