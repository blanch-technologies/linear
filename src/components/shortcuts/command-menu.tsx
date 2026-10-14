"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ArrowLeftRight,
  Keyboard,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  SquarePen,
  Sun,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { personalNav, teamNav, workspaceNav } from "@/components/shell/nav";
import { TeamMark } from "@/components/shell/team-mark";
import { WorkspaceLogo } from "@/components/shell/workspace-logo";
import { switchWorkspaceUrl, useWorkspace } from "@/components/workspace/workspace-context";
import type { ShortcutId } from "@/lib/shortcuts";
import { useComposer } from "@/components/issues/composer";
import { ShortcutKeys } from "./shortcut-keys";

type Page = "root" | "workspaces";

const goShortcut: Record<string, ShortcutId> = {
  inbox: "go-inbox",
  "my-issues": "go-my-issues",
  projects: "go-projects",
  views: "go-views",
};

/**
 * ⌘K: actions and quick jumps (D-37 keeps it separate from the Search page).
 * Entries come from the same nav model as the sidebar and respect the
 * viewer's capabilities.
 */
export function CommandMenu({
  open,
  onOpenChange,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowShortcuts: () => void;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const { signOut } = useAuth();
  const { href, teams, can, viewer, workspace, workspaces } = useWorkspace();
  const composer = useComposer();
  const [page, setPage] = useState<Page>("root");
  const [search, setSearch] = useState("");

  function close() {
    onOpenChange(false);
    setPage("root");
    setSearch("");
  }
  function go(path: string) {
    close();
    router.push(path);
  }

  const isGuest = viewer.role === "guest";
  const myTeams = teams.filter((team) => team.teamRole !== null);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent showCloseButton={false} className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <DialogDescription className="sr-only">Type a command or search for a page.</DialogDescription>
        <Command
          loop
          onKeyDown={(event) => {
            // Backspace on an empty input returns to the first page.
            if (event.key === "Backspace" && !search && page !== "root") {
              event.preventDefault();
              setPage("root");
            }
          }}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:h-9"
        >
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={page === "workspaces" ? "Switch workspace…" : "Type a command or search…"}
            aria-label="Command"
          />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>No results.</CommandEmpty>
            {page === "workspaces" ? (
              <CommandGroup heading="Workspaces">
                {workspaces
                  .filter((item) => !item.suspended)
                  .map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`workspace ${item.name} ${item.urlKey}`}
                      onSelect={() => {
                        close();
                        if (item.urlKey !== workspace.urlKey) {
                          window.location.assign(switchWorkspaceUrl(item.workosOrganizationId, `/${item.urlKey}`));
                        }
                      }}
                    >
                      <WorkspaceLogo name={item.name} size="sm" />
                      {item.name}
                    </CommandItem>
                  ))}
                <CommandItem value="create workspace" onSelect={() => go("/onboarding")}>
                  <Plus aria-hidden /> Create workspace
                </CommandItem>
              </CommandGroup>
            ) : (
              <>
                <CommandGroup heading="Issues">
                  <Entry
                    value="Create new issue"
                    keywords={["new", "issue", "add"]}
                    icon={<SquarePen aria-hidden />}
                    shortcut="create-issue"
                    onSelect={() => {
                      close();
                      composer.open();
                    }}
                  >
                    Create new issue
                  </Entry>
                </CommandGroup>
                <CommandGroup heading="Navigation">
                  {[...personalNav, ...workspaceNav.filter((item) => !(isGuest && item.hiddenForGuests))].map((item) => (
                    <Entry
                      key={item.segment}
                      value={`Go to ${item.label}`}
                      icon={<item.icon aria-hidden />}
                      shortcut={goShortcut[item.segment]}
                      onSelect={() => go(href(item.segment))}
                    >
                      Go to {item.label}
                    </Entry>
                  ))}
                  <Entry value="Search" icon={<Search aria-hidden />} shortcut="search" onSelect={() => go(href("search"))}>
                    Search
                  </Entry>
                  <Entry value="Go to Settings" icon={<Settings aria-hidden />} shortcut="go-settings" onSelect={() => go(href("settings"))}>
                    Go to Settings
                  </Entry>
                </CommandGroup>
                {myTeams.length > 0 && (
                  <CommandGroup heading="Teams">
                    {myTeams.flatMap((team) =>
                      teamNav.map((item) => (
                        <Entry
                          key={`${team.id}-${item.segment}`}
                          value={`${team.name} ${team.key} ${item.label}`}
                          icon={<TeamMark teamKey={team.key} />}
                          onSelect={() => go(href("team", team.key, item.segment))}
                        >
                          {team.name} <span className="text-muted-strong">› {item.label}</span>
                        </Entry>
                      )),
                    )}
                  </CommandGroup>
                )}
                <CommandGroup heading="Workspace">
                  {can.inviteRoles.length > 0 && (
                    <Entry value="Invite members" icon={<UserPlus aria-hidden />} onSelect={() => go(href("settings", "members"))}>
                      Invite members
                    </Entry>
                  )}
                  {can.createTeam && (
                    <Entry value="Create or join a team" keywords={["teams", "browse"]} icon={<Users aria-hidden />} shortcut="go-teams" onSelect={() => go(href("settings", "teams"))}>
                      Create or join a team
                    </Entry>
                  )}
                  <Entry
                    value="Switch workspace" keywords={["change", "organization"]}
                    icon={<ArrowLeftRight aria-hidden />}
                    onSelect={() => {
                      setSearch("");
                      setPage("workspaces");
                    }}
                  >
                    Switch workspace…
                  </Entry>
                </CommandGroup>
                <CommandGroup heading="Preferences">
                  <Entry value="Switch to dark theme" keywords={["theme", "appearance"]} icon={<Moon aria-hidden />} onSelect={() => (setTheme("dark"), close())}>
                    Switch to dark theme
                  </Entry>
                  <Entry value="Switch to light theme" keywords={["theme", "appearance"]} icon={<Sun aria-hidden />} onSelect={() => (setTheme("light"), close())}>
                    Switch to light theme
                  </Entry>
                  <Entry value="Use system theme" keywords={["theme", "appearance", "auto"]} icon={<Monitor aria-hidden />} onSelect={() => (setTheme("system"), close())}>
                    Use system theme
                  </Entry>
                  <Entry
                    value="Keyboard shortcuts" keywords={["help", "keys"]}
                    icon={<Keyboard aria-hidden />}
                    shortcut="help"
                    onSelect={() => {
                      close();
                      onShowShortcuts();
                    }}
                  >
                    Keyboard shortcuts
                  </Entry>
                  <Entry value="Log out" keywords={["sign out"]} icon={<LogOut aria-hidden />} onSelect={() => signOut()}>
                    Log out
                  </Entry>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Entry({
  value,
  keywords,
  icon,
  shortcut,
  onSelect,
  children,
}: {
  value: string;
  keywords?: string[];
  icon: ReactNode;
  shortcut?: ShortcutId;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <CommandItem value={value} keywords={keywords} onSelect={onSelect}>
      {icon}
      <span className="truncate">{children}</span>
      {shortcut && (
        <span className="ml-auto">
          <ShortcutKeys id={shortcut} />
        </span>
      )}
    </CommandItem>
  );
}

