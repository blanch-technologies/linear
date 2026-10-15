"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Bell, BellOff, ChevronDown, ChevronUp, Link2, MoreHorizontal, GitBranch, Hash, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shell/empty-state";
import { ShellHeader } from "@/components/shell/header-slot";
import { TeamMark } from "@/components/shell/team-mark";
import { useShortcut } from "@/components/shortcuts/shortcuts-provider";
import { ShortcutKeys } from "@/components/shortcuts/shortcut-keys";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { branchName, titleMaxLength } from "@/lib/issues";
import { errorMessage } from "@/lib/errors";
import { neighbors, readIssueNav, type IssueNav } from "../issue-nav";
import { useAssignable } from "../use-issue-data";
import { useUpdateIssue, type IssueFieldsPatch } from "../use-update-issue";
import { useLookups } from "../view/use-issue-source";
import { IssueDescription } from "./issue-description";
import { Activity, Relations, SubIssues } from "./issue-sections";
import { PropertyRail } from "./property-rail";
import type { IssueDetail, RailPicker } from "./types";

/** The routed issue page (D-37): /<workspace>/issue/ENG-123. */
export function IssuePage({ identifier }: { identifier: string }) {
  const result = useQuery(api.issues.get, { identifier });
  const router = useRouter();
  const { href } = useWorkspace();

  // Moved issues keep their old identifier as an alias; show the current one.
  const canonical = result && !result.deleted ? result.identifier : null;
  useEffect(() => {
    if (canonical && canonical !== identifier.toUpperCase()) router.replace(href("issue", canonical));
  }, [canonical, identifier, router, href]);

  if (result === undefined) return <IssuePageSkeleton />;
  if (result === null) return <EmptyState title="Issue not found" body="It doesn't exist, or you don't have access to its team." />;
  if (result.deleted) return <DeletedIssue id={result.id} identifier={result.identifier} />;
  return <LoadedIssue issue={result} />;
}

function IssuePageSkeleton() {
  return (
    <div className="flex flex-1 gap-8 p-8" aria-busy="true" role="status" aria-label="Loading issue">
      <div className="flex-1 space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="hidden h-64 w-[260px] nav:block" />
    </div>
  );
}

