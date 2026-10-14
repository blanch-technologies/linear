"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Plus, Search, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace, type TeamSummary } from "@/components/workspace/workspace-context";
import { usePersistedFlag } from "@/hooks/use-persisted-state";
import { cn } from "@/lib/utils";
import { personalNav, teamNav, workspaceNav, type NavItem } from "./nav";
import { TeamMark } from "./team-mark";
import { UserMenu } from "./user-menu";
import { WorkspaceMenu } from "./workspace-menu";

const itemClass =
  "flex items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/90 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none";

function SidebarLink({
  href,
  item,
  nested,
  onNavigate,
}: {
  href: string;
  item: NavItem;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(itemClass, nested ? "h-[27px]" : "h-[29px]", active && "bg-sidebar-accent text-sidebar-foreground")}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/** A group heading that collapses its items; the choice is remembered per browser. */
function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { urlKey } = useWorkspace();
  const [collapsed, setCollapsed] = usePersistedFlag(`sidebar:${urlKey}:${id}`, false);
  return (
    <section className="mt-5">
      <div className="flex h-[29px] items-center">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-full flex-1 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          {title}
          <ChevronRight className={cn("size-3 transition-transform", !collapsed && "rotate-90")} aria-hidden />
        </button>
        {action}
      </div>
      {!collapsed && <div className="space-y-px">{children}</div>}
    </section>
  );
}

/** Teams the viewer belongs to, sub-teams nested under their parent when both are joined. */
function teamTree(teams: TeamSummary[]) {
  const mine = teams.filter((team) => team.teamRole !== null);
  const ids = new Set(mine.map((team) => team.id));
  const children = new Map<string, TeamSummary[]>();
  const roots: TeamSummary[] = [];
  for (const team of mine) {
    if (team.parentId && ids.has(team.parentId)) {
      children.set(team.parentId, [...(children.get(team.parentId) ?? []), team]);
    } else {
      roots.push(team);
    }
  }
  return { roots, children };
}

function TeamItem({
  team,
  childTeams,
  onNavigate,
  depth = 0,
}: {
  team: TeamSummary;
  childTeams: Map<string, TeamSummary[]>;
  onNavigate?: () => void;
  depth?: number;
}) {
  const { urlKey, href } = useWorkspace();
  const [open, setOpen] = usePersistedFlag(`sidebar:${urlKey}:team:${team.id}`, true);
  const subTeams = childTeams.get(team.id) ?? [];
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(itemClass, "h-[30px] w-full font-semibold")}
      >
        <TeamMark teamKey={team.key} />
        <span className="truncate">{team.name}</span>
        <ChevronRight
          className={cn("ml-auto size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden
        />
      </button>
      {open && (
        <div className="ml-[18px] space-y-px border-l border-sidebar-border pl-[7px]">
          {teamNav.map((item) => (
            <SidebarLink
              key={item.segment}
              href={href("team", team.key, item.segment)}
              item={item}
              nested
              onNavigate={onNavigate}
            />
          ))}
          {depth < 4 &&
            subTeams.map((child) => (
              <TeamItem key={child.id} team={child} childTeams={childTeams} onNavigate={onNavigate} depth={depth + 1} />
            ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { href, teams, viewer, can } = useWorkspace();
  const { roots, children } = teamTree(teams);
  const isGuest = viewer.role === "guest";

  return (
    <nav aria-label="Main" className="flex h-full w-sidebar flex-col bg-sidebar">
      <div className="px-2.5 pt-3 pb-2">
        <WorkspaceMenu onNavigate={onNavigate} />
        <div className="mt-2.5 flex gap-1">
          <Button variant="ghost" size="sm" className="flex-1 justify-start text-muted-foreground" asChild>
            <Link href={href("search")} onClick={onNavigate}>
              <Search aria-hidden />
              Search
            </Link>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" size="icon-sm" aria-label="New issue" disabled>
                <SquarePen aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New issue (Phase 2)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        <div className="space-y-px">
          {personalNav.map((item) => (
            <SidebarLink key={item.segment} href={href(item.segment)} item={item} onNavigate={onNavigate} />
          ))}
        </div>

        <Section id="workspace" title="Workspace">
          {workspaceNav
            .filter((item) => !(isGuest && item.hiddenForGuests))
            .map((item) => (
              <SidebarLink key={item.segment} href={href(item.segment)} item={item} onNavigate={onNavigate} />
            ))}
        </Section>

        <Section
          id="teams"
          title="Your teams"
          action={
            can.createTeam ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" asChild aria-label="Browse and create teams">
                    <Link href={href("settings", "teams")} onClick={onNavigate}>
                      <Plus aria-hidden />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Browse and create teams</TooltipContent>
              </Tooltip>
            ) : undefined
          }
        >
          {roots.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {isGuest ? "You haven't been added to a team yet." : "You aren't in any teams yet."}
            </p>
          ) : (
            roots.map((team) => <TeamItem key={team.id} team={team} childTeams={children} onNavigate={onNavigate} />)
          )}
        </Section>
      </div>

      <div className="border-t border-sidebar-border p-2.5">
        <UserMenu />
      </div>
    </nav>
  );
}
