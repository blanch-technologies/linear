"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useSessionSynced } from "./session-sync";
import { switchWorkspaceUrl, workspaceHref, WorkspaceProvider, type MyWorkspaces } from "./workspace-context";
import { ShellSkeleton } from "./shell-skeleton";
import { GlobalShortcuts } from "@/components/shortcuts/global-shortcuts";
import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";
import { ComposerProvider } from "@/components/issues/composer";

/**
 * Makes the session's organization match the workspace in the URL, then
 * provides the workspace to everything below. The URL only selects; access
 * is decided by Convex from the session (D-15).
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { workspace: urlKey } = useParams<{ workspace: string }>();
  const pathname = usePathname();
  const synced = useSessionSynced();
  const mine = useQuery(api.workspaces.mine);
  const target = mine?.workspaces.find((workspace) => workspace.urlKey === urlKey);
  const active = Boolean(target && !target.suspended && mine?.activeOrganizationId === target.workosOrganizationId);
  const needsSwitch = Boolean(target && !target.suspended && !active);

  useEffect(() => {
    if (needsSwitch && target) window.location.assign(switchWorkspaceUrl(target.workosOrganizationId, pathname));
  }, [needsSwitch, target, pathname]);

  if (mine === undefined || needsSwitch) return <ShellSkeleton />;
  if (!target) {
    // Before the first sync the mirror may not know about a just-accepted invitation.
    if (!synced || !mine.synced) return <ShellSkeleton />;
    return (
      <GateMessage title="Workspace not found">
        There is no workspace at <code className="font-mono">/{urlKey}</code>, or you aren&apos;t a member of it.
      </GateMessage>
    );
  }
  if (target.suspended) {
    return (
      <GateMessage title={`Access to ${target.name} is suspended`}>
        Ask a workspace admin to reactivate your account.
      </GateMessage>
    );
  }
  return <ActiveWorkspace urlKey={urlKey} workspaces={mine.workspaces}>{children}</ActiveWorkspace>;
}

function ActiveWorkspace({
  urlKey,
  workspaces,
  children,
}: {
  urlKey: string;
  workspaces: MyWorkspaces["workspaces"];
  children: ReactNode;
}) {
  const current = useQuery(api.workspaces.current);
  const teams = useQuery(api.teams.list);
  if (current === undefined || teams === undefined) return <ShellSkeleton />;
  return (
    <WorkspaceProvider
      value={{ ...current, urlKey, teams, workspaces, href: (...segments) => workspaceHref(urlKey, ...segments) }}
    >
      <ShortcutsProvider>
        <ComposerProvider>
          <GlobalShortcuts>{children}</GlobalShortcuts>
        </ComposerProvider>
      </ShortcutsProvider>
    </WorkspaceProvider>
  );
}

export function GateMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-muted-foreground">{children}</p>
        <Button asChild variant="secondary" size="sm">
          <Link href="/">Go to your workspaces</Link>
        </Button>
      </div>
    </main>
  );
}
