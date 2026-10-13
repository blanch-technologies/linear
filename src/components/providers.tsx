"use client";

import { useCallback, type ReactNode } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import {
  AuthKitProvider,
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { SessionSync } from "@/components/workspace/session-sync";
import { clientEnv } from "@/lib/env/client";

const convex = new ConvexReactClient(clientEnv.NEXT_PUBLIC_CONVEX_URL);

/** Adapts AuthKit's session to the token fetcher Convex expects. */
function useConvexAuthFromAuthKit() {
  const { user, loading } = useAuth();
  const { getAccessToken, refresh } = useAccessToken();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!user) return null;
      try {
        const token = forceRefreshToken ? await refresh() : await getAccessToken();
        return token ?? null;
      } catch {
        return null;
      }
    },
    [user, refresh, getAccessToken],
  );

  return { isLoading: loading, isAuthenticated: !!user, fetchAccessToken };
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      themes={["light", "dark"]}
      enableSystem
      disableTransitionOnChange
    >
      <AuthKitProvider>
        <ConvexProviderWithAuth client={convex} useAuth={useConvexAuthFromAuthKit}>
          <SessionSync>
            <TooltipProvider delayDuration={400}>
              {children}
              <Toaster position="bottom-right" />
            </TooltipProvider>
          </SessionSync>
        </ConvexProviderWithAuth>
      </AuthKitProvider>
    </ThemeProvider>
  );
}
