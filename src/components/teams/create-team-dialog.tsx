"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { errorMessage } from "@/lib/errors";
import type { TeamVisibility } from "@/lib/permissions";
import { suggestTeamKey, validateName, validateTeamKey } from "@/lib/validation";
import { visibilityCopy } from "./visibility";

const topLevel = "__top__";

export function CreateTeamDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { teams, href } = useWorkspace();
  const create = useMutation(api.teams.create);
  const router = useRouter();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState<string>(topLevel);
  const [visibility, setVisibility] = useState<TeamVisibility>("public");
  const [saving, setSaving] = useState(false);

  const parents = teams.filter((team) => team.can.createSubTeam);
  const parent = teams.find((team) => team.id === parentId);
  const effectiveKey = keyEdited ? key : name ? suggestTeamKey(name) : "";
  const nameCheck = validateName(name, "Team name");
  const keyCheck = validateTeamKey(effectiveKey);
  const options: TeamVisibility[] = parent?.visibility === "private" ? ["public", "private", "restricted"] : ["public", "private"];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!nameCheck.ok || !keyCheck.ok) return;
    setSaving(true);
    try {
      const result = await create({
        name: nameCheck.value,
        key: keyCheck.value,
        description: description.trim() || undefined,
        visibility,
        parentId: parent ? (parent.id as Id<"teams">) : undefined,
      });
      toast.success(`${nameCheck.value} created`);
      onOpenChange(false);
      router.push(href("settings", "teams", result.key));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Create a team</DialogTitle>
            <DialogDescription>Teams own issues, workflows, and cycles.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor="team-name">Name</Label>
              <Input id="team-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-key">Identifier</Label>
              <Input
                id="team-key"
                value={effectiveKey}
                onChange={(event) => {
                  setKeyEdited(true);
                  setKey(event.target.value.toUpperCase());
                }}
                maxLength={7}
                aria-invalid={!!effectiveKey && !keyCheck.ok}
                aria-describedby="team-key-help"
              />
            </div>
          </div>
          <p id="team-key-help" className="-mt-2 text-xs text-muted-foreground">
            {effectiveKey && !keyCheck.ok ? (
              <span className="text-destructive">{keyCheck.message}</span>
            ) : (
              `Issues will be numbered ${keyCheck.ok ? keyCheck.value : "KEY"}-1, ${keyCheck.ok ? keyCheck.value : "KEY"}-2, …`
            )}
          </p>
          <div className="space-y-2">
            <Label htmlFor="team-description">Description</Label>
            <Textarea id="team-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
          </div>
          {parents.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="team-parent">Parent team</Label>
              <Select
                value={parentId}
                onValueChange={(value) => {
                  setParentId(value);
                  if (visibility === "restricted") setVisibility("private");
                }}
              >
                <SelectTrigger id="team-parent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={topLevel}>None (top level)</SelectItem>
                  {parents.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name} ({team.key})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Visibility</legend>
            <RadioGroup value={visibility} onValueChange={(value) => setVisibility(value as TeamVisibility)}>
              {options.map((option) => (
                <Label key={option} htmlFor={`visibility-${option}`} className="flex cursor-pointer items-start gap-3 font-normal">
                  <RadioGroupItem id={`visibility-${option}`} value={option} className="mt-0.5" />
                  <span>
                    <span className="block font-medium">{visibilityCopy[option].label}</span>
                    <span className="block text-xs text-muted-foreground">{visibilityCopy[option].description}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={saving || !nameCheck.ok || !keyCheck.ok}>
              {saving ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