function DeletedIssue({ id, identifier }: { id: Id<"issues">; identifier: string }) {
  const restore = useMutation(api.issues.restore);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="text-base font-semibold">{identifier} was deleted</h2>
      <p className="max-w-sm text-muted-foreground">Deleted issues can be restored for 30 days.</p>
      <Button size="sm" onClick={() => restore({ issueId: id }).catch((error) => toast.error(errorMessage(error)))}>
        Restore issue
      </Button>
    </div>
  );
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${what}`);
  } catch {
    toast.error("Couldn't copy to the clipboard.");
  }
}

function LoadedIssue({ issue }: { issue: IssueDetail }) {
  const router = useRouter();
  const { href, teams } = useWorkspace();
  const lookups = useLookups();
  const update = useUpdateIssue();
  const move = useMutation(api.issues.move);
  const remove = useMutation(api.issues.remove);
  const restore = useMutation(api.issues.restore);
  const setSubscribed = useMutation(api.issues.setSubscribed).withOptimisticUpdate((store, { subscribed }) => {
    for (const { args, value } of store.getAllQueries(api.issues.get)) {
      if (value && !value.deleted && value.id === issue.id) store.setQuery(api.issues.get, args, { ...value, viewerSubscribed: subscribed });
    }
  });
  const people = useAssignable(issue.teamId as Id<"teams">);
  const mentionable = useMemo(() => (people ?? []).map((p) => ({ id: p.id, name: p.name, email: p.email, avatarUrl: p.avatarUrl })), [people]);
  const [picker, setPicker] = useState<RailPicker | null>(null);
  // Read once per issue: the list it was opened from.
  const [nav] = useState<IssueNav | null>(() => (typeof window === "undefined" ? null : readIssueNav()));
  const around = neighbors(nav, issue.identifier);
  const team = teams.find((t) => t.id === issue.teamId);
  const backHref = nav?.from ?? href("team", issue.team.key, "issues");
  const url = typeof window === "undefined" ? "" : `${window.location.origin}${href("issue", issue.identifier)}`;

  useEffect(() => {
    document.title = `${issue.identifier} ${issue.title}`;
  }, [issue.identifier, issue.title]);

  const patch = (fields: IssueFieldsPatch) => void update(issue, fields);
  const goTo = (identifier: string | null | undefined) => identifier && router.push(href("issue", identifier));

  const writable = issue.can.write;
  for (const [shortcut, kind] of [["set-status", "status"], ["set-priority", "priority"], ["assign", "assignee"], ["set-labels", "labels"]] as const) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed list, same order every render
    useShortcut(shortcut, () => setPicker(kind), writable);
  }
  useShortcut("list-down", () => goTo(around?.next));
  useShortcut("list-up", () => goTo(around?.previous));
  useShortcut("copy-id", () => void copy(issue.identifier, issue.identifier));
  useShortcut("copy-url", () => void copy(url, "issue URL"));
  useShortcut("copy-branch", () => void copy(branchName(issue.identifier, issue.title), "branch name"));
  useShortcut("subscribe", () => void setSubscribed({ issueId: issue.id, subscribed: !issue.viewerSubscribed }));

  // Esc goes back to the list when nothing is open and nobody is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return;
      router.push(backHref);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, backHref]);

  async function onMove(teamId: Id<"teams">) {
    try {
      const { identifier } = await move({ issueId: issue.id, teamId });
      toast.success(`Moved to ${identifier}`);
      router.replace(href("issue", identifier));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function onDelete() {
    try {
      await remove({ issueId: issue.id });
      router.push(backHref);
      toast(`Deleted ${issue.identifier}`, {
        action: { label: "Undo", onClick: () => void restore({ issueId: issue.id }).catch((error) => toast.error(errorMessage(error))) },
      });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <>
      <ShellHeader>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <Link href={href("team", issue.team.key, "issues")} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
            <TeamMark teamKey={issue.team.key} />
            {team?.name ?? issue.team.name}
          </Link>
          <span className="text-muted-foreground" aria-hidden>
            ›
          </span>
          {issue.parent && (
            <>
              <Link href={href("issue", issue.parent.identifier)} className="rounded px-1 py-0.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
                {issue.parent.identifier}
              </Link>
              <span className="text-muted-foreground" aria-hidden>
                ›
              </span>
            </>
          )}
          <span className="font-medium" aria-current="page">
            {issue.identifier}
          </span>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {around && (
            <div className="mr-1 flex items-center gap-1 text-xs text-muted-foreground">
              <span aria-label={`Issue ${around.position} of ${around.total}`}>
                {around.position} / {around.total}
              </span>
              <Button variant="ghost" size="icon-xs" aria-label="Previous issue" disabled={!around.previous} onClick={() => goTo(around.previous)}>
                <ChevronUp aria-hidden />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="Next issue" disabled={!around.next} onClick={() => goTo(around.next)}>
                <ChevronDown aria-hidden />
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={issue.viewerSubscribed ? "Unsubscribe" : "Subscribe"}
            aria-pressed={issue.viewerSubscribed}
            onClick={() => void setSubscribed({ issueId: issue.id, subscribed: !issue.viewerSubscribed }).catch((error) => toast.error(errorMessage(error)))}
          >
            {issue.viewerSubscribed ? <BellOff aria-hidden /> : <Bell aria-hidden />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Issue actions">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => void copy(issue.identifier, issue.identifier)}>
                <Hash aria-hidden /> Copy ID <span className="ml-auto"><ShortcutKeys id="copy-id" /></span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copy(url, "issue URL")}>
                <Link2 aria-hidden /> Copy URL <span className="ml-auto"><ShortcutKeys id="copy-url" /></span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copy(branchName(issue.identifier, issue.title), "branch name")}>
                <GitBranch aria-hidden /> Copy git branch name <span className="ml-auto"><ShortcutKeys id="copy-branch" /></span>
              </DropdownMenuItem>
              {writable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => void onDelete()}>
                    <Trash2 aria-hidden /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ShellHeader>

      <div className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col nav:flex-row">
        <article className="min-w-0 flex-1 space-y-6 px-6 py-8 nav:px-12">
          <h1 className="sr-only">
            {issue.identifier} {issue.title}
          </h1>
          <IssueTitle key={issue.title} title={issue.title} editable={writable} onSave={(title) => patch({ title })} />
          <IssueDescription issue={issue} people={mentionable} editable={writable} />
          <SubIssues issue={issue} lookups={lookups} />
          <Relations issue={issue} lookups={lookups} />
          <div className="border-t border-border pt-6">
            <Activity issueId={issue.id} />
          </div>
        </article>
        <div className="order-first border-b border-border px-6 py-4 nav:order-none nav:w-[260px] nav:shrink-0 nav:border-b-0 nav:border-l nav:py-8">
          <PropertyRail issue={issue} lookups={lookups} picker={picker} onPicker={setPicker} onUpdate={patch} onMove={onMove} />
        </div>
      </div>
    </>
  );
}

/** The title: edits in place, saves on Enter or blur, reverts if emptied. */
function IssueTitle({ title, editable, onSave }: { title: string; editable: boolean; onSave: (title: string) => void }) {
  const [value, setValue] = useState(title);
  const commit = () => {
    const next = value.replace(/\s+/g, " ").trim();
    if (!next) setValue(title);
    else if (next !== title) onSave(next);
  };
  return (
    <textarea
      aria-label="Issue title"
      value={value}
      readOnly={!editable}
      maxLength={titleMaxLength}
      rows={1}
      onChange={(event) => setValue(event.target.value.replace(/\n/g, ""))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setValue(title);
          event.currentTarget.blur();
        }
      }}
      className="field-sizing-content w-full resize-none bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground"
      placeholder="Issue title"
    />
  );
}
