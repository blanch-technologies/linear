import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { redirectUri } from "@/lib/env/server";

// Every page requires a session except the auth handshake and health check.
export default authkitProxy({
  redirectUri,
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/callback", "/sign-in", "/api/health"],
  },
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|monitoring).*)"],
};
