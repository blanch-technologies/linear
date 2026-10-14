"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PickerOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  keywords?: string[];
  /** Digit shown at the right; pressing it in the picker selects the option. */
  hotkey?: string;
  group?: string;
  description?: string;
};

/**
 * A searchable property picker (Linear's pattern): type to filter, arrows and
 * Enter to choose, digits for quick picks, Esc to close. Multi-select stays
 * open and toggles.
 */
export function OptionPicker({
  trigger,
  options,
  value,
  multiple = false,
  onSelect,
  placeholder,
  emptyText = "No results",
  open: controlledOpen,
  onOpenChange,
  align = "start",
  footer,
}: {
  trigger: ReactNode;
  options: PickerOption[];
  value: string | string[] | null;
  multiple?: boolean;
  onSelect: (value: string) => void;
  placeholder: string;
  emptyText?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "end" | "center";
  footer?: ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [search, setSearch] = useState("");
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  const groups = [...new Set(options.map((o) => o.group ?? ""))];

  function choose(optionValue: string) {
    onSelect(optionValue);
    if (!multiple) {
      setOpen(false);
      setSearch("");
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0" onClick={(event) => event.stopPropagation()}>
        <Command
          loop
          onKeyDown={(event) => {
            if (search || event.metaKey || event.ctrlKey || event.altKey) return;
            const hit = options.find((option) => option.hotkey === event.key);
            if (hit) {
              event.preventDefault();
              choose(hit.value);
            }
          }}
        >
          <CommandInput value={search} onValueChange={setSearch} placeholder={placeholder} aria-label={placeholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group || "default"} heading={group || undefined}>
                {options
                  .filter((option) => (option.group ?? "") === group)
                  .map((option) => (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.value}`}
                      keywords={option.keywords}
                      onSelect={() => choose(option.value)}
                      className="h-8"
                    >
                      {multiple && (
                        <span
                          aria-hidden
                          className={cn(
                            "grid size-3.5 place-items-center rounded-[3px] border border-input",
                            selected.has(option.value) && "border-primary bg-primary text-primary-foreground",
                          )}
                        >
                          {selected.has(option.value) && <Check className="size-2.5!" />}
                        </span>
                      )}
                      {option.icon}
                      <span className="truncate">{option.label}</span>
                      {option.description && <span className="truncate text-xs text-muted-strong">{option.description}</span>}
                      <span className="ml-auto flex items-center gap-2">
                        {!multiple && selected.has(option.value) && <Check aria-label="Selected" className="size-3.5" />}
                        {option.hotkey && <span className="text-xs text-muted-strong">{option.hotkey}</span>}
                      </span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
          {footer}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
