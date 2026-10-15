"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { RichTextEditor, type MentionPerson } from "@/components/editor/rich-text-editor";
import { errorCode } from "@/lib/errors";
import { useUpdateIssue } from "../use-update-issue";

const saveDelayMs = 800;

/**
 * The description, saved as you type (ADR 0006). Saves carry `expectedVersion`
 * (D-21). After a conflict, once the newer issue arrives: if only other fields
 * changed, the pending save goes through on the new version; if the
 * description changed too, you choose whose to keep.
 */
export function IssueDescription({
  issue,
  people,
  editable,
}: {
  issue: { id: Id<"issues">; version: number; description: string | null };
  people: MentionPerson[];
  editable: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // The server description our unsaved draft started from.
  const [editBase, setEditBase] = useState<string | null>(null);
  // The version a refused save expected; cleared by the next save attempt.
  const [conflictAt, setConflictAt] = useState<number | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  const latest = useRef(issue);
  const sentVersion = useRef(issue.version);
  useEffect(() => {
    latest.current = issue;
  });

  const base = draft === null ? issue.description : editBase;
  const waiting = conflictAt !== null && issue.version <= conflictAt;
  const ask = conflictAt !== null && !waiting && issue.description !== base;

  const onError = useCallback((error: unknown) => {
    if (errorCode(error) !== "CONFLICT") return false;
    setConflictAt(sentVersion.current);
    return true;
  }, []);
  const update = useUpdateIssue({ onError });

  const save = useCallback(
    async (text: string) => {
      setConflictAt(null);
      const current = latest.current;
      if (text === current.description) {
        setDraft((d) => (d === text ? null : d));
        return;
      }
      sentVersion.current = current.version;
      if (await update(current, { description: text })) {
        setEditBase(text);
        setDraft((d) => (d === text ? null : d));
      }
    },
    [update],
  );

  // Debounced save of the latest draft; also the retry once a conflict is safe.
  useEffect(() => {
    if (draft === null || waiting || ask) return;
    const timer = setTimeout(() => void save(draft), saveDelayMs);
    return () => clearTimeout(timer);
  }, [draft, waiting, ask, save]);

  // Leaving the page (prev/next, Esc) mid-debounce still saves.
  const pending = useRef<{ draft: string | null; blocked: boolean; save: typeof save }>({ draft, blocked: waiting || ask, save });
  useEffect(() => {
    pending.current = { draft, blocked: waiting || ask, save };
  });
  useEffect(
    () => () => {
      const { draft: unsaved, blocked, save: flush } = pending.current;
      if (unsaved !== null && !blocked) void flush(unsaved);
    },
    [],
  );

  return (
    <div className="space-y-2">
      <RichTextEditor
        key={editorKey}
        value={draft ?? issue.description}
        editable={editable}
        people={people}
        placeholder="Add description…"
        className="min-h-24 text-[15px] leading-relaxed"
        onChange={(json) => {
          if (draft === null) setEditBase(latest.current.description);
          setDraft(json);
        }}
        onBlur={(json) => {
          if (draft !== null && !waiting && !ask) void save(json);
        }}
      />
      {ask && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
          <span className="mr-auto">Someone else edited this description while you were typing.</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(null);
              setConflictAt(null);
              setEditorKey((k) => k + 1);
            }}
          >
            Use theirs
          </Button>
          <Button size="sm" onClick={() => draft !== null && void save(draft)}>
            Keep mine
          </Button>
        </div>
      )}
    </div>
  );
}
