import { cn } from "@/lib/utils";

/** Stable color per team key. Each passes 4.5:1 against the white letter. */
const palette = ["#6553e0", "#277a50", "#96650f", "#2f73bd", "#c4423f", "#8b4fb8", "#a85a1c"];

export function teamColor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
}

export function TeamMark({ teamKey, className }: { teamKey: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid size-[15px] shrink-0 place-items-center rounded-[4px] text-[9px] font-bold text-white", className)}
      style={{ backgroundColor: teamColor(teamKey) }}
    >
      {teamKey[0]}
    </span>
  );
}
