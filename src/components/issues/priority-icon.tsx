import { cn } from "@/lib/utils";
import { priorityLabel } from "@/lib/issues";

/** Linear-style priority glyph: urgent badge, 1-3 bars, or a dash for none. */
export function PriorityIcon({ priority, className, label = false }: { priority: number; className?: string; label?: boolean }) {
  const a11y = label ? { role: "img" as const, "aria-label": priorityLabel(priority) } : { "aria-hidden": true as const };
  if (priority === 1) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className={cn("shrink-0", className)} {...a11y}>
        <rect width="14" height="14" rx="3" fill="#df726f" />
        <path d="M7 3.5v4.2M7 10.1v.4" stroke="var(--background)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (priority === 0) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className={cn("shrink-0 text-muted-foreground", className)} {...a11y}>
        {[2, 6, 10].map((x) => (
          <rect key={x} x={x} y="6.25" width="2" height="1.5" rx="0.5" fill="currentColor" />
        ))}
      </svg>
    );
  }
  const active = priority === 2 ? 3 : priority === 3 ? 2 : 1;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className={cn("shrink-0 text-foreground", className)} {...a11y}>
      {[0, 1, 2].map((index) => (
        <rect
          key={index}
          x={1.5 + index * 4}
          y={9 - index * 3}
          width="3"
          height={4 + index * 3}
          rx="1"
          fill="currentColor"
          opacity={index < active ? 1 : 0.3}
        />
      ))}
    </svg>
  );
}
