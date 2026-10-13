"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useSessionSynced } from "./session-sync";
import { ShellSkeleton } from "./shell-skeleton";
import { switchWorkspaceUrl } from "./workspace-context";
import { WorkspaceLogo } from "@/components/shell/workspace-logo";

/** `/`: the session's workspace, else the first one the user belongs to, else onboarding. */
export function RootRedirect() {
  const router = useRouter();
  const switchFailed = useSearchParams().has("switchFailed");
  const synced = useSessionSynced();
  const mine = useQuery(api.workspaces.mine);
  const usable = useMemo(() => mine?.workspaces.filter((workspace) => !workspace.suspended) ?? [], [mine]);
  const active = usable.find((workspace) => workspace.workosOrganizationId === mine?.activeOrganizationId);

  useEffect(() => {
    if (!mine || switchFailed) return;
    if (active) router.replace(`/${active.urlKey}`);
    else if (usable[0]) window.location.assign(switchWorkspaceUrl(usable[0].workosOrganizationId, `/${usable[0].urlKey}`));
    else if (synced && mine.synced) router.replace("/onboarding");
  }, [mine, active, usable, synced, switchFailed, router]);

  if (!switchFailed) return <ShellSkeleton />;
  // A switch was refused (membership removed in WorkOS, say): let the user pick instead of looping.
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-base font-semibold">Choose a workspace</h1>
        <p className="text-muted-foreground">We couldn&apos;t open that workspace. Pick another one or create a new one.</p>
        <ul className="space-y-1">
          {usable.map((workspace) => (
            <li key={workspace.id}>
              <a
                className="flex h-9 items-center gap-2.5 rounded-md px-2 hover:bg-accent"
                href={switchWorkspaceUrl(workspace.workosOrganizationId, `/${workspace.urlKey}`)}
              >
                <WorkspaceLogo name={workspace.name} />
                {workspace.name}
              </a>
            </li>
          ))}
        </ul>
        <Button asChild size="sm">
          <Link href="/onboarding">Create a workspace</Link>
        </Button>
      </div>
    </main>
  );
}
