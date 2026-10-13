import { Suspense } from "react";
import { RequireAuth } from "@/components/workspace/require-auth";
import { ShellSkeleton } from "@/components/workspace/shell-skeleton";
import { WorkspaceGate } from "@/components/workspace/workspace-gate";

// The workspace comes from the URL, so it's only known at request time: the
// gate reads it inside Suspense (Cache Components).
export default function WorkspaceLayout({ children }: LayoutProps<"/[workspace]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <RequireAuth>
        <WorkspaceGate>{children}</WorkspaceGate>
      </RequireAuth>
    </Suspense>
  );
}
