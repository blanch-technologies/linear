"use client";

import { memo, type ReactNode } from "react";
import Link from "next/link";
import type { Id } from "@convex/_generated/dataModel";
import type { Display } from "@/lib/filters/views";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/shell/user-avatar";
import { AssigneePicker, LabelPicker, PriorityPicker, StatusPicker } from "../pickers";
import { PriorityIcon } from "../priority-icon";
import { StatusIcon } from "../status-icon";
import type { IssueRow as Row } from "../use-issue-data";
import type { Lookups } from "./use-issue-source";

export type PickerKind = "status" | "priority" | "assignee" | "labels";
export type IssuePatch = {
  stateId?: Id<"workflowStates">;
  priority?: number;
  assigneeId?: Id<"users"> | null;
  labelIds?: Id<"labels">[];
};

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function Cell({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={-1}
      onClick={(event) => event.stopPropagation()}
      className={cn("flex h-6 shrink-0 items-center gap-1 rounded px-1 hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", className)}
    >
      {children}
    </button>
  );
}

/**
 * One list row (D-33 density). Property cells open their pickers; `picker`
 * lets keyboard shortcuts open them for the focused row.
 */
export const IssueListRow = memo(function IssueListRow({
  issue,
  lookups,
  properties,
  href,
  focused,
  selected,
  picker,
  onPicker,
  onUpdate,
  onFocus,
  onToggleSelect,
  onOpen,
}: {
  issue: Row;
  lookups: Lookups;
  properties: Display["properties"];
  href: string;
  focused: boolean;
  selected: boolean;
  picker: PickerKind | null;
  onPicker: (kind: PickerKind | null) => void;
  onUpdate: (patch: IssuePatch, current: Row) => void;
  onFocus: () => void;
  onToggleSelect: (extend: boolean) => void;
  onOpen: () => void;
}) {
  const state = lookups.states.get(issue.stateId);
  const assignee = issue.assigneeId ? lookups.people.get(issue.assigneeId) : undefined;
  const labels = issue.labelIds.map((id) => lookups.labels.get(id)).filter((l) => l !== undefined);
  const show = (p: Display["properties"][number]) => properties.includes(p);
  const teamId = issue.teamId as Id<"teams">;
  const open = (kind: PickerKind) => (value: boolean) => onPicker(value ? kind : null);
  const overdue = issue.dueDate && issue.dueDate < new Date().toISOString().slice(0, 10) && issue.stateCategory !== "completed" && issue.stateCategory !== "canceled";

  return (
    <div
      role="row"
      aria-selected={selected}
      data-focused={focused || undefined}
      data-testid="issue-row"
      data-identifier={issue.identifier}
      onMouseEnter={onFocus}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) return;
        if ((event.target as HTMLElement).closest("a, input")) return;
        onOpen();
      }}
      className={cn(
        "group/row flex h-[38px] cursor-default items-center gap-2 border-b border-border/60 pr-4 pl-2 text-[13px]",
        focused && "bg-surface",
        selected && "bg-brand/10",
      )}
    >
      <input
        type="checkbox"
        aria-label={`Select ${issue.identifier}`}
        checked={selected}
        tabIndex={-1}
        onChange={(event) => onToggleSelect((event.nativeEvent as MouseEvent).shiftKey)}
        className={cn("size-3.5 accent-[var(--brand-solid)] opacity-0 group-hover/row:opacity-100", (selected || focused) && "opacity-100")}
      />
      {show("priority") && (
        <PriorityPicker
          value={issue.priority}
          open={picker === "priority"}
          onOpenChange={open("priority")}
          onChange={(priority) => onUpdate({ priority }, issue)}
          trigger={
            <Cell label={`Priority: ${issue.priority}`}>
              <PriorityIcon priority={issue.priority} />
            </Cell>
          }
        />
      )}
      {show("identifier") && <span className="w-[72px] shrink-0 truncate text-xs text-muted-foreground">{issue.identifier}</span>}
      {show("status") && (
        <StatusPicker
          teamId={teamId}
          value={issue.stateId}
          open={picker === "status"}
          onOpenChange={open("status")}
          onChange={(stateId) => onUpdate({ stateId }, issue)}
          trigger={
            <Cell label={`Status: ${state?.name ?? ""}`}>
              {state && <StatusIcon category={state.category} color={state.color} />}
            </Cell>
          }
        />
      )}
      <Link
        href={href}
        className="min-w-0 flex-1 truncate font-medium text-foreground focus-visible:outline-none"
        tabIndex={-1}
        onFocus={onFocus}
      >
        {issue.title}
      </Link>
      {show("labels") && (
        <LabelPicker
          teamId={teamId}
          value={issue.labelIds}
          open={picker === "labels"}
          onOpenChange={open("labels")}
          onChange={(labelIds) => onUpdate({ labelIds }, issue)}
          trigger={
            <Cell label={`Labels: ${labels.map((l) => l.name).join(", ") || "none"}`} className={cn(labels.length === 0 && "sr-only")}>
              {labels.slice(0, 3).map((label) => (
                <span key={label.id} className="flex items-center gap-1 rounded-full border border-border px-1.5 text-xs text-muted-foreground">
                  <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
                  {label.name}
                </span>
              ))}
              {labels.length > 3 && <span className="text-xs text-muted-foreground">+{labels.length - 3}</span>}
            </Cell>
          }
        />
      )}
      {show("dueDate") && issue.dueDate && (
        <span className={cn("shrink-0 text-xs text-muted-foreground", overdue && "text-red")}>{shortDate.format(new Date(`${issue.dueDate}T00:00:00`))}</span>
      )}
      {show("estimate") && issue.estimate !== null && (
        <span className="shrink-0 rounded border border-border px-1 text-xs text-muted-foreground" aria-label={`Estimate ${issue.estimate}`}>
          {issue.estimate}
        </span>
      )}
      {show("created") && <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{shortDate.format(issue.createdAt)}</span>}
      {show("updated") && <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{shortDate.format(issue.updatedAt)}</span>}
      {show("assignee") && (
        <AssigneePicker
          teamId={teamId}
          value={issue.assigneeId}
          open={picker === "assignee"}
          onOpenChange={open("assignee")}
          align="end"
          onChange={(assigneeId) => onUpdate({ assigneeId }, issue)}
          trigger={
            <Cell label={`Assignee: ${assignee?.name ?? "none"}`}>
              {assignee ? (
                <UserAvatar name={assignee.name} src={assignee.avatarUrl} className="size-[18px]" />
              ) : (
                <span aria-hidden className="size-[18px] rounded-full border border-dashed border-muted-foreground/60" />
              )}
            </Cell>
          }
        />
      )}
    </div>
  );
});
