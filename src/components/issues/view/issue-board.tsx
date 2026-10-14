"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shell/user-avatar";
import type { Display } from "@/lib/filters/views";
import { orderBetween } from "@/lib/issues";
import { cn } from "@/lib/utils";
import { PriorityIcon } from "../priority-icon";
import { StatusIcon } from "../status-icon";
import type { IssueRow as Row } from "../use-issue-data";
import type { ViewGroup } from "./use-derived-view";
import type { Lookups } from "./use-issue-source";

/** Cards rendered per column before "Show more" (columns with thousands of issues stay fast). */
const pageSize = 100;

export type BoardMove = { issue: Row; patch: { stateId?: Id<"workflowStates">; priority?: number; assigneeId?: Id<"users"> | null; sortOrder?: number } };

/**
 * The board: one column per group. Dragging a card to another column changes
 * the grouped property (status, priority, assignee); with manual ordering, its
 * position within the column is kept too. Keyboard dragging works (space, arrows).
 */
export function IssueBoard({
  groups,
  lookups,
  display,
  hrefFor,
  onMove,
  onCreateInGroup,
}: {
  groups: ViewGroup[];
  lookups: Lookups;
  display: Display;
  hrefFor: (issue: Row) => string;
  onMove: (move: BoardMove) => void;
  onCreateInGroup?: (group: ViewGroup) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState<Row | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const byId = useMemo(() => new Map(groups.flatMap((g) => g.issues.map((issue) => [issue.id as string, { issue, group: g }]))), [groups]);
  const canMove = display.groupBy === "status" || display.groupBy === "priority" || display.groupBy === "assignee";

  function onDragStart(event: DragStartEvent) {
    setDragging(byId.get(String(event.active.id))?.issue ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const from = byId.get(String(event.active.id));
    if (!from || !event.over) return;
    const overId = String(event.over.id);
    const target = groups.find((g) => g.key === overId) ?? byId.get(overId)?.group;
    if (!target) return;
    const issue = from.issue;
    const patch: BoardMove["patch"] = {};
    if (target.key !== from.group.key) {
      if (!canMove) return;
      if (display.groupBy === "priority") patch.priority = Number(target.key);
      else if (display.groupBy === "assignee") patch.assigneeId = target.key === "none" ? null : (target.key as Id<"users">);
      else {
        // Cross-team boards group by state name: use this issue's team's state of that name.
        const state =
          lookups.states.get(target.key) ??
          lookups.stateList.find((s) => s.teamId === issue.teamId && `${s.category}:${s.name}` === target.key);
        if (!state || state.teamId !== issue.teamId) return;
        patch.stateId = state.id as Id<"workflowStates">;
      }
    }
    if (display.orderBy === "manual") {
      const siblings = target.issues.filter((i) => i.id !== issue.id);
      const overIndex = siblings.findIndex((i) => i.id === overId);
      const index = overIndex === -1 ? siblings.length : overIndex;
      const before = siblings[index - 1]?.sortOrder ?? null;
      const after = siblings[index]?.sortOrder ?? null;
      if (before === null || after === null || before < after) patch.sortOrder = orderBetween(before, after);
    }
    if (Object.keys(patch).length > 0) onMove({ issue, patch });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4" data-testid="issue-board" role="list" aria-label="Board">
        {groups.map((group) => {
          const limit = limits[group.key] ?? pageSize;
          return (
            <Column key={group.key} group={group} lookups={lookups} onCreate={onCreateInGroup ? () => onCreateInGroup(group) : undefined}>
              <SortableContext items={group.issues.slice(0, limit).map((i) => i.id)} strategy={verticalListSortingStrategy}>
                {group.issues.slice(0, limit).map((issue) => (
                  <Card key={issue.id} issue={issue} lookups={lookups} href={hrefFor(issue)} />
                ))}
              </SortableContext>
              {group.issues.length > limit && (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setLimits({ ...limits, [group.key]: limit + pageSize })}>
                  Show {Math.min(pageSize, group.issues.length - limit)} more
                </Button>
              )}
            </Column>
          );
        })}
      </div>
      <DragOverlay>{dragging && <CardBody issue={dragging} lookups={lookups} overlay />}</DragOverlay>
    </DndContext>
  );
}

function Column({ group, lookups, onCreate, children }: { group: ViewGroup; lookups: Lookups; onCreate?: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: group.key });
  const state = group.kind === "status" ? (lookups.states.get(group.key) ?? lookups.stateList.find((s) => `${s.category}:${s.name}` === group.key)) : undefined;
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${group.label}, ${group.issues.length} issues`}
      data-testid="board-column"
      className={cn("flex w-[280px] shrink-0 flex-col rounded-lg bg-surface-2/60", isOver && "ring-2 ring-brand/50")}
    >
      <header className="flex h-10 items-center gap-2 px-3 text-[13px] font-medium">
        {state && <StatusIcon category={state.category} color={state.color} />}
        {group.kind === "priority" && <PriorityIcon priority={Number(group.key)} />}
        {group.label}
        <span className="font-normal text-muted-strong">{group.issues.length}</span>
        {onCreate && (
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={`Create issue in ${group.label}`} onClick={onCreate}>
            <Plus aria-hidden />
          </Button>
        )}
      </header>
      <div className="flex min-h-16 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

function Card({ issue, lookups, href }: { issue: Row; lookups: Lookups; href: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
      data-testid="board-card"
      data-identifier={issue.identifier}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable issue"
      aria-label={`${issue.identifier} ${issue.title}`}
    >
      <Link href={href} draggable={false} tabIndex={-1} className="block focus-visible:outline-none">
        <CardBody issue={issue} lookups={lookups} />
      </Link>
    </div>
  );
}

function CardBody({ issue, lookups, overlay = false }: { issue: Row; lookups: Lookups; overlay?: boolean }) {
  const assignee = issue.assigneeId ? lookups.people.get(issue.assigneeId) : undefined;
  const labels = issue.labelIds.map((id) => lookups.labels.get(id)).filter((l) => l !== undefined);
  return (
    <div className={cn("rounded-md border border-border bg-card p-3 text-[13px] shadow-xs hover:border-muted-foreground/40", overlay && "rotate-1 shadow-modal")}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {issue.identifier}
        {assignee && <UserAvatar name={assignee.name} src={assignee.avatarUrl} className="ml-auto size-[18px]" />}
      </div>
      <div className="mt-1.5 line-clamp-2 font-medium">{issue.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityIcon priority={issue.priority} />
        {labels.slice(0, 3).map((label) => (
          <span key={label.id} className="flex items-center gap-1 rounded-full border border-border px-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
            {label.name}
          </span>
        ))}
        {issue.estimate !== null && <span className="rounded border border-border px-1 text-xs text-muted-foreground">{issue.estimate}</span>}
      </div>
    </div>
  );
}
