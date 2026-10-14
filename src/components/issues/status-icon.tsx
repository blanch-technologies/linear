import type { StateCategory } from "@/lib/workflow";
import { cn } from "@/lib/utils";

/**
 * The 14px workflow-state glyph (D-33). Shape carries the category, so it reads
 * without color: dashed ring (backlog), ring (unstarted), half pie (started),
 * check (completed), cross (canceled), dotted ring (triage).
 */
export function StatusIcon({
  category,
  color,
  className,
  label,
}: {
  category: StateCategory;
  color: string;
  className?: string;
  label?: string;
}) {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none" } as const;
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  const cls = cn("shrink-0", className);
  switch (category) {
    case "triage":
      return (
        <svg {...common} {...a11y} className={cls}>
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.5" strokeDasharray="1 2" />
          <circle cx="7" cy="7" r="2" fill={color} />
        </svg>
      );
    case "backlog":
      return (
        <svg {...common} {...a11y} className={cls}>
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.5" strokeDasharray="2.6 1.8" />
        </svg>
      );
    case "unstarted":
      return (
        <svg {...common} {...a11y} className={cls}>
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.5" />
        </svg>
      );
    case "started":
      return (
        <svg {...common} {...a11y} className={cls}>
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill={color} />
        </svg>
      );
    case "completed":
      return (
        <svg {...common} {...a11y} className={cls}>
          <circle cx="7" cy="7" r="7" fill={color} />
          <path d="M4.2 7.2 6.1 9 9.8 5.2" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "canceled":
      return (
        <svg {...common} {...a11y} className={cls}>
          <circle cx="7" cy="7" r="7" fill={color} />
          <path d="m4.8 4.8 4.4 4.4m0-4.4-4.4 4.4" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}
