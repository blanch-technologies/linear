"use client";

import { useState, type FormEvent } from "react";
import { notFound, useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-shell";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/errors";
import { validateName } from "@/lib/validation";

export default function WorkspaceGeneralPage() {
  const { workspace, can } = useWorkspace();
  const update = useAction(api.workspaces.update);
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [urlKey, setUrlKey] = useState(workspace.urlKey);
  const [saving, setSaving] = useState(false);
  const debouncedKey = useDebouncedValue(urlKey);
  const keyChanged = urlKey !== workspace.urlKey;
  const check = useQuery(api.workspaces.checkUrlKey, keyChanged && debouncedKey ? { urlKey: debouncedKey } : "skip");
  if (!can.manageWorkspace) notFound();

  const nameCheck = validateName(name, "Workspace name");
  const keyOk = !keyChanged || (debouncedKey === urlKey && check?.ok === true);
  const dirty = name.trim() !== workspace.name || keyChanged;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!nameCheck.ok || !keyOk || !dirty) return;
    setSaving(true);
    try {
      const result = await update({ name: nameCheck.value, urlKey });
      toast.success("Workspace updated");
      if (result.urlKey !== workspace.urlKey) router.replace(`/${result.urlKey}/settings/workspace`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsPage title="Workspace" description="The name and URL everyone in the workspace sees.">
      <SettingsSection>
        <form onSubmit={onSubmit} className="space-y-5 p-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="ws-name">Name</Label>
            <Input id="ws-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws-url">URL</Label>
            <Input
              id="ws-url"
              value={urlKey}
              onChange={(event) => setUrlKey(event.target.value.toLowerCase())}
              aria-describedby="ws-url-help"
              maxLength={32}
            />
            <p id="ws-url-help" className="text-xs text-muted-foreground" aria-live="polite">
              {keyChanged && check && !check.ok ? (
                <span className="text-destructive">{check.message}</span>
              ) : (
                "Changing the URL breaks existing links to this workspace."
              )}
            </p>
          </div>
          <Button type="submit" size="sm" disabled={!dirty || !nameCheck.ok || !keyOk || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </SettingsSection>
    </SettingsPage>
  );
}
