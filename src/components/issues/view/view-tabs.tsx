"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/** Page tabs above a view (All / Active / Backlog, My issues tabs). */
export function ViewTabs({ tabs, current }: { tabs: Array<{ key: string; label: string; href: string }>; current: string }) {
  return (
    <nav aria-label="Views" className="flex h-10 items-center gap-1 border-b border-border px-4">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={cn(
            "rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            tab.key === current && "bg-surface-3 text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
