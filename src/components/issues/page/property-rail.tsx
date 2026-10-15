"use client";

import type { ReactNode } from "react";
import { CalendarDays, Tag, Triangle, UserRound, X } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shell/user-avatar";
import { TeamMark } from "@/components/shell/team-mark";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { priorityLabel, type EstimateScale } from "@/lib/issues";
import { cn } from "@/lib/utils";
import { AssigneePicker, DueDatePicker, EstimatePicker, LabelPicker, PriorityPicker, StatusPicker, TeamPicker } from "../pickers";
import { PriorityIcon } from "../priority-icon";
import { StatusIcon } from "../status-icon";
import { IssueSearchPicker } from "../issue-search-picker";
import type { IssueFieldsPatch } from "../use-update-issue";
import type { Lookups } from "../view/use-issue-source";
import type { IssueDetail, RailPicker } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <div className="w-20 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

/** A rail value that opens its picker. Disabled for people who can't edit. */
function Trigger({ label, children, disabled, muted, ...props }: { label: string; children: ReactNode; disabled?: boolean; muted?: boolean } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      {...props}
      className={cn(
        "-ml-1.5 flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-[13px] hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent",
        muted && "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** The property rail (D-33): every property, editable with the same pickers as lists. */
export function PropertyRail({
  issue,
  lookups,
  picker,
  onPicker,
  onUpdate,
  onMove,
}: {
  issue: IssueDetail;
  lookups: Lookups;
  picker: RailPicker | null;
  onPicker: (picker: RailPicker | null) => void;
  onUpdate: (patch: IssueFieldsPatch) => void;
  onMove: (teamId: Id<"teams">) => void;
}) {
  const { teams } = useWorkspace();
  const teamId = issue.teamId as Id<"teams">;
  const state = lookups.states.get(issue.stateId);
  const readOnly = !issue.can.write;
  const control = (kind: RailPicker) => ({ open: picker === kind, onOpenChange: (open: boolean) => onPicker(open ? kind : null) });

  return (
    <aside aria-label="Properties" className="space-y-1 text-[13px]">
      <Row label="Status">
        <StatusPicker
          {...control("status")}
          teamId={teamId}
          value={issue.stateId}
          onChange={(stateId) => onUpdate({ stateId })}
          trigger={
            <Trigger label={`Status: ${state?.name ?? ""}`} disabled={readOnly}>
              {state && <StatusIcon category={state.category} color={state.color} />}
              <span className="truncate">{state?.name ?? "Unknown"}</span>
            </Trigger>
          }
        />
      </Row>
      <Row label="Priority">
        <PriorityPicker
          {...control("priority")}
          value={issue.priority}
          onChange={(priority) => onUpdate({ priority })}
          trigger={
            <Trigger label={`Priority: ${priorityLabel(issue.priority)}`} disabled={readOnly} muted={issue.priority === 0}>
              <PriorityIcon priority={issue.priority} />
              <span>{priorityLabel(issue.priority)}</span>
            </Trigger>
          }
        />
      </Row>
      <Row label="Assignee">
        <AssigneePicker
          {...control("assignee")}
          teamId={teamId}
          value={issue.assigneeId}
          onChange={(assigneeId) => onUpdate({ assigneeId })}
          trigger={
            <Trigger label={`Assignee: ${issue.assignee?.name ?? "none"}`} disabled={readOnly} muted={!issue.assignee}>
              {issue.assignee ? (
                <>
                  <UserAvatar name={issue.assignee.name} src={issue.assignee.avatarUrl} className="size-4" />
                  <span className="truncate">{issue.assignee.name}</span>
                </>
              ) : (
                <>
                  <UserRound className="size-4" aria-hidden /> Assign
                </>
              )}
            </Trigger>
          }
        />
      </Row>
      <Row label="Labels">
        <LabelPicker
          {...control("labels")}
          teamId={teamId}
          value={issue.labelIds}
          onChange={(labelIds) => onUpdate({ labelIds })}
          trigger={
            <Trigger label="Labels" disabled={readOnly} muted={issue.labels.length === 0}>
              {issue.labels.length === 0 ? (
                <>
                  <Tag className="size-4" aria-hidden /> Add label
                </>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {issue.labels.map((label) => (
                    <span key={label.id} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
                      <span className="size-2 rounded-full" style={{ background: label.color }} aria-hidden />
                      {label.name}
                    </span>
                  ))}
                </span>
              )}
            </Trigger>
          }
        />
      </Row>
      {issue.team.estimateScale && (
        <Row label="Estimate">
          <EstimatePicker
            {...control("estimate")}
            scale={issue.team.estimateScale as EstimateScale}
            value={issue.estimate}
            onChange={(estimate) => onUpdate({ estimate })}
            trigger={
              <Trigger label={`Estimate: ${issue.estimate ?? "none"}`} disabled={readOnly} muted={issue.estimate === null}>
                <Triangle className="size-4" aria-hidden />
                {issue.estimate === null ? "Set estimate" : `${issue.estimate} points`}
              </Trigger>
            }
          />
        </Row>
      )}
      <Row label="Due date">
        <DueDatePicker
          {...control("dueDate")}
          value={issue.dueDate}
          onChange={(dueDate) => onUpdate({ dueDate })}
          trigger={
            <Trigger label={`Due date: ${issue.dueDate ?? "none"}`} disabled={readOnly} muted={!issue.dueDate}>
              <CalendarDays className="size-4" aria-hidden />
              {issue.dueDate ? formatDue(issue.dueDate) : "Set due date"}
            </Trigger>
          }
        />
      </Row>
      <Row label="Parent">
        <div className="flex min-w-0 items-center gap-1">
          <IssueSearchPicker
            {...control("parent")}
            placeholder="Set parent issue…"
            excludeId={issue.id}
            onSelect={(parent) => onUpdate({ parentId: parent.id })}
            trigger={
              <Trigger label={`Parent: ${issue.parent?.identifier ?? "none"}`} disabled={readOnly} muted={!issue.parent}>
                <span className="truncate">{issue.parent ? `${issue.parent.identifier} ${issue.parent.title}` : "Set parent"}</span>
              </Trigger>
            }
          />
          {issue.parent && !readOnly && (
            <Button variant="ghost" size="icon-xs" aria-label="Remove parent" onClick={() => onUpdate({ parentId: null })}>
              <X aria-hidden />
            </Button>
          )}
        </div>
      </Row>
      <Row label="Team">
        <TeamPicker
          {...control("team")}
          teams={teams.filter((t) => t.can.write)}
          value={issue.teamId}
          onChange={(next) => next !== issue.teamId && onMove(next)}
          trigger={
            <Trigger label={`Team: ${issue.team.name}`} disabled={readOnly}>
              <TeamMark teamKey={issue.team.key} />
              <span className="truncate">{issue.team.name}</span>
            </Trigger>
          }
        />
      </Row>
    </aside>
  );
}

function formatDue(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
