"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Ellipsis, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIcon } from "@/components/issues/status-icon";
import { SettingsSection } from "@/components/settings/settings-shell";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { validateName } from "@/lib/validation";
import {
  defaultableCategories,
  requiredCategories,
  stateCategories,
  stateCategoryLabels,
  stateColors,
  type StateCategory,
} from "@/lib/workflow";
import { useTeamDetail } from "./team-settings";

type State = FunctionReturnType<typeof api.workflowStates.list>["states"][number];
type Editing = { mode: "create"; category: StateCategory } | { mode: "edit"; state: State } | null;

const categoryDefaults: Record<StateCategory, string> = {
  triage: "#8e7cf8",
  backlog: "#83858e",
  unstarted: "#a3a5ad",
  started: "#ebaa69",
  completed: "#83bd9d",
  canceled: "#777985",
};

export function WorkflowPage() {
  const team = useTeamDetail();
  const teamId = team.id as Id<"teams">;
  const data = useQuery(api.workflowStates.list, { teamId });
  const move = useMutation(api.workflowStates.move);
  const setDefault = useMutation(api.workflowStates.setDefault);
  const remove = useMutation(api.workflowStates.remove);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<State | null>(null);
  const [replacement, setReplacement] = useState<string>("");

  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  }

  if (data === undefined) return <Skeleton className="h-64 w-full" />;
  const { states, defaultStateId, canManage } = data;
  const categories = stateCategories.filter((category) => category !== "triage" || states.some((s) => s.category === "triage"));

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Statuses define how issues move through {team.name}&apos;s workflow. New issues start in the default status.
      </p>
      {categories.map((category) => {
        const group = states.filter((state) => state.category === category);
        return (
          <SettingsSection key={category}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
              <h2 className="flex-1 text-xs font-medium text-muted-foreground">{stateCategoryLabels[category]}</h2>
              {canManage && category !== "triage" && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Add a ${stateCategoryLabels[category].toLowerCase()} status`}
                  onClick={() => setEditing({ mode: "create", category })}
                >
                  <Plus aria-hidden />
                </Button>
              )}
            </div>
            <ul className="divide-y divide-border" aria-label={`${stateCategoryLabels[category]} statuses`}>
              {group.map((state, index) => {
                const isDefault = state.id === defaultStateId;
                const lastRequired = requiredCategories.includes(category) && group.length === 1;
                return (
                  <li key={state.id} className="flex items-center gap-3 px-4 py-2" data-testid="state-row">
                    <StatusIcon category={state.category} color={state.color} />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{state.name}</span>
                      {state.description && <span className="ml-2 text-xs text-muted-foreground">{state.description}</span>}
                    </div>
                    {isDefault && <Badge variant="secondary">Default</Badge>}
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${state.name}`}>
                            <Ellipsis aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing({ mode: "edit", state })}>Edit</DropdownMenuItem>
                          {!isDefault && defaultableCategories.includes(category) && (
                            <DropdownMenuItem onSelect={() => run(() => setDefault({ stateId: state.id }), `${state.name} is the default status`)}>
                              Make default
                            </DropdownMenuItem>
                          )}
                          {index > 0 && (
                            <DropdownMenuItem onSelect={() => run(() => move({ stateId: state.id, beforeStateId: group[index - 1]!.id }))}>
                              Move up
                            </DropdownMenuItem>
                          )}
                          {index < group.length - 1 && (
                            <DropdownMenuItem
                              onSelect={() => run(() => move({ stateId: state.id, beforeStateId: group[index + 2]?.id }))}
                            >
                              Move down
                            </DropdownMenuItem>
                          )}
                          {!isDefault && !lastRequired && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => {
                                  setReplacement("");
                                  setDeleting(state);
                                }}
                              >
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          </SettingsSection>
        );
      })}

      {editing && (
        <StateEditor
          key={editing.mode === "edit" ? editing.state.id : editing.category}
          teamId={teamId}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting.name}?`}
          description={
            deleting.hasIssues ? (
              <span className="block space-y-3">
                <span className="block">Issues in this status move to the one you choose.</span>
                <Select value={replacement} onValueChange={setReplacement}>
                  <SelectTrigger aria-label="Move issues to" className="w-full">
                    <SelectValue placeholder="Move issues to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {states
                      .filter((state) => state.id !== deleting.id)
                      .map((state) => (
                        <SelectItem key={state.id} value={state.id}>
                          <StatusIcon category={state.category} color={state.color} /> {state.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </span>
            ) : (
              "No issues use this status."
            )
          }
          confirmLabel="Delete status"
          onConfirm={async () => {
            if (deleting.hasIssues && !replacement) {
              toast.error("Choose where its issues should go.");
              return false;
            }
            return run(
              () =>
                remove({
                  stateId: deleting.id,
                  replacementStateId: replacement ? (replacement as Id<"workflowStates">) : undefined,
                }),
              `${deleting.name} deleted`,
            );
          }}
        />
      )}
    </div>
  );
}

function StateEditor({ teamId, editing, onClose }: { teamId: Id<"teams">; editing: NonNullable<Editing>; onClose: () => void }) {
  const create = useMutation(api.workflowStates.create);
  const update = useMutation(api.workflowStates.update);
  const initial = editing.mode === "edit" ? editing.state : null;
  const category = editing.mode === "edit" ? editing.state.category : editing.category;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? categoryDefaults[category]);
  const [saving, setSaving] = useState(false);
  const nameCheck = validateName(name, "Status name");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!nameCheck.ok) return;
    setSaving(true);
    try {
      if (initial) await update({ stateId: initial.id, name: nameCheck.value, description, color });
      else await create({ teamId, category, name: nameCheck.value, description, color });
      toast.success(initial ? "Status updated" : `${nameCheck.value} added`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{initial ? `Edit ${initial.name}` : `New ${stateCategoryLabels[category].toLowerCase()} status`}</DialogTitle>
            <DialogDescription>{stateCategoryLabels[category]} category</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="state-name">Name</Label>
            <div className="flex items-center gap-2">
              <StatusIcon category={category} color={color} />
              <Input id="state-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} autoFocus />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="state-description">Description</Label>
            <Input id="state-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Color</legend>
            <div className="flex flex-wrap gap-2">
              {stateColors.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={swatch}
                  aria-pressed={color === swatch}
                  onClick={() => setColor(swatch)}
                  className={cn(
                    "size-6 rounded-full border-2 border-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    color === swatch && "border-foreground",
                  )}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={saving || !nameCheck.ok}>
              {saving ? "Saving…" : initial ? "Save" : "Add status"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
