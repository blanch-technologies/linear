"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-shell";
import { TeamMark } from "@/components/shell/team-mark";
import { useWorkspace, type TeamSummary } from "@/components/workspace/workspace-context";
import { errorMessage } from "@/lib/errors";
import { CreateTeamDialog } from "./create-team-dialog";
import { VisibilityLabel } from "./visibility";

/** Parents before children, each child indented under its parent. */
function ordered(teams: TeamSummary[]): Array<TeamSummary & { depth: number }> {
  const ids = new Set(teams.map((team) => team.id));
  const out: Array<TeamSummary & { depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const team of teams.filter((t) => (parentId === null ? !t.parentId || !ids.has(t.parentId) : t.parentId === parentId))) {
      out.push({ ...team, depth });
      if (depth < 5) visit(team.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

export function TeamsListPage() {
  const { teams, can, href, viewer } = useWorkspace();
  const addMember = useMutation(api.teams.addMember);
  const [createOpen, setCreateOpen] = useState(false);

  async function join(team: TeamSummary) {
    try {
      await addMember({ teamId: team.id as Id<"teams">, userId: viewer.id as Id<"users"> });
      toast.success(`You joined ${team.name}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <SettingsPage
      title="Teams"
      description="Teams you can see in this workspace."
      actions={
        can.createTeam && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden /> Create team
          </Button>
        )
      }
    >
      <SettingsSection>
        {teams.length === 0 ? (
          <p className="p-4 text-muted-foreground">No teams you can see yet.</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Teams">
            {ordered(teams).map((team) => (
              <li key={team.id} className="flex items-center gap-3 px-4 py-2.5" data-testid="team-row">
                <div className="flex min-w-0 flex-1 items-center gap-2.5" style={{ paddingLeft: team.depth * 20 }}>
                  <TeamMark teamKey={team.key} />
                  <Link href={href("settings", "teams", team.key)} className="truncate font-medium hover:underline">
                    {team.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">{team.key}</span>
                </div>
                <VisibilityLabel visibility={team.visibility} />
                <div className="w-20 text-right">
                  {team.teamRole ? (
                    <span className="text-xs text-muted-foreground">{team.teamRole === "owner" ? "Owner" : "Member"}</span>
                  ) : team.can.join ? (
                    <Button size="xs" variant="secondary" onClick={() => join(team)} aria-label={`Join ${team.name}`}>
                      Join
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
      {can.createTeam && <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </SettingsPage>
  );
}
