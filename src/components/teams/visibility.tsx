import { Globe, Lock, LockKeyhole } from "lucide-react";
import type { TeamVisibility } from "@/lib/permissions";

export const visibilityCopy: Record<TeamVisibility, { label: string; description: string; icon: typeof Globe }> = {
  public: { label: "Public", description: "Anyone in the workspace except guests can see and join.", icon: Globe },
  private: { label: "Private", description: "Only members see its issues. Admins can see it exists and join.", icon: Lock },
  restricted: {
    label: "Restricted",
    description: "Visible to members of the private parent team, who can join.",
    icon: LockKeyhole,
  },
};

export function VisibilityLabel({ visibility }: { visibility: TeamVisibility }) {
  const { label, icon: Icon } = visibilityCopy[visibility];
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3.5" aria-hidden /> {label}
    </span>
  );
}
