"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { notFound, useParams, usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamMark } from "@/components/shell/team-mark";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";

export type TeamDetail = NonNullable<FunctionReturnType<typeof api.teams.byKey>>;

const TeamContext = createContext<TeamDetail | null>(null);

export function useTeamDetail(): TeamDetail {
  const team = useContext(TeamContext);
  if (!team) throw new Error("useTeamDetail must be used inside team settings");
  return team;
}

/** Loads the team for /settings/teams/<KEY>/… and renders its header and tabs. */
export function TeamSettingsLayout({ children }: { children: ReactNode }) {
  const { teamKey } = useParams<{ teamKey: string }>();
  const { href } = useWorkspace();
  const pathname = usePathname();
  const team = useQuery(api.teams.byKey, { key: teamKey });

  if (team === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (team === null) notFound();

  const base = href("settings", "teams", team.key);
  const tabs = [
    { href: base, label: "General" },
    { href: `${base}/members`, label: "Members" },
    ...(team.can.read || team.can.manage ? [{ href: `${base}/workflow`, label: "Workflow" }] : []),
  ];

  return (
    <TeamContext.Provider value={team}>
      <div className="space-y-6">
        <header className="flex items-center gap-2.5">
          <TeamMark teamKey={team.key} className="size-5 text-[11px]" />
          <h1 className="text-xl font-semibold tracking-tight">{team.name}</h1>
          <span className="text-muted-foreground">{team.key}</span>
        </header>
        <nav aria-label="Team settings" className="flex gap-4 border-b border-border">
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 border-transparent pb-2 text-muted-foreground hover:text-foreground",
                  active && "border-brand text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </TeamContext.Provider>
  );
}
