import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder with the shell's geometry, so nothing jumps when data arrives. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Loading">
      <div className="hidden w-sidebar shrink-0 space-y-3 border-r border-sidebar-border bg-sidebar p-3 nav:block">
        <Skeleton className="h-[34px] w-3/4" />
        <Skeleton className="h-7 w-full" />
        <div className="space-y-2 pt-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[22px] w-2/3" />
          ))}
        </div>
      </div>
      <div className="flex-1">
        <div className="h-header border-b border-border" />
      </div>
    </div>
  );
}
