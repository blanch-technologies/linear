"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CircleDashed, Columns3, ListFilter, Rows3, SlidersHorizontal, Tag, UserRound, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/shell/user-avatar";
import { TeamMark } from "@/components/shell/team-mark";
import { ShortcutKeys } from "@/components/shortcuts/shortcut-keys";
import { isGroup, removeCondition, setCondition, type Condition, type Filter } from "@/lib/filters";
import { defaultDisplay, type Display, type GroupField, type OrderField } from "@/lib/filters/views";
import { priorities } from "@/lib/issues";
import { stateCategories } from "@/lib/workflow";
import { cn } from "@/lib/utils";
import { PriorityIcon } from "../priority-icon";
import { StatusIcon } from "../status-icon";
import type { Lookups } from "./use-issue-source";

type FieldKey = "status" | "priority" | "assignee" | "creator" | "labels" | "dueDate" | "team";
type ValueOption = { value: string; label: string; icon?: React.ReactNode };

const fieldMeta: Record<FieldKey, { label: string; icon: React.ReactNode }> = {
  status: { label: "Status", icon: <CircleDashed aria-hidden /> },
  priority: { label: "Priority", icon: <PriorityIcon priority={2} /> },
  assignee: { label: "Assignee", icon: <UserRound aria-hidden /> },
  creator: { label: "Creator", icon: <UserRound aria-hidden /> },
  labels: { label: "Labels", icon: <Tag aria-hidden /> },
  dueDate: { label: "Due date", icon: <CalendarDays aria-hidden /> },
  team: { label: "Team", icon: <Users aria-hidden /> },
};

const dueOptions: Array<ValueOption & { condition: Condition }> = [
  { value: "overdue", label: "Overdue", condition: { field: "dueDate", op: "overdue" } },
  { value: "week", label: "Due within a week", condition: { field: "dueDate", op: "before", value: "7d" } },
  { value: "set", label: "Has a due date", condition: { field: "dueDate", op: "set" } },
  { value: "unset", label: "No due date", condition: { field: "dueDate", op: "unset" } },
];

/** Status values are names: across teams, picking "In Progress" means every team's In Progress. */
function statusOptions(lookups: Lookups, teamIds: string[] | null): Array<ValueOption & { ids: string[] }> {
  const states = lookups.stateList
    .filter((s) => !teamIds || teamIds.includes(s.teamId))
    .sort((a, b) => stateCategories.indexOf(a.category) - stateCategories.indexOf(b.category) || a.position - b.position);
  const byName = new Map<string, ValueOption & { ids: string[] }>();
  for (const s of states) {
    const key = `${s.category}:${s.name}`;
    const entry = byName.get(key) ?? { value: key, label: s.name, ids: [] as string[], icon: <StatusIcon category={s.category} color={s.color} /> };
    entry.ids.push(s.id);
    byName.set(key, entry);
  }
  return [...byName.values()];
}

function selectedValues(filter: Filter, field: FieldKey, lookups: Lookups): string[] {
  const condition = filter.conditions.find((node) => !isGroup(node) && node.field === field) as Condition | undefined;
  if (!condition) return [];
  if (condition.field === "status") {
    const names = new Set(condition.values.map((id) => lookups.states.get(id)).filter(Boolean).map((s) => `${s!.category}:${s!.name}`));
    return [...names];
  }
  if (condition.field === "dueDate") return dueOptions.filter((o) => JSON.stringify(o.condition) === JSON.stringify(condition)).map((o) => o.value);
  if ("values" in condition) return condition.values.map(String);
  return [];
}

