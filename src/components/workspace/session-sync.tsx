"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAction, useConvexAuth } from "convex/react";
import { api } from "@convex/_generated/api";

type SyncStatus = "idle" | "syncing" | "done" | "failed";

const SessionSyncContext = createContext<SyncStatus>("idle");

/**
 * Reconciles the signed-in user's WorkOS memberships into Convex once per page
 * load (ADR 0004). Accepted invitations and changes made in WorkOS show up here.
 */
export function SessionSync({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const sync = useAction(api.session.sync);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const started = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || started.current) return;
    started.current = true;
    setStatus("syncing");
    sync({})
      .then(() => setStatus("done"))
      .catch((error: unknown) => {
        // The mirror from the last sync still works; log and carry on.
        console.error("session sync failed", error);
        setStatus("failed");
      });
  }, [isAuthenticated, sync]);

  return <SessionSyncContext.Provider value={status}>{children}</SessionSyncContext.Provider>;
}

/** Whether this page load's sync has finished (successfully or not). */
export function useSessionSynced(): boolean {
  const status = useContext(SessionSyncContext);
  return status === "done" || status === "failed";
}
