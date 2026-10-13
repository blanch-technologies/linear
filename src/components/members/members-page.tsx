"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Copy, Ellipsis, MailPlus, RotateCw, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-shell";
import { UserAvatar } from "@/components/shell/user-avatar";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { errorMessage } from "@/lib/errors";
import { workspaceRoles, type WorkspaceRole } from "@/lib/permissions";
import { roleLabels } from "@/lib/roles";
import { InviteDialog } from "./invite-dialog";

type Member = FunctionReturnType<typeof api.members.list>[number];
type Invitation = FunctionReturnType<typeof api.invitations.list>[number];

type Pending =
  | { kind: "remove" | "leave" | "suspend"; member: Member }
  | { kind: "role"; member: Member; role: WorkspaceRole }
  | { kind: "revoke"; invitation: Invitation }
  | null;

export function MembersPage() {
  const { can, workspace } = useWorkspace();
  const members = useQuery(api.members.list);
  const invitations = useQuery(api.invitations.list);
  const changeRole = useAction(api.members.changeRole);
  const setSuspended = useAction(api.members.setSuspended);
  const remove = useAction(api.members.remove);
  const revoke = useAction(api.invitations.revoke);
  const resend = useAction(api.invitations.resend);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const router = useRouter();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!members || !needle) return members;
    return members.filter((m) => m.user.name.toLowerCase().includes(needle) || m.user.email.toLowerCase().includes(needle));
  }, [members, query]);

  /** Runs an action with a toast; resolves false on failure so dialogs stay open. */
  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    try {
      await action();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  }

  const confirm = confirmCopy(pending, workspace.name);

  return (
    <SettingsPage
      title={can.viewMembers ? "Members" : "Your membership"}
      description={can.viewMembers ? `Manage who has access to ${workspace.name}.` : undefined}
      actions={
        can.inviteRoles.length > 0 && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden /> Invite
          </Button>
        )
      }
    >
      {can.viewMembers && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or email"
            aria-label="Search members"
            className="pl-8"
          />
        </div>
      )}

      <SettingsSection title={can.viewMembers && members ? `${members.length} ${members.length === 1 ? "member" : "members"}` : undefined}>
        {filtered === undefined ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-muted-foreground">No members match “{query}”.</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Members">
            {filtered.map((member) => (
              <MemberRow
                key={member.membershipId}
                member={member}
                onAction={setPending}
                onReactivate={(target) =>
                  run(() => setSuspended({ membershipId: target.membershipId, suspended: false }), `${target.user.name} is active again`)
                }
              />
            ))}
          </ul>
        )}
      </SettingsSection>

      {invitations && invitations.length > 0 && (
        <SettingsSection title="Pending invitations">
          <ul className="divide-y divide-border" aria-label="Pending invitations">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center gap-3 px-4 py-2.5">
                <MailPlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{invitation.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {roleLabels[invitation.role]} ·{" "}
                    {invitation.expired ? "Expired" : `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
                  </div>
                </div>
                {invitation.can.manage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for invitation to ${invitation.email}`}>
                        <Ellipsis aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={async () => {
                          try {
                            await navigator.clipboard.writeText(invitation.acceptUrl);
                            toast.success("Invite link copied");
                          } catch {
                            toast.error("Couldn't copy the link");
                          }
                        }}
                      >
                        <Copy aria-hidden /> Copy invite link
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => run(() => resend({ invitationId: invitation.id }), "Invitation resent")}>
                        <RotateCw aria-hidden /> Resend
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setPending({ kind: "revoke", invitation })}>
                        Revoke invitation
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      {can.inviteRoles.length > 0 && (
        <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={[...can.inviteRoles]} />
      )}

      {confirm && pending && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.label}
          destructive={pending.kind !== "role"}
          onConfirm={async () => {
            switch (pending.kind) {
              case "role":
                return run(
                  () => changeRole({ membershipId: pending.member.membershipId, role: pending.role }),
                  `${pending.member.user.name} is now ${article(pending.role)} ${roleLabels[pending.role].toLowerCase()}`,
                );
              case "suspend":
                return run(() => setSuspended({ membershipId: pending.member.membershipId, suspended: true }), `${pending.member.user.name} is suspended`);
              case "remove":
                return run(() => remove({ membershipId: pending.member.membershipId }), `${pending.member.user.name} was removed`);
              case "leave": {
                const ok = await run(() => remove({ membershipId: pending.member.membershipId }), `You left ${workspace.name}`);
                // The root page moves the session to another workspace, or onboarding.
                if (ok) router.replace("/");
                return ok;
              }
              case "revoke":
                return run(() => revoke({ invitationId: pending.invitation.id }), "Invitation revoked");
            }
          }}
        />
      )}
    </SettingsPage>
  );
}