export function ViewToolbar({
  filter,
  onFilter,
  display,
  onDisplay,
  lookups,
  teams,
  scopeTeamIds,
  count,
}: {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  display: Display;
  onDisplay: (display: Display) => void;
  lookups: Lookups;
  teams: Array<{ id: string; name: string; key: string }>;
  /** Teams in scope; null means every team (shows the Team filter). */
  scopeTeamIds: string[] | null;
  count: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [field, setField] = useState<FieldKey | null>(null);

  const options = useMemo<Record<FieldKey, ValueOption[]>>(
    () => ({
      status: statusOptions(lookups, scopeTeamIds),
      priority: [1, 2, 3, 4, 0].map((p) => ({ value: String(p), label: priorities.find((x) => x.value === p)!.label, icon: <PriorityIcon priority={p} /> })),
      assignee: [
        { value: "me", label: "Me", icon: <UserRound aria-hidden /> },
        { value: "none", label: "No assignee", icon: <UserRound aria-hidden /> },
        ...lookups.peopleList.map((p) => ({ value: p.id, label: p.name, icon: <UserAvatar name={p.name} src={p.avatarUrl} className="size-4" /> })),
      ],
      creator: [
        { value: "me", label: "Me", icon: <UserRound aria-hidden /> },
        ...lookups.peopleList.map((p) => ({ value: p.id, label: p.name, icon: <UserAvatar name={p.name} src={p.avatarUrl} className="size-4" /> })),
      ],
      labels: lookups.labelList
        .filter((l) => !scopeTeamIds || l.teamId === null || scopeTeamIds.includes(l.teamId))
        .map((l) => ({ value: l.id, label: l.name, icon: <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: l.color }} /> })),
      dueDate: dueOptions,
      team: teams.map((t) => ({ value: t.id, label: t.name, icon: <TeamMark teamKey={t.key} /> })),
    }),
    [lookups, scopeTeamIds, teams],
  );

  const fields = (Object.keys(fieldMeta) as FieldKey[]).filter((f) => f !== "team" || scopeTeamIds === null);

  function toggle(fieldKey: FieldKey, value: string) {
    if (fieldKey === "dueDate") {
      const option = dueOptions.find((o) => o.value === value)!;
      const current = selectedValues(filter, "dueDate", lookups);
      onFilter(current.includes(value) ? removeCondition(filter, "dueDate") : setCondition(filter, option.condition));
      return;
    }
    const current = selectedValues(filter, fieldKey, lookups);
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    if (next.length === 0) {
      onFilter(removeCondition(filter, fieldKey));
      return;
    }
    let condition: Condition;
    if (fieldKey === "status") {
      const ids = statusOptions(lookups, scopeTeamIds).filter((o) => next.includes(o.value)).flatMap((o) => o.ids);
      condition = { field: "status", op: "in", values: ids };
    } else if (fieldKey === "priority") condition = { field: "priority", op: "in", values: next.map(Number) };
    else if (fieldKey === "labels") condition = { field: "labels", op: "any", values: next };
    else if (fieldKey === "creator") condition = { field: "creator", op: "in", values: next };
    else if (fieldKey === "team") condition = { field: "team", op: "in", values: next };
    else condition = { field: "assignee", op: "in", values: next };
    onFilter(setCondition(filter, condition));
  }

  const chips = filter.conditions.filter((node): node is Condition => !isGroup(node) && node.field in fieldMeta);
  const otherConditions = filter.conditions.length - chips.length;

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b border-border px-4 py-1.5" role="toolbar" aria-label="View options">
      {chips.map((condition) => {
        const key = condition.field as FieldKey;
        const values = selectedValues(filter, key, lookups);
        const labels = values.map((v) => options[key].find((o) => o.value === v)?.label ?? "Unknown");
        return (
          <span key={key} className="flex h-7 items-center overflow-hidden rounded-md border border-border text-xs" data-testid="filter-chip">
            <button
              type="button"
              className="flex h-full items-center gap-1 px-2 hover:bg-surface-2"
              onClick={() => {
                setField(key);
                setMenuOpen(true);
              }}
            >
              <span className="text-muted-foreground">{fieldMeta[key].label}</span>
              {key === "labels" && condition.field === "labels" ? (condition.op === "none" ? "excludes" : "includes any of") : key === "dueDate" ? "" : values.length > 1 ? "is any of" : "is"}
              <span className="font-medium">{labels.join(", ")}</span>
            </button>
            <button
              type="button"
              aria-label={`Remove ${fieldMeta[key].label} filter`}
              className="flex h-full items-center border-l border-border px-1.5 hover:bg-surface-2"
              onClick={() => onFilter(removeCondition(filter, condition.field))}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        );
      })}
      {otherConditions > 0 && <span className="text-xs text-muted-foreground">+{otherConditions} advanced</span>}

      <Popover
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) setField(null);
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" data-testid="filter-button">
            <ListFilter aria-hidden /> {chips.length === 0 ? "Filter" : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <Command
            loop
            onKeyDown={(event) => {
              if (event.key === "Backspace" && field && !(event.target as HTMLInputElement).value) {
                event.preventDefault();
                setField(null);
              }
            }}
          >
            <CommandInput placeholder={field ? `Filter by ${fieldMeta[field].label.toLowerCase()}…` : "Filter…"} aria-label="Filter" />
            <CommandList className="max-h-72">
              <CommandEmpty>No results</CommandEmpty>
              {!field ? (
                <CommandGroup>
                  {fields.map((f) => (
                    <CommandItem key={f} value={fieldMeta[f].label} onSelect={() => setField(f)} className="h-8">
                      {fieldMeta[f].icon}
                      {fieldMeta[f].label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : (
                <CommandGroup heading={fieldMeta[field].label}>
                  {options[field].map((option) => {
                    const on = selectedValues(filter, field, lookups).includes(option.value);
                    return (
                      <CommandItem key={option.value} value={`${option.label} ${option.value}`} onSelect={() => toggle(field, option.value)} className="h-8">
                        <span aria-hidden className={cn("grid size-3.5 place-items-center rounded-[3px] border border-input text-[10px]", on && "border-primary bg-primary text-primary-foreground")}>
                          {on ? "✓" : ""}
                        </span>
                        {option.icon}
                        <span className="truncate">{option.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {chips.length > 0 && (
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => onFilter({ op: "and", conditions: [] })}>
          Clear
        </Button>
      )}

      <span className="ml-auto text-xs text-muted-foreground" aria-live="polite" data-testid="issue-count">
        {count} {count === 1 ? "issue" : "issues"}
      </span>
      <div className="flex items-center rounded-md border border-border" role="group" aria-label="Layout">
        {(["list", "board"] as const).map((layout) => (
          <Tooltip key={layout}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-pressed={display.layout === layout}
                aria-label={layout === "list" ? "List" : "Board"}
                className={cn("h-7 w-7 rounded-none", display.layout === layout && "bg-surface-3")}
                onClick={() => onDisplay({ ...display, layout })}
              >
                {layout === "list" ? <Rows3 aria-hidden /> : <Columns3 aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {layout === "list" ? "List" : "Board"} <ShortcutKeys id="toggle-layout" />
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <DisplayOptions display={display} onDisplay={onDisplay} />
    </div>
  );
}

const groupLabels: Record<GroupField, string> = { status: "Status", priority: "Priority", assignee: "Assignee", label: "Label", none: "No grouping" };
const orderLabels: Record<OrderField, string> = { manual: "Manual", priority: "Priority", updated: "Last updated", created: "Created", dueDate: "Due date", title: "Title" };
const propertyLabels: Record<Display["properties"][number], string> = {
  priority: "Priority",
  identifier: "ID",
  status: "Status",
  labels: "Labels",
  dueDate: "Due date",
  estimate: "Estimate",
  assignee: "Assignee",
  created: "Created",
  updated: "Updated",
};

function DisplayOptions({ display, onDisplay }: { display: Display; onDisplay: (display: Display) => void }) {
  const set = (patch: Partial<Display>) => onDisplay({ ...display, ...patch });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-muted-foreground">
          <SlidersHorizontal aria-hidden /> Display
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 text-sm">
        <Row label="Grouping">
          <Select value={display.groupBy} onValueChange={(v) => set({ groupBy: v as GroupField })}>
            <SelectTrigger size="sm" className="w-36" aria-label="Grouping">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(groupLabels) as GroupField[]).map((g) => (
                <SelectItem key={g} value={g}>
                  {groupLabels[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Ordering">
          <Select value={display.orderBy} onValueChange={(v) => set({ orderBy: v as OrderField })}>
            <SelectTrigger size="sm" className="w-36" aria-label="Ordering">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(orderLabels) as OrderField[]).map((o) => (
                <SelectItem key={o} value={o}>
                  {orderLabels[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Completed issues">
          <Select value={display.showCompleted} onValueChange={(v) => set({ showCompleted: v as Display["showCompleted"] })}>
            <SelectTrigger size="sm" className="w-36" aria-label="Completed issues">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="week">Past week</SelectItem>
              <SelectItem value="month">Past month</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="Show sub-issues">
          <Switch checked={display.showSubIssues} onCheckedChange={(v) => set({ showSubIssues: v })} aria-label="Show sub-issues" />
        </Row>
        <Row label="Show empty groups">
          <Switch checked={display.showEmptyGroups} onCheckedChange={(v) => set({ showEmptyGroups: v })} aria-label="Show empty groups" />
        </Row>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">Display properties</div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(propertyLabels) as Display["properties"]).map((p) => {
              const on = display.properties.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ properties: on ? display.properties.filter((x) => x !== p) : [...display.properties, p] })}
                  className={cn("rounded-md border border-border px-2 py-0.5 text-xs", on ? "bg-surface-3 text-foreground" : "text-muted-foreground")}
                >
                  {propertyLabels[p]}
                </button>
              );
            })}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => onDisplay(defaultDisplay)}>
          Reset to default
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
