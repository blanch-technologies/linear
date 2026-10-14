import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { redirectUri, serverEnv } from "@/lib/env/server";

// Every page requires a session except the auth handshake and health check,
// plus the e2e sign-in when test auth is on (D-41; never in production).
export default authkitProxy({
  redirectUri,
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [
      "/callback",
      "/sign-in",
      "/api/health",
      ...(serverEnv.BLANCH_TEST_AUTH === "1" ? ["/api/test-auth"] : []),
    ],
  },
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|monitoring).*)"],
};
