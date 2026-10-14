"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Ellipsis, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SettingsSection } from "@/components/settings/settings-shell";
import { UserAvatar } from "@/components/shell/user-avatar";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { errorMessage } from "@/lib/errors";
import { useTeamDetail } from "./team-settings";

export function TeamMembersPage() {
  const team = useTeamDetail();
  const { viewer, can } = useWorkspace();
  const addMember = useMutation(api.teams.addMember);
  const removeMember = useMutation(api.teams.removeMember);
  const setRole = useMutation(api.teams.setMemberRole);
  // The workspace directory feeds the picker; guests can't see it and can't manage teams anyway.
  const directory = useQuery(api.members.list, team.can.manage && can.viewMembers ? {} : "skip");
  const [pickerOpen, setPickerOpen] = useState(false);
  const teamId = team.id as Id<"teams">;

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const memberIds = new Set(team.members.map((member) => member.user.id));
  const candidates = (directory ?? []).filter((member) => member.status === "active" && !memberIds.has(member.user.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-muted-foreground">
          {team.members.length} {team.members.length === 1 ? "member" : "members"}
        </p>
        {team.can.join && (
          <Button size="sm" variant="secondary" onClick={() => run(() => addMember({ teamId, userId: viewer.id as Id<"users"> }), `You joined ${team.name}`)}>
            Join team
          </Button>
        )}
        {team.can.manage && can.viewMembers && (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button size="sm">
                <UserPlus aria-hidden /> Add member
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              <Command>
                <CommandInput placeholder="Search people…" aria-label="Search people" />
                <CommandList>
                  <CommandEmpty>{directory === undefined ? "Loading…" : "Everyone is already in this team."}</CommandEmpty>
                  <CommandGroup>
                    {candidates.map((member) => (
                      <CommandItem
                        key={member.user.id}
                        value={`${member.user.name} ${member.user.email}`}
                        onSelect={() => {
                          setPickerOpen(false);
                          void run(
                            () => addMember({ teamId, userId: member.user.id as Id<"users"> }),
                            `${member.user.name} added to ${team.name}`,
                          );
                        }}
                      >
                        <UserAvatar name={member.user.name} src={member.user.avatarUrl} />
                        <span className="truncate">{member.user.name}</span>
                        <span className="ml-auto truncate text-xs text-muted-foreground">{member.user.email}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>

      <SettingsSection>
        {team.members.length === 0 ? (
          <p className="p-4 text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Team members">
            {team.members.map((member) => {
              const canRemove = team.can.manage || member.isViewer;
              return (
                <li key={member.user.id} className="flex items-center gap-3 px-4 py-2.5" data-testid="team-member-row">
                  <UserAvatar name={member.user.name} src={member.user.avatarUrl} className="size-7" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {member.user.name} {member.isViewer && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{member.user.email}</div>
                  </div>
                  <span className="text-xs text-muted-foreground">{member.role === "owner" ? "Team owner" : "Member"}</span>
                  {canRemove ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.user.name}`}>
                          <Ellipsis aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {team.can.manage && (
                          <>
                            {(["owner", "member"] as const).map((role) => (
                              <DropdownMenuItem
                                key={role}
                                onSelect={() =>
                                  role !== member.role &&
                                  run(
                                    () => setRole({ teamId, userId: member.user.id as Id<"users">, role }),
                                    `${member.user.name} is now ${role === "owner" ? "a team owner" : "a member"}`,
                                  )
                                }
                              >
                                {role === "owner" ? "Team owner" : "Member"}
                                {member.role === role && <Check className="ml-auto" aria-label="Current role" />}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            run(
                              () => removeMember({ teamId, userId: member.user.id as Id<"users"> }),
                              member.isViewer ? `You left ${team.name}` : `${member.user.name} removed from ${team.name}`,
                            )
                          }
                        >
                          {member.isViewer ? "Leave team" : "Remove from team"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="size-8" aria-hidden />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>
      {team.parent && (
        <p className="text-xs text-muted-foreground">
          Members of {team.name} must also be in {team.parent.name}. Removing someone from {team.name} also removes them from its sub-teams.
        </p>
      )}
    </div>
  );
}
