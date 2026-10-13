import { CreateWorkspace } from "@/components/workspace/create-workspace";
import { RequireAuth } from "@/components/workspace/require-auth";

export const metadata = { title: "Create a workspace" };

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <CreateWorkspace />
    </RequireAuth>
  );
}