function MemberRow({
  member,
  onAction,
  onReactivate,
}: {
  member: Member;
  onAction: (pending: Pending) => void;
  onReactivate: (member: Member) => void;
}) {
  const { can: rowCan } = member;
  const manageable = rowCan.changeRoleTo.length > 0 || rowCan.suspend || rowCan.reactivate || rowCan.remove;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" data-testid="member-row">
      <UserAvatar name={member.user.name} src={member.user.avatarUrl} className="size-7" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{member.user.name}</span>
          {member.isViewer && <span className="text-xs text-muted-foreground">(you)</span>}
          {member.status === "suspended" && <Badge variant="outline">Suspended</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">{member.user.email}</div>
      </div>
      <span className="w-16 text-right text-xs text-muted-foreground">{roleLabels[member.role]}</span>
      {manageable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.user.name}`}>
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {rowCan.changeRoleTo.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Role</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={member.role}
                  onValueChange={(value) => onAction({ kind: "role", member, role: value as WorkspaceRole })}
                >
                  {workspaceRoles
                    .filter((role) => role === member.role || rowCan.changeRoleTo.includes(role))
                    .map((role) => (
                      <DropdownMenuRadioItem key={role} value={role}>
                        {roleLabels[role]}
                      </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            )}
            {rowCan.reactivate && (
              <DropdownMenuItem onSelect={() => onReactivate(member)}>
                Reactivate
              </DropdownMenuItem>
            )}
            {rowCan.suspend && <DropdownMenuItem onSelect={() => onAction({ kind: "suspend", member })}>Suspend</DropdownMenuItem>}
            {rowCan.remove && (
              <DropdownMenuItem variant="destructive" onSelect={() => onAction({ kind: member.isViewer ? "leave" : "remove", member })}>
                {member.isViewer ? "Leave workspace" : "Remove from workspace"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="size-8" aria-hidden />
      )}
    </li>
  );
}

function article(role: WorkspaceRole) {
  return role === "owner" || role === "admin" ? "an" : "a";
}

function confirmCopy(pending: Pending, workspaceName: string) {
  if (!pending) return null;
  switch (pending.kind) {
    case "role":
      return {
        title: `Make ${pending.member.user.name} ${article(pending.role)} ${roleLabels[pending.role].toLowerCase()}?`,
        description:
          pending.role === "owner"
            ? "Owners have full control of the workspace, including other owners."
            : pending.member.isViewer
              ? "You may lose access to settings you can change now."
              : `Their access changes to what ${roleLabels[pending.role].toLowerCase()}s can do.`,
        label: "Change role",
      };
    case "suspend":
      return {
        title: `Suspend ${pending.member.user.name}?`,
        description: "They lose access immediately. Their work stays, and you can reactivate them later.",
        label: "Suspend",
      };
    case "remove":
      return {
        title: `Remove ${pending.member.user.name}?`,
        description: `They lose access to ${workspaceName} and leave all its teams. Their work stays.`,
        label: "Remove",
      };
    case "leave":
      return {
        title: `Leave ${workspaceName}?`,
        description: "You lose access until someone invites you again.",
        label: "Leave workspace",
      };
    case "revoke":
      return {
        title: `Revoke the invitation to ${pending.invitation.email}?`,
        description: "The link in their email stops working.",
        label: "Revoke",
      };
  }
}

