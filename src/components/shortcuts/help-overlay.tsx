"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shortcuts } from "@/lib/shortcuts";
import { ShortcutKeys } from "./shortcut-keys";

const groups = ["General", "Navigation", "Forms"] as const;

/** The keyboard shortcut reference, generated from the registry. */
export function HelpOverlay({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>More arrive with issues, lists, and boards.</DialogDescription>
        </DialogHeader>
        {groups.map((group) => (
          <section key={group} className="space-y-1">
            <h3 className="text-xs font-medium text-muted-foreground">{group}</h3>
            <ul className="divide-y divide-border">
              {shortcuts
                .filter((shortcut) => shortcut.group === group)
                .map((shortcut) => (
                  <li key={shortcut.id} className="flex items-center justify-between gap-4 py-2">
                    <span>{shortcut.description}</span>
                    <ShortcutKeys keys={shortcut.keys} />
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
