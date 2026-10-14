"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useConvexAuth } from "convex/react";
import { Button } from "@/components/ui/button";
import { ShellSkeleton } from "./shell-skeleton";

/**
 * Renders children once Convex has accepted the AuthKit token. Queries that
 * need a signed-in caller must not run before that, or they fail as anonymous.
 * The proxy already guarantees a session cookie; this covers the token fetch.
 */
export function RequireAuth({ children, fallback = <ShellSkeleton /> }: { children: ReactNode; fallback?: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return fallback;
  if (!isAuthenticated) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-base font-semibold">You&apos;ve been signed out</h1>
          <p className="text-muted-foreground">
            Your session expired, or your access to this workspace changed. Sign in again to continue.
          </p>
          <Button asChild size="sm">
            <Link href="/sign-in" prefetch={false}>
              Sign in
            </Link>
          </Button>
        </div>
      </main>
    );
  }
  return children;
}
