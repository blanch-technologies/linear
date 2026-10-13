"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SettingsSection } from "@/components/settings/settings-shell";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { errorMessage } from "@/lib/errors";
import type { TeamVisibility } from "@/lib/permissions";
import { validateName, validateTeamKey } from "@/lib/validation";
import { useTeamDetail } from "./team-settings";
import { visibilityCopy, VisibilityLabel } from "./visibility";

const topLevel = "__top__";

export function TeamGeneralPage() {
  const team = useTeamDetail();
  const { teams, href, viewer } = useWorkspace();
  const router = useRouter();
  const update = useMutation(api.teams.update);
  const reparent = useMutation(api.teams.reparent);
  const remove = useMutation(api.teams.remove);
  const removeMember = useMutation(api.teams.removeMember);

  const [name, setName] = useState(team.name);
  const [key, setKey] = useState(team.key);
  const [description, setDescription] = useState(team.description);
  const [visibility, setVisibility] = useState<TeamVisibility>(team.visibility);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "leave" | null>(null);

  const teamId = team.id as Id<"teams">;
  const parentVisibility = teams.find((item) => item.id === team.parentId)?.visibility;
  const options: TeamVisibility[] = parentVisibility === "private" ? ["public", "private", "restricted"] : ["public", "private"];
  const nameCheck = validateName(name, "Team name");
  const keyCheck = validateTeamKey(key);
  const dirty =
    name.trim() !== team.name || key.toUpperCase() !== team.key || description.trim() !== team.description || visibility !== team.visibility;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!nameCheck.ok || !keyCheck.ok || !dirty) return;
    setSaving(true);
    try {
      await update({
        teamId,
        name: nameCheck.value,
        key: keyCheck.value !== team.key ? keyCheck.value : undefined,
        description: description.trim(),
        visibility: visibility !== team.visibility ? visibility : undefined,
      });
      toast.success("Team updated");
      if (keyCheck.value !== team.key) router.replace(href("settings", "teams", keyCheck.value));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  // Candidate parents: any other visible team that isn't inside this one.
  const descendantIds = new Set<string>();
  const walk = (id: string) =>
    teams.filter((t) => t.parentId === id).forEach((child) => {
      descendantIds.add(child.id);
      walk(child.id);
    });
  walk(team.id);
  const parentOptions = teams.filter((t) => t.id !== team.id && !descendantIds.has(t.id));

  if (!team.can.manage) {
    return (
      <SettingsSection>
        <dl className="divide-y divide-border">
          <Row label="Identifier" value={team.key} />
          <Row label="Visibility" value={<VisibilityLabel visibility={team.visibility} />} />
          <Row label="Parent" value={team.parent ? `${team.parent.name} (${team.parent.key})` : "None"} />
          {team.description && <Row label="Description" value={team.description} />}
        </dl>
        {team.can.leave && (
          <div className="border-t border-border p-4">
            <Button variant="outline" size="sm" onClick={() => setConfirm("leave")}>
              Leave team
            </Button>
          </div>
        )}
        {leaveDialog()}
      </SettingsSection>
    );
  }

  return (
    <div className="space-y-8">
      <SettingsSection>
        <form onSubmit={onSubmit} className="space-y-5 p-4" noValidate>
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor="team-name">Name</Label>
              <Input id="team-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-key">Identifier</Label>
              <Input
                id="team-key"
                value={key}
                onChange={(event) => setKey(event.target.value.toUpperCase())}
                maxLength={7}
                disabled={team.hasIssues}
                aria-describedby="team-key-help"
              />
            </div>
          </div>
          <p id="team-key-help" className="-mt-3 text-xs text-muted-foreground">
            {team.hasIssues
              ? "The identifier can't change once the team has issues, so issue IDs stay stable."
              : key && !keyCheck.ok
                ? keyCheck.message
                : "Used in issue IDs, like " + (keyCheck.ok ? keyCheck.value : team.key) + "-1."}
          </p>
          <div className="space-y-2">
            <Label htmlFor="team-description">Description</Label>
            <Textarea id="team-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Visibility</legend>
            <RadioGroup value={visibility} onValueChange={(value) => setVisibility(value as TeamVisibility)}>
              {options.map((option) => (
                <Label key={option} htmlFor={`vis-${option}`} className="flex cursor-pointer items-start gap-3 font-normal">
                  <RadioGroupItem id={`vis-${option}`} value={option} className="mt-0.5" />
                  <span>
                    <span className="block font-medium">{visibilityCopy[option].label}</span>
                    <span className="block text-xs text-muted-foreground">{visibilityCopy[option].description}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          <Button type="submit" size="sm" disabled={!dirty || saving || !nameCheck.ok || !keyCheck.ok}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </SettingsSection>

      {team.can.reparent && (
        <SettingsSection title="Parent team" description="Only admins can move a team. Every member must already be in the new parent.">
          <div className="p-4">
            <Label htmlFor="team-parent" className="sr-only">
              Parent team
            </Label>
            <Select
              value={team.parentId ?? topLevel}
              onValueChange={async (value) => {
                try {
                  await reparent({ teamId, parentId: value === topLevel ? null : (value as Id<"teams">) });
                  toast.success("Team moved");
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }}
            >
              <SelectTrigger id="team-parent" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={topLevel}>None (top level)</SelectItem>
                {parentOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name} ({option.key})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SettingsSection>
      )}

      {(team.can.leave || team.can.delete) && (
        <SettingsSection title="Danger zone">
          <div className="flex flex-wrap gap-2 p-4">
            {team.can.leave && (
              <Button variant="outline" size="sm" onClick={() => setConfirm("leave")}>
                Leave team
              </Button>
            )}
            {team.can.delete && (
              <Button variant="destructive" size="sm" onClick={() => setConfirm("delete")}>
                Delete team
              </Button>
            )}
          </div>
        </SettingsSection>
      )}
      {leaveDialog()}
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Delete ${team.name}?`}
        description="This removes the team, its members, and its workflow. Teams with issues or sub-teams can't be deleted."
        confirmLabel="Delete team"
        onConfirm={async () => {
          try {
            await remove({ teamId });
            toast.success(`${team.name} deleted`);
            router.replace(href("settings", "teams"));
            return true;
          } catch (error) {
            toast.error(errorMessage(error));
            return false;
          }
        }}
      />
    </div>
  );

  function leaveDialog() {
    return (
      <ConfirmDialog
        open={confirm === "leave"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Leave ${team.name}?`}
        description={
          team.visibility === "public"
            ? "You can join again at any time. You'll also leave its sub-teams."
            : "You'll lose access to its issues and leave its sub-teams. Someone will have to add you back."
        }
        confirmLabel="Leave team"
        onConfirm={async () => {
          try {
            await removeMember({ teamId, userId: viewer.id as Id<"users"> });
            toast.success(`You left ${team.name}`);
            return true;
          } catch (error) {
            toast.error(errorMessage(error));
            return false;
          }
        }}
      />
    );
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <dt className="w-28 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  );
}
