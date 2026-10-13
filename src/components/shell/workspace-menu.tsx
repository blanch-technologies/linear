"use client";

import Link from "next/link";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { Check, ChevronDown, LogOut, Plus, Settings, UserPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchWorkspaceUrl, useWorkspace } from "@/components/workspace/workspace-context";
import { WorkspaceLogo } from "./workspace-logo";

export function WorkspaceMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace, workspaces, viewer, can, href } = useWorkspace();
  const { signOut } = useAuth();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="workspace-menu"
        className="flex h-[34px] w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left font-semibold hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
      >
        <WorkspaceLogo name={workspace.name} />
        <span className="truncate">{workspace.name}</span>
        <ChevronDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem asChild>
          <Link href={href("settings")} onClick={onNavigate}>
            <Settings aria-hidden /> Settings
            <DropdownMenuShortcut>G then S</DropdownMenuShortcut>
          </Link>
        </DropdownMenuItem>
        {can.inviteRoles.length > 0 && (
          <DropdownMenuItem asChild>
            <Link href={href("settings", "members")} onClick={onNavigate}>
              <UserPlus aria-hidden /> Invite and manage members
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{viewer.email}</DropdownMenuLabel>
        {workspaces.map((item) => (
          <DropdownMenuItem
            key={item.id}
            disabled={item.suspended}
            onSelect={() => {
              if (item.urlKey !== workspace.urlKey) {
                window.location.assign(switchWorkspaceUrl(item.workosOrganizationId, `/${item.urlKey}`));
              }
            }}
          >
            <WorkspaceLogo name={item.name} size="sm" />
            <span className="truncate">{item.name}</span>
            {item.urlKey === workspace.urlKey && <Check className="ml-auto" aria-label="Current workspace" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem asChild>
          <Link href="/onboarding" onClick={onNavigate}>
            <Plus aria-hidden /> Create or join a workspace
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()}>
          <LogOut aria-hidden /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
