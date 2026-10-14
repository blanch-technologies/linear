"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Mention from "@tiptap/extension-mention";
import { UserAvatar } from "@/components/shell/user-avatar";
import { safeUrl } from "@/lib/richtext";
import { cn } from "@/lib/utils";
import { suggestionRenderer, type SuggestionItem } from "./suggestion";

export type MentionPerson = { id: string; name: string; email: string; avatarUrl: string | null };

function parse(value: string | null | undefined) {
  if (!value) return "";
  try {
    return JSON.parse(value);
  } catch {
    return "";
  }
}

/**
 * The block editor for descriptions and comments (ADR 0006). Emits ProseMirror
 * JSON. Markdown shortcuts come from StarterKit's input rules; @ mentions
 * people who can read the issue (passed in by the caller).
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = "Add description…",
  people = [],
  autoFocus = false,
  onSubmit,
  editable = true,
  className,
  ariaLabel = "Description",
  onBlur,
}: {
  value: string | null | undefined;
  onChange?: (json: string) => void;
  placeholder?: string;
  people?: MentionPerson[];
  autoFocus?: boolean;
  onSubmit?: () => void;
  editable?: boolean;
  className?: string;
  ariaLabel?: string;
  onBlur?: (json: string) => void;
}) {
  // Extensions are created once; the latest people and handlers live in refs.
  const peopleRef = useRef(people);
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    peopleRef.current = people;
    submitRef.current = onSubmit;
  });

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    autofocus: autoFocus ? "end" : false,
    content: parse(value),
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          isAllowedUri: (url) => safeUrl(url),
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // TipTap calls these callbacks on keystrokes, never during render, so
      // reading refs inside them is safe; the compiler can't see through configure().
      // eslint-disable-next-line react-hooks/refs
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        renderText: ({ node }) => `@${node.attrs.label ?? ""}`,
        suggestion: {
          char: "@",
          items: ({ query }): SuggestionItem[] =>
            peopleRef.current
              .filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 8)
              .map((p) => ({ id: p.id, label: p.name, detail: p.email, icon: <UserAvatar name={p.name} src={p.avatarUrl} className="size-4" /> })),
          render: suggestionRenderer("No one matches"),
        },
      }),
    ],
    editorProps: {
      attributes: { "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true", class: "outline-none" },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && submitRef.current) {
          event.preventDefault();
          submitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => onChange?.(JSON.stringify(e.getJSON())),
    onBlur: ({ editor: e }) => onBlur?.(JSON.stringify(e.getJSON())),
  });

  // Follow outside changes (another person's edit) when not focused.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const next = parse(value);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next || { type: "doc", content: [{ type: "paragraph" }] })) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, value]);

  return <EditorContent editor={editor} className={cn("rich-text", className)} />;
}

export function isEditorEmpty(editor: Editor | null) {
  return !editor || editor.isEmpty;
}
