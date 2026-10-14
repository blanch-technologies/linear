"use client";

import type { ReactNode } from "react";
import { CalendarDays, CircleDashed, Tag, Triangle, UserRound } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { UserAvatar } from "@/components/shell/user-avatar";
import { TeamMark } from "@/components/shell/team-mark";
import { estimateScales, priorities, type EstimateScale } from "@/lib/issues";
import { stateCategoryLabels } from "@/lib/workflow";
import { OptionPicker } from "./option-picker";
import { PriorityIcon } from "./priority-icon";
import { StatusIcon } from "./status-icon";
import { useAssignable, useTeamLabels, useTeamStates } from "./use-issue-data";

type Controlled = { open?: boolean; onOpenChange?: (open: boolean) => void; trigger: ReactNode; align?: "start" | "end" };

export function StatusPicker({ teamId, value, onChange, ...rest }: Controlled & { teamId: Id<"teams">; value: string | null; onChange: (stateId: Id<"workflowStates">) => void }) {
  const states = useTeamStates(teamId) ?? [];
  return (
    <OptionPicker
      {...rest}
      placeholder="Change status…"
      value={value}
      onSelect={(id) => onChange(id as Id<"workflowStates">)}
      options={states.map((state, index) => ({
        value: state.id,
        label: state.name,
        icon: <StatusIcon category={state.category} color={state.color} />,
        keywords: [stateCategoryLabels[state.category]],
        hotkey: index < 9 ? String(index + 1) : undefined,
      }))}
    />
  );
}

export function PriorityPicker({ value, onChange, ...rest }: Controlled & { value: number; onChange: (priority: number) => void }) {
  return (
    <OptionPicker
      {...rest}
      placeholder="Set priority…"
      value={String(value)}
      onSelect={(v) => onChange(Number(v))}
      options={priorities.map((p) => ({ value: String(p.value), label: p.label, icon: <PriorityIcon priority={p.value} />, hotkey: String(p.value) }))}
    />
  );
}

export function AssigneePicker({ teamId, value, onChange, ...rest }: Controlled & { teamId: Id<"teams">; value: string | null; onChange: (userId: Id<"users"> | null) => void }) {
  const people = useAssignable(teamId) ?? [];
  return (
    <OptionPicker
      {...rest}
      placeholder="Assign to…"
      value={value ?? "none"}
      onSelect={(v) => onChange(v === "none" ? null : (v as Id<"users">))}
      options={[
        { value: "none", label: "No assignee", icon: <UserRound className="size-4 text-muted-foreground" aria-hidden />, hotkey: "0" },
        ...people.map((person) => ({
          value: person.id,
          label: person.name,
          icon: <UserAvatar name={person.name} src={person.avatarUrl} className="size-4" />,
          keywords: [person.email],
          group: person.inTeam ? "Team members" : "Others",
        })),
      ]}
    />
  );
}

export function LabelPicker({ teamId, value, onChange, ...rest }: Controlled & { teamId: Id<"teams">; value: string[]; onChange: (labelIds: Id<"labels">[]) => void }) {
  const labels = useTeamLabels(teamId) ?? [];
  const groups = new Map(labels.filter((l) => l.isGroup).map((l) => [l.id, l.name]));
  return (
    <OptionPicker
      {...rest}
      multiple
      placeholder="Add labels…"
      value={value}
      onSelect={(id) => {
        const label = labels.find((l) => l.id === id);
        let next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
        // One label per group: picking a sibling replaces it.
        if (label?.parentId && !value.includes(id)) {
          next = next.filter((v) => v === id || labels.find((l) => l.id === v)?.parentId !== label.parentId);
        }
        onChange(next as Id<"labels">[]);
      }}
      emptyText="No labels. Create them in team settings."
      options={labels
        .filter((label) => !label.isGroup)
        .map((label) => ({
          value: label.id,
          label: label.name,
          icon: <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: label.color }} />,
          group: label.parentId ? groups.get(label.parentId) : undefined,
        }))}
    />
  );
}

export function EstimatePicker({ scale, value, onChange, ...rest }: Controlled & { scale: EstimateScale; value: number | null; onChange: (estimate: number | null) => void }) {
  const config = estimateScales[scale];
  return (
    <OptionPicker
      {...rest}
      placeholder="Set estimate…"
      value={value === null ? "none" : String(value)}
      onSelect={(v) => onChange(v === "none" ? null : Number(v))}
      options={[
        { value: "none", label: "No estimate", icon: <Triangle className="size-4 text-muted-foreground" aria-hidden />, hotkey: "0" },
        ...config.values.map((n, index) => ({
          value: String(n),
          label: `${config.format(n)} point${n === 1 ? "" : "s"}`,
          icon: <Triangle className="size-4" aria-hidden />,
          hotkey: String(index + 1),
        })),
      ]}
    />
  );
}

function isoDay(offsetDays: number, from = new Date()): string {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate() + offsetDays));
  return d.toISOString().slice(0, 10);
}

export function DueDatePicker({ value, onChange, ...rest }: Controlled & { value: string | null; onChange: (date: string | null) => void }) {
  const today = new Date();
  const toFriday = (5 - today.getDay() + 7) % 7;
  const presets = [
    { value: isoDay(0), label: "Today" },
    { value: isoDay(1), label: "Tomorrow" },
    { value: isoDay(toFriday), label: "End of this week" },
    { value: isoDay(7), label: "In one week" },
    { value: isoDay(30), label: "In one month" },
  ];
  return (
    <OptionPicker
      {...rest}
      placeholder="Due date… (or type 2026-10-31)"
      value={value}
      onSelect={(v) => onChange(v === "none" ? null : v)}
      options={[
        ...presets.map((p) => ({ ...p, icon: <CalendarDays className="size-4" aria-hidden />, description: p.value })),
        ...(value ? [{ value: "none", label: "Remove due date", icon: <CalendarDays className="size-4 text-muted-foreground" aria-hidden /> }] : []),
      ]}
      footer={
        <label className="flex items-center gap-2 border-t border-border p-2 text-xs text-muted-strong">
          Pick a date
          <input
            type="date"
            aria-label="Pick a due date"
            value={value ?? ""}
            onChange={(event) => event.target.value && onChange(event.target.value)}
            className="ml-auto rounded border border-input bg-background px-1.5 py-0.5 text-foreground"
          />
        </label>
      }
    />
  );
}

export function TeamPicker({
  teams,
  value,
  onChange,
  ...rest
}: Controlled & { teams: Array<{ id: string; name: string; key: string }>; value: string; onChange: (teamId: Id<"teams">) => void }) {
  return (
    <OptionPicker
      {...rest}
      placeholder="Move to team…"
      value={value}
      onSelect={(id) => onChange(id as Id<"teams">)}
      options={teams.map((team) => ({ value: team.id, label: team.name, icon: <TeamMark teamKey={team.key} />, keywords: [team.key] }))}
    />
  );
}

export const pickerIcons = { status: CircleDashed, label: Tag };
