import { Suspense } from "react";
import { RequireAuth } from "@/components/workspace/require-auth";
import { RootRedirect } from "@/components/workspace/root-redirect";
import { ShellSkeleton } from "@/components/workspace/shell-skeleton";

export default function RootPage() {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <RequireAuth>
        <RootRedirect />
      </RequireAuth>
    </Suspense>
  );
}
