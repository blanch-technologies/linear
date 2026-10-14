"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { placeholderSections, teamNav } from "./nav";
import { Sidebar } from "./sidebar";

/** Header title from the route: a section, or "Team › Tab". */
function usePageTitle(): string {
  const { urlKey, teams } = useWorkspace();
  const segments = usePathname().split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== urlKey) return "";
  const [, first, teamKey, tab] = segments;
  if (first === "team" && teamKey) {
    const team = teams.find((item) => item.key === teamKey.toUpperCase());
    const tabLabel = teamNav.find((item) => item.segment === tab)?.label;
    return [team?.name ?? teamKey, tabLabel].filter(Boolean).join(" › ");
  }
  return (first && placeholderSections[first]?.label) || "";
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const title = usePageTitle();

  return (
    <div className="flex min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-20 hidden border-r border-sidebar-border nav:block">
        <Sidebar />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-sidebar max-w-none gap-0 border-sidebar-border p-0"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col nav:pl-sidebar">
        <header className="sticky top-0 z-10 flex h-header items-center gap-2 border-b border-border bg-background px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            className="nav:hidden"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu aria-hidden />
          </Button>
          <h1 className="font-medium">{title}</h1>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
