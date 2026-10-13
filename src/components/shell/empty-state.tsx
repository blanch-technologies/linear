"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-muted-foreground">{body}</p>
      <BackendStatus />
    </div>
  );
}

/** Shows that the WorkOS token reached Convex and was accepted. */
function BackendStatus() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const mine = useQuery(api.workspaces.mine, isAuthenticated ? {} : "skip");
  const label =
    isLoading || (isAuthenticated && mine === undefined)
      ? "Connecting…"
      : mine
        ? `Connected as ${mine.user?.email ?? "a signed-in user"}`
        : "Not connected to the backend";
  return (
    <p data-testid="backend-status" className="mt-4 text-xs text-muted-foreground">
      {label}
    </p>
  );
}
