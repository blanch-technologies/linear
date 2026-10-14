"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation } from "convex/react";
import { CalendarDays, ChevronRight, Tag, Triangle, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { TeamMark } from "@/components/shell/team-mark";
import { UserAvatar } from "@/components/shell/user-avatar";
import { useShortcut } from "@/components/shortcuts/shortcuts-provider";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { errorMessage } from "@/lib/errors";
import { estimateScales, priorityLabel, titleMaxLength, type EstimateScale } from "@/lib/issues";
import { isEmptyDocument, parseDocument } from "@/lib/richtext";
import { AssigneePicker, DueDatePicker, EstimatePicker, LabelPicker, PriorityPicker, StatusPicker, TeamPicker } from "./pickers";
import { PriorityIcon } from "./priority-icon";
import { StatusIcon } from "./status-icon";
import { useAssignable, useTeamLabels, useTeamStates } from "./use-issue-data";

type Draft = {
  teamId: string;
  title: string;
  description: string | null;
  stateId: string | null;
  priority: number;
  assigneeId: string | null;
  labelIds: string[];
  estimate: number | null;
  dueDate: string | null;
  parentId: string | null;
};

type OpenOptions = Partial<Pick<Draft, "teamId" | "stateId" | "parentId" | "assigneeId" | "priority">>;
const ComposerContext = createContext<{ open: (options?: OpenOptions) => void }>({ open: () => {} });

/** Opens the issue composer with optional presets (team, status, parent, ...). */
export function useComposer() {
  return useContext(ComposerContext);
}

const draftKey = (workspaceId: string) => `composer-draft:${workspaceId}`;

function loadDraft(workspaceId: string): Partial<Draft> | null {
  try {
    const raw = window.localStorage.getItem(draftKey(workspaceId));
    return raw ? (JSON.parse(raw) as Partial<Draft>) : null;
  } catch {
    return null;
  }
}

function saveDraft(workspaceId: string, draft: Draft | null) {
  try {
    if (draft && (draft.title.trim() || draft.description)) window.localStorage.setItem(draftKey(workspaceId), JSON.stringify(draft));
    else window.localStorage.removeItem(draftKey(workspaceId));
  } catch {
    // Not persisted.
  }
}

const blank = (teamId: string): Draft => ({
  teamId,
  title: "",
  description: null,
  stateId: null,
  priority: 0,
  assigneeId: null,
  labelIds: [],
  estimate: null,
  dueDate: null,
  parentId: null,
});

export function ComposerProvider({ children }: { children: ReactNode }) {
  const { teams, workspace } = useWorkspace();
  const params = useParams<{ teamKey?: string }>();
  const writable = useMemo(() => teams.filter((team) => team.can.write), [teams]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const open = useCallback(
    (options: OpenOptions = {}) => {
      const routeTeam = params.teamKey ? writable.find((t) => t.key === params.teamKey!.toUpperCase()) : undefined;
      const fallback = writable.find((t) => t.teamRole !== null) ?? writable[0];
      const stored = loadDraft(workspace.id);
      const teamId = options.teamId ?? routeTeam?.id ?? (stored?.teamId && writable.some((t) => t.id === stored.teamId) ? stored.teamId : fallback?.id);
      if (!teamId) {
        toast.error("Join a team to create issues.");
        return;
      }
      const presets = Object.keys(options).length > 0;
      setDraft({ ...blank(teamId), ...(!presets && stored ? stored : {}), ...options, teamId });
    },
    [params.teamKey, writable, workspace.id],
  );

  useShortcut("create-issue", () => open());
  const value = useMemo(() => ({ open }), [open]);

  return (
    <ComposerContext.Provider value={value}>
      {children}
      {draft && (
        <Composer
          workspaceId={workspace.id}
          draft={draft}
          setDraft={setDraft}
          onClose={(keepDraft) => {
            saveDraft(workspace.id, keepDraft ? draft : null);
            setDraft(null);
          }}
        />
      )}
    </ComposerContext.Provider>
  );
}

function Pill({ children, label, ...props }: { children: ReactNode; label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Button type="button" variant="outline" size="xs" aria-label={label} className="h-7 gap-1.5 font-normal" {...props}>
      {children}
    </Button>
  );
}

function Composer({
  workspaceId,
  draft,
  setDraft,
  onClose,
}: {
  workspaceId: string;
  draft: Draft;
  setDraft: (draft: Draft | null) => void;
  onClose: (keepDraft: boolean) => void;
}) {
  const { teams, href } = useWorkspace();
  const create = useMutation(api.issues.create);
  const [createMore, setCreateMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const teamId = draft.teamId as Id<"teams">;
  const team = teams.find((t) => t.id === draft.teamId);
  const states = useTeamStates(teamId);
  const people = useAssignable(teamId);
  const labels = useTeamLabels(teamId);
  const state = states?.find((s) => s.id === draft.stateId) ?? states?.find((s) => s.category === "unstarted") ?? states?.[0];
  const assignee = people?.find((p) => p.id === draft.assigneeId);
  const chosenLabels = (labels ?? []).filter((l) => draft.labelIds.includes(l.id));
  const scale = (team?.estimateScale ?? undefined) as EstimateScale | undefined;
  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  // Persist as you type, so a closed tab or a misclick keeps the text.
  useEffect(() => {
    const timer = setTimeout(() => saveDraft(workspaceId, draft), 300);
    return () => clearTimeout(timer);
  }, [draft, workspaceId]);

  async function submit() {
    const title = draft.title.trim();
    if (!title || submitting) return;
    const description = draft.description && parseDocument(draft.description);
    setSubmitting(true);
    try {
      const result = await create({
        teamId,
        title,
        description: description && description.ok && !isEmptyDocument(description.doc) ? draft.description : undefined,
        stateId: draft.stateId ? (draft.stateId as Id<"workflowStates">) : undefined,
        priority: draft.priority,
        assigneeId: draft.assigneeId ? (draft.assigneeId as Id<"users">) : undefined,
        labelIds: draft.labelIds as Id<"labels">[],
        estimate: draft.estimate ?? undefined,
        dueDate: draft.dueDate ?? undefined,
        parentId: draft.parentId ? (draft.parentId as Id<"issues">) : undefined,
      });
      toast.success(
        <span>
          Created{" "}
          <Link className="font-medium underline underline-offset-2" href={href("issue", result.identifier)}>
            {result.identifier}
          </Link>
        </span>,
      );
      if (createMore) {
        setDraft({ ...draft, title: "", description: null });
        setEditorKey((k) => k + 1);
      } else {
        onClose(false);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(true)}>
      <DialogContent showCloseButton={false} className="top-[12%] translate-y-0 gap-0 p-0 shadow-modal sm:max-w-[760px]">
        <DialogDescription className="sr-only">Write a title and description, set properties, then create the issue.</DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-center gap-1.5 px-4 pt-4 text-sm">
            <TeamPicker
              teams={teams.filter((t) => t.can.write)}
              value={draft.teamId}
              onChange={(id) => update({ teamId: id, stateId: null, labelIds: [], assigneeId: null, estimate: null })}
              trigger={
                <Pill label={`Team: ${team?.name ?? ""}`}>
                  {team && <TeamMark teamKey={team.key} />}
                  {team?.key}
                </Pill>
              }
            />
            <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
            <DialogTitle className="text-sm font-normal">New issue</DialogTitle>
          </div>
          <div className="space-y-2 px-4 pt-3">
            <input
              aria-label="Issue title"
              placeholder="Issue title"
              value={draft.title}
              maxLength={titleMaxLength}
              autoFocus
              onChange={(event) => update({ title: event.target.value })}
              className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground"
            />
            <RichTextEditor
              key={`${draft.teamId}-${editorKey}`}
              value={draft.description}
              onChange={(json) => update({ description: json })}
              people={people ?? []}
              onSubmit={() => void submit()}
              placeholder="Add description…"
              className="max-h-[50dvh] min-h-24 overflow-y-auto pb-2"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
            <StatusPicker
              teamId={teamId}
              value={state?.id ?? null}
              onChange={(id) => update({ stateId: id })}
              trigger={
                <Pill label={`Status: ${state?.name ?? ""}`}>
                  {state && <StatusIcon category={state.category} color={state.color} />}
                  {state?.name ?? "Status"}
                </Pill>
              }
            />
            <PriorityPicker
              value={draft.priority}
              onChange={(priority) => update({ priority })}
              trigger={
                <Pill label={`Priority: ${priorityLabel(draft.priority)}`}>
                  <PriorityIcon priority={draft.priority} />
                  {draft.priority === 0 ? "Priority" : priorityLabel(draft.priority)}
                </Pill>
              }
            />
            <AssigneePicker
              teamId={teamId}
              value={draft.assigneeId}
              onChange={(id) => update({ assigneeId: id })}
              trigger={
                <Pill label={`Assignee: ${assignee?.name ?? "none"}`}>
                  {assignee ? <UserAvatar name={assignee.name} src={assignee.avatarUrl} className="size-4" /> : <UserRound aria-hidden />}
                  {assignee?.name ?? "Assignee"}
                </Pill>
              }
            />
            <LabelPicker
              teamId={teamId}
              value={draft.labelIds}
              onChange={(ids) => update({ labelIds: ids })}
              trigger={
                <Pill label={`Labels: ${chosenLabels.map((l) => l.name).join(", ") || "none"}`}>
                  {chosenLabels.length === 0 ? (
                    <>
                      <Tag aria-hidden /> Labels
                    </>
                  ) : (
                    chosenLabels.map((l) => (
                      <span key={l.id} className="flex items-center gap-1">
                        <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: l.color }} />
                        {l.name}
                      </span>
                    ))
                  )}
                </Pill>
              }
            />
            {scale && (
              <EstimatePicker
                scale={scale}
                value={draft.estimate}
                onChange={(estimate) => update({ estimate })}
                trigger={
                  <Pill label={`Estimate: ${draft.estimate ?? "none"}`}>
                    <Triangle aria-hidden />
                    {draft.estimate === null ? "Estimate" : estimateScales[scale].format(draft.estimate)}
                  </Pill>
                }
              />
            )}
            <DueDatePicker
              value={draft.dueDate}
              onChange={(dueDate) => update({ dueDate })}
              trigger={
                <Pill label={`Due date: ${draft.dueDate ?? "none"}`}>
                  <CalendarDays aria-hidden />
                  {draft.dueDate ?? "Due date"}
                </Pill>
              }
            />
          </div>
          <div className="flex items-center gap-3 border-t border-border px-4 py-3">
            <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={createMore} onCheckedChange={setCreateMore} aria-label="Create more" />
              Create more
            </label>
            <Button type="submit" size="sm" disabled={!draft.title.trim() || submitting} title="Create issue (⌘↵)">
              {submitting ? "Creating…" : "Create issue"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
