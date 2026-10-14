"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Plus } from "lucide-react";
import type { Display } from "@/lib/filters/views";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PriorityIcon } from "../priority-icon";
import { StatusIcon } from "../status-icon";
import { UserAvatar } from "@/components/shell/user-avatar";
import type { IssueRow as Row } from "../use-issue-data";
import { IssueListRow, type IssuePatch, type PickerKind } from "./issue-row";
import type { ViewGroup } from "./use-derived-view";
import type { Lookups } from "./use-issue-source";

type FlatRow = { kind: "group"; group: ViewGroup } | { kind: "issue"; issue: Row; groupKey: string };

/** The virtualized list (D-36): group headers, rows, keyboard focus and selection. */
export function IssueList({
  groups,
  lookups,
  display,
  hrefFor,
  focusedId,
  selected,
  picker,
  collapsed,
  onToggleGroup,
  onFocus,
  onToggleSelect,
  onPicker,
  onUpdate,
  onOpen,
  onCreateInGroup,
}: {
  groups: ViewGroup[];
  lookups: Lookups;
  display: Display;
  hrefFor: (issue: Row) => string;
  focusedId: string | null;
  selected: ReadonlySet<string>;
  picker: { id: string; kind: PickerKind } | null;
  collapsed: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  onFocus: (id: string) => void;
  onToggleSelect: (id: string, extend: boolean) => void;
  onPicker: (value: { id: string; kind: PickerKind } | null) => void;
  onUpdate: (patch: IssuePatch, issue: Row) => void;
  onOpen: (issue: Row) => void;
  onCreateInGroup?: (group: ViewGroup) => void;
}) {
  const flat = useMemo<FlatRow[]>(() => {
    const showHeaders = display.groupBy !== "none";
    return groups.flatMap((group) => [
      ...(showHeaders ? [{ kind: "group" as const, group }] : []),
      ...(collapsed.has(group.key) ? [] : group.issues.map((issue) => ({ kind: "issue" as const, issue, groupKey: group.key }))),
    ]);
  }, [groups, collapsed, display.groupBy]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns non-memoizable functions.
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (flat[index]?.kind === "group" ? 36 : 38),
    overscan: 12,
  });

  // Keep the keyboard-focused row in view.
  const [lastFocused, setLastFocused] = useState<string | null>(null);
  useEffect(() => {
    if (!focusedId || focusedId === lastFocused) return;
    const index = flat.findIndex((row) => row.kind === "issue" && row.issue.id === focusedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
    setLastFocused(focusedId);
  }, [focusedId, lastFocused, flat, virtualizer]);

  return (
    <div ref={scrollRef} role="grid" aria-label="Issues" aria-rowcount={flat.length} className="min-h-0 flex-1 overflow-y-auto" data-testid="issue-list">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = flat[item.index]!;
          return (
            <div key={row.kind === "group" ? `g:${row.group.key}` : row.issue.id} className="absolute inset-x-0" style={{ top: item.start, height: item.size }}>
              {row.kind === "group" ? (
                <GroupHeader
                  group={row.group}
                  lookups={lookups}
                  collapsed={collapsed.has(row.group.key)}
                  onToggle={() => onToggleGroup(row.group.key)}
                  onCreate={onCreateInGroup ? () => onCreateInGroup(row.group) : undefined}
                />
              ) : (
                <IssueListRow
                  issue={row.issue}
                  lookups={lookups}
                  properties={display.properties}
                  href={hrefFor(row.issue)}
                  focused={row.issue.id === focusedId}
                  selected={selected.has(row.issue.id)}
                  picker={picker && picker.id === row.issue.id ? picker.kind : null}
                  onPicker={(kind) => onPicker(kind ? { id: row.issue.id, kind } : null)}
                  onUpdate={onUpdate}
                  onFocus={() => onFocus(row.issue.id)}
                  onToggleSelect={(extend) => onToggleSelect(row.issue.id, extend)}
                  onOpen={() => onOpen(row.issue)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupHeader({
  group,
  lookups,
  collapsed,
  onToggle,
  onCreate,
}: {
  group: ViewGroup;
  lookups: Lookups;
  collapsed: boolean;
  onToggle: () => void;
  onCreate?: () => void;
}) {
  let icon = null;
  if (group.kind === "status") {
    const state = lookups.states.get(group.key) ?? lookups.stateList.find((s) => `${s.category}:${s.name}` === group.key);
    if (state) icon = <StatusIcon category={state.category} color={state.color} />;
  } else if (group.kind === "priority") icon = <PriorityIcon priority={Number(group.key)} />;
  else if (group.kind === "assignee" && group.key !== "none") {
    const person = lookups.people.get(group.key);
    if (person) icon = <UserAvatar name={person.name} src={person.avatarUrl} className="size-4" />;
  } else if (group.kind === "label" && group.key !== "none") {
    const label = lookups.labels.get(group.key);
    if (label) icon = <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: label.color }} />;
  }
  return (
    <div role="row" className="flex h-9 items-center gap-2 border-b border-border bg-surface-2 px-2 text-[13px]" data-testid="group-header">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex flex-1 items-center gap-2 rounded px-1 text-left font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronRight className={cn("size-3.5 text-muted-strong transition-transform", !collapsed && "rotate-90")} aria-hidden />
        {icon}
        {group.label}
        <span className="font-normal text-muted-strong">{group.issues.length}</span>
      </button>
      {onCreate && (
        <Button variant="ghost" size="icon-xs" aria-label={`Create issue in ${group.label}`} onClick={onCreate}>
          <Plus aria-hidden />
        </Button>
      )}
    </div>
  );
}
