"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/shell/user-avatar";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { describeEntry, type ActivityKind } from "@/lib/issues/activity";
import { errorMessage } from "@/lib/errors";
import { fullDate, timeAgo } from "@/lib/time";
import { useComposer } from "../composer";
import { IssueSearchCommand } from "../issue-search-picker";
import { StatusIcon } from "../status-icon";
import type { Lookups } from "../view/use-issue-source";
import type { IssueDetail } from "./types";

type Brief = { id: string; identifier: string; title: string; stateId: string; stateCategory: IssueDetail["stateCategory"] };

function IssueLink({ issue, lookups }: { issue: Brief; lookups: Lookups }) {
  const { href } = useWorkspace();
  const color = lookups.states.get(issue.stateId)?.color ?? "currentColor";
  return (
    <Link href={href("issue", issue.identifier)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
      <StatusIcon category={issue.stateCategory} color={color} />
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{issue.identifier}</span>
      <span className="truncate">{issue.title}</span>
    </Link>
  );
}

function SectionHeader({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-2">
      <h2 className="text-[13px] font-medium">{title}</h2>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}

export function SubIssues({ issue, lookups }: { issue: IssueDetail; lookups: Lookups }) {
  const composer = useComposer();
  const done = issue.children.filter((c) => c.stateCategory === "completed" || c.stateCategory === "canceled").length;
  if (issue.children.length === 0 && !issue.can.write) return null;
  return (
    <section aria-label="Sub-issues">
      <SectionHeader title="Sub-issues" detail={issue.children.length ? `${done}/${issue.children.length}` : undefined}>
        {issue.can.write && (
          <Button variant="ghost" size="icon-xs" aria-label="Add sub-issue" onClick={() => composer.open({ teamId: issue.teamId, parentId: issue.id })}>
            <Plus aria-hidden />
          </Button>
        )}
      </SectionHeader>
      {issue.children.length > 0 && (
        <ul className="-mx-2">
          {issue.children.map((child) => (
            <li key={child.id} className="flex">
              <IssueLink issue={child} lookups={lookups} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type RelationType = "blocks" | "blocked_by" | "related" | "duplicate";
const relationChoices: Array<{ type: RelationType; label: string }> = [
  { type: "blocks", label: "Blocks…" },
  { type: "blocked_by", label: "Blocked by…" },
  { type: "related", label: "Related to…" },
  { type: "duplicate", label: "Duplicate of…" },
];

/** How a stored relation reads from this issue's side. */
function relationLabel(type: string, direction: "outgoing" | "incoming"): string {
  if (type === "blocks") return direction === "outgoing" ? "Blocks" : "Blocked by";
  if (type === "duplicate") return direction === "outgoing" ? "Duplicate of" : "Duplicated by";
  return "Related";
}

export function Relations({ issue, lookups }: { issue: IssueDetail; lookups: Lookups }) {
  const add = useMutation(api.issues.addRelation);
  const remove = useMutation(api.issues.removeRelation);
  const [adding, setAdding] = useState(false);
  // Step two of adding: the chosen type, then search for the issue.
  const [pending, setPending] = useState<RelationType | null>(null);
  const groups = new Map<string, IssueDetail["relations"]>();
  for (const relation of issue.relations) {
    const label = relationLabel(relation.type, relation.direction);
    groups.set(label, [...(groups.get(label) ?? []), relation]);
  }
  if (issue.relations.length === 0 && !issue.can.write) return null;

  return (
    <section aria-label="Relations">
      <SectionHeader title="Relations">
        {issue.can.write && (
          <Popover open={adding} onOpenChange={(open) => (setAdding(open), setPending(null))}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Add relation">
                <Plus aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              {pending === null ? (
                <Command loop>
                  <CommandList>
                    <CommandGroup heading="Add relation">
                      {relationChoices.map((choice) => (
                        <CommandItem key={choice.type} onSelect={() => setPending(choice.type)} className="h-8">
                          {choice.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              ) : (
                <IssueSearchCommand
                  placeholder={relationChoices.find((c) => c.type === pending)!.label}
                  excludeId={issue.id}
                  onSelect={async (other) => {
                    setAdding(false);
                    setPending(null);
                    try {
                      await add({ issueId: issue.id, relatedIssueId: other.id, type: pending });
                    } catch (error) {
                      toast.error(errorMessage(error));
                    }
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
        )}
      </SectionHeader>
      {[...groups].map(([label, relations]) => (
        <div key={label} className="mb-1">
          <div className="px-0 py-1 text-xs text-muted-foreground">{label}</div>
          <ul className="-mx-2">
            {relations.map((relation) => (
              <li key={relation.id} className="group/rel flex items-center">
                <IssueLink issue={relation.issue} lookups={lookups} />
                {issue.can.write && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover/rel:opacity-100 focus-visible:opacity-100"
                    aria-label={`Remove relation to ${relation.issue.identifier}`}
                    onClick={() => remove({ relationId: relation.id as Id<"issueRelations"> }).catch((error) => toast.error(errorMessage(error)))}
                  >
                    <X aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function Activity({ issueId }: { issueId: Id<"issues"> }) {
  const entries = useQuery(api.issues.activity, { issueId });
  return (
    <section aria-label="Activity">
      <SectionHeader title="Activity" />
      {entries === undefined ? (
        <p className="text-xs text-muted-foreground">Loading activity…</p>
      ) : (
        <ol className="space-y-2.5">
          {entries.map((entry) =>
            describeEntry(entry.kind as ActivityKind, entry.changes).map((phrase, index) => (
              <li key={`${entry.id}:${index}`} className="flex items-start gap-2 text-[13px] text-muted-foreground" data-testid="activity-entry">
                {entry.actor ? (
                  <UserAvatar name={entry.actor.name} src={entry.actor.avatarUrl} className="mt-px size-4" />
                ) : (
                  <span className="size-4" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{entry.actor?.name ?? "Someone"}</span> {phrase}
                  <span aria-hidden> · </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <time dateTime={new Date(entry.at).toISOString()}>{timeAgo(entry.at)}</time>
                    </TooltipTrigger>
                    <TooltipContent>{fullDate(entry.at)}</TooltipContent>
                  </Tooltip>
                </span>
              </li>
            )),
          )}
        </ol>
      )}
    </section>
  );
}
