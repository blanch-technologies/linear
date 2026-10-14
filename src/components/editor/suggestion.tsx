"use client";

import { forwardRef, useImperativeHandle, useState, type ReactNode } from "react";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { cn } from "@/lib/utils";

export type SuggestionItem = { id: string; label: string; icon?: ReactNode; detail?: string };

type MenuProps = { items: SuggestionItem[]; command: (item: SuggestionItem) => void; empty: string };
export type MenuHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };

/** The popup list for @, #, and / in the editor. */
export const SuggestionMenu = forwardRef<MenuHandle, MenuProps>(function SuggestionMenu({ items, command, empty }, ref) {
  const [index, setIndex] = useState(0);
  // Reset the highlight when results change.
  const [seen, setSeen] = useState(items);
  if (seen !== items) {
    setSeen(items);
    setIndex(0);
  }
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        command(items[index]!);
        return true;
      }
      return false;
    },
  }));
  return (
    <div role="listbox" aria-label="Suggestions" className="w-64 rounded-md border border-border bg-popover p-1 text-sm shadow-md">
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-muted-strong">{empty}</div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={i === index}
            onMouseDown={(event) => {
              event.preventDefault();
              command(item);
            }}
            className={cn("flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left", i === index && "bg-accent")}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
            {item.detail && <span className="ml-auto truncate text-xs text-muted-strong">{item.detail}</span>}
          </button>
        ))
      )}
    </div>
  );
});

/** Renders a SuggestionMenu next to the caret, without a positioning library. */
export function suggestionRenderer(empty: string): SuggestionOptions<SuggestionItem>["render"] {
  return () => {
    let renderer: ReactRenderer<MenuHandle, MenuProps> | null = null;
    let host: HTMLDivElement | null = null;
    const place = (props: SuggestionProps<SuggestionItem>) => {
      const rect = props.clientRect?.();
      if (!rect || !host) return;
      host.style.left = `${Math.min(rect.left, window.innerWidth - 272)}px`;
      host.style.top = `${rect.bottom + 6}px`;
    };
    return {
      onStart(props) {
        host = document.createElement("div");
        host.style.position = "fixed";
        host.style.zIndex = "100";
        document.body.appendChild(host);
        renderer = new ReactRenderer(SuggestionMenu, { props: { items: props.items, command: props.command, empty }, editor: props.editor });
        host.appendChild(renderer.element);
        place(props);
      },
      onUpdate(props) {
        renderer?.updateProps({ items: props.items, command: props.command, empty });
        place(props);
      },
      onKeyDown(props) {
        if (props.event.key === "Escape") {
          host?.remove();
          return true;
        }
        return renderer?.ref?.onKeyDown(props) ?? false;
      },
      onExit() {
        renderer?.destroy();
        host?.remove();
        renderer = null;
        host = null;
      },
    };
  };
}
