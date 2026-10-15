"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusIcon } from "./status-icon";
import { useLookups } from "./view/use-issue-source";

export type IssueBrief = { id: Id<"issues">; identifier: string; title: string };

/** Search-as-you-type issue list (by identifier or title), for use inside a popover. */
export function IssueSearchCommand({
  placeholder,
  excludeId,
  onSelect,
}: {
  placeholder: string;
  excludeId?: Id<"issues">;
  onSelect: (issue: IssueBrief) => void;
}) {
  const [search, setSearch] = useState("");
  const lookups = useLookups();
  const results = useQuery(api.issues.quickSearch, search.trim() ? { query: search, excludeId } : "skip");
  return (
    <Command shouldFilter={false} loop>
      <CommandInput value={search} onValueChange={setSearch} placeholder={placeholder} aria-label={placeholder} />
      <CommandList className="max-h-72">
        <CommandEmpty>{search.trim() ? (results === undefined ? "Searching…" : "No issues match") : "Type an ID or title"}</CommandEmpty>
        {results && results.length > 0 && (
          <CommandGroup>
            {results.map((issue) => (
              <CommandItem
                key={issue.id}
                value={issue.id}
                onSelect={() => onSelect({ id: issue.id, identifier: issue.identifier, title: issue.title })}
                className="h-8"
              >
                <StatusIcon category={issue.stateCategory} color={lookups.states.get(issue.stateId)?.color ?? "currentColor"} />
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{issue.identifier}</span>
                <span className="truncate">{issue.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

/** Picks another issue (the parent). */
export function IssueSearchPicker({
  trigger,
  placeholder,
  excludeId,
  onSelect,
  open: controlledOpen,
  onOpenChange,
  align = "start",
}: {
  trigger: ReactNode;
  placeholder: string;
  excludeId?: Id<"issues">;
  onSelect: (issue: IssueBrief) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "end";
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-0">
        {open && (
          <IssueSearchCommand
            placeholder={placeholder}
            excludeId={excludeId}
            onSelect={(issue) => {
              onSelect(issue);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
