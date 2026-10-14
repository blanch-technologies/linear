"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Search, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { personalNav, workspaceNav, type NavItem } from "./nav";
import { UserMenu } from "./user-menu";

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href;
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[29px] items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground/90",
        "hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none",
        active && "bg-sidebar-accent text-sidebar-foreground",
      )}
    >
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {item.label}
    </Link>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex h-full w-sidebar flex-col bg-sidebar">
      <div className="px-2.5 pt-3 pb-2">
        <button
          type="button"
          className="flex h-[34px] w-full items-center gap-2.5 rounded-md px-2 text-left font-semibold hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="grid size-[21px] place-items-center rounded-md bg-linear-135 from-[#a595ff] to-[#6456ce] text-xs font-bold text-white"
          >
            {brand.shortName[0]}
          </span>
          <span className="truncate">{brand.shortName}</span>
          <ChevronDown className="ml-auto size-3.5 text-muted-foreground" aria-hidden />
        </button>
        <div className="mt-2.5 flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="flex-1 justify-start text-muted-foreground" asChild>
                <Link href="/search" onClick={onNavigate}>
                  <Search aria-hidden />
                  Search
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" size="icon-sm" aria-label="New issue" disabled>
                <SquarePen aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New issue (coming soon)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        <div className="space-y-px">
          {personalNav.map((item) => (
            <SidebarLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </div>

        <h2 className="mt-5 mb-1 px-2 text-xs font-medium text-muted-foreground">Workspace</h2>
        <div className="space-y-px">
          {workspaceNav.map((item) => (
            <SidebarLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </div>

        <h2 className="mt-5 mb-1 px-2 text-xs font-medium text-muted-foreground">Your teams</h2>
        <p className="px-2 text-xs text-muted-foreground">No teams yet.</p>
      </div>

      <div className="border-t border-sidebar-border p-2.5">
        <UserMenu />
      </div>
    </nav>
  );
}
