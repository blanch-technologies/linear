"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TeamMark } from "@/components/shell/team-mark";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";

type Link = { href: string; label: string; icon?: ReactNode };

function SettingsNav({ onNavigate }: { onNavigate?: () => void }) {
  const { href, can, teams } = useWorkspace();
  const pathname = usePathname();
  const groups: { title: string; links: Link[] }[] = [
    { title: "Account", links: [{ href: href("settings", "preferences"), label: "Preferences" }] },
    {
      title: "Workspace",
      links: [
        ...(can.manageWorkspace ? [{ href: href("settings", "workspace"), label: "General" }] : []),
        { href: href("settings", "members"), label: can.viewMembers ? "Members" : "Your membership" },
        ...(can.viewWorkspaceSurfaces || teams.length > 0 ? [{ href: href("settings", "teams"), label: "Teams" }] : []),
      ],
    },
    {
      title: "Your teams",
      links: teams
        .filter((team) => team.teamRole !== null || team.can.manage)
        .map((team) => ({
          href: href("settings", "teams", team.key),
          label: team.name,
          icon: <TeamMark teamKey={team.key} />,
        })),
    },
  ];

  return (
    <nav aria-label="Settings" className="flex h-full w-sidebar flex-col bg-sidebar">
      <div className="px-2.5 pt-3 pb-2">
        <Link
          href={href()}
          onClick={onNavigate}
          className="flex h-[30px] items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <ChevronLeft className="size-4" aria-hidden /> Back to app
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        {groups
          .filter((group) => group.links.length > 0)
          .map((group) => (
            <section key={group.title} className="mt-4">
              <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.title}</h2>
              <div className="space-y-px">
                {group.links.map((link) => {
                  const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-[29px] items-center gap-2.5 rounded-md px-2 font-medium text-sidebar-foreground/90 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
                        active && "bg-sidebar-accent text-sidebar-foreground",
                      )}
                    >
                      {link.icon}
                      <span className="truncate">{link.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
      </div>
    </nav>
  );
}

export function SettingsShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-20 hidden border-r border-sidebar-border nav:block">
        <SettingsNav />
      </aside>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-sidebar max-w-none gap-0 border-sidebar-border p-0">
          <SheetTitle className="sr-only">Settings navigation</SheetTitle>
          <SettingsNav onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col nav:pl-sidebar">
        <div className="sticky top-0 z-10 flex h-header items-center border-b border-border bg-background px-4 nav:hidden">
          <Button variant="ghost" size="icon-sm" aria-label="Open settings navigation" onClick={() => setDrawerOpen(true)}>
            <Menu aria-hidden />
          </Button>
        </div>
        <main className="mx-auto w-full max-w-[720px] px-4 py-10 nav:px-8 nav:py-16">{children}</main>
      </div>
    </div>
  );
}

/** Page title and description, then sections. */
export function SettingsPage({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-8">
      <header className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

export function SettingsSection({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      {title && (
        <div className="space-y-0.5">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className="rounded-lg border border-border bg-card">{children}</div>
    </section>
  );
}
