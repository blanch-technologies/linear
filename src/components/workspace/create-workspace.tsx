"use client";

import { useState, type FormEvent } from "react";
import { useAction, useQuery } from "convex/react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspaceLogo } from "@/components/shell/workspace-logo";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useHost } from "@/hooks/use-host";
import { brand } from "@/lib/brand";
import { errorMessage } from "@/lib/errors";
import { suggestUrlKey, validateName } from "@/lib/validation";
import { switchWorkspaceUrl } from "./workspace-context";

export function CreateWorkspace() {
  const create = useAction(api.workspaces.create);
  const mine = useQuery(api.workspaces.mine);
  const { signOut } = useAuth();
  const [name, setName] = useState("");
  const [urlKey, setUrlKey] = useState("");
  const [urlEdited, setUrlEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveKey = urlEdited ? urlKey : suggestUrlKey(name);
  const debouncedKey = useDebouncedValue(effectiveKey);
  const check = useQuery(api.workspaces.checkUrlKey, debouncedKey ? { urlKey: debouncedKey } : "skip");
  const nameCheck = validateName(name, "Workspace name");
  const keyReady = debouncedKey === effectiveKey && check?.ok === true;
  const host = useHost();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!nameCheck.ok || !keyReady) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await create({ name: nameCheck.value, urlKey: effectiveKey });
      window.location.assign(switchWorkspaceUrl(result.workosOrganizationId, `/${result.urlKey}`));
    } catch (caught) {
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  const others = mine?.workspaces.filter((workspace) => !workspace.suspended) ?? [];

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Create a new workspace</h1>
          <p className="text-muted-foreground">
            Workspaces are shared environments where teams can work on projects, cycles, and issues in {brand.name}.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-border bg-card p-6" noValidate>
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              autoComplete="organization"
              maxLength={64}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-url">Workspace URL</Label>
            <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring/50">
              <span className="pl-3 text-muted-foreground select-none">{host}/</span>
              <Input
                id="workspace-url"
                value={effectiveKey}
                onChange={(event) => {
                  setUrlEdited(true);
                  setUrlKey(event.target.value.toLowerCase());
                }}
                className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
                aria-describedby="workspace-url-status"
                maxLength={32}
                required
              />
            </div>
            <p id="workspace-url-status" className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
              {effectiveKey && check && !check.ok && debouncedKey === effectiveKey ? (
                <span className="text-destructive">{check.message}</span>
              ) : keyReady ? (
                "Available"
              ) : null}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={!nameCheck.ok || !keyReady || submitting}>
            {submitting ? "Creating workspace…" : "Create workspace"}
          </Button>
        </form>

        {others.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground">Your workspaces</h2>
            <ul className="space-y-1">
              {others.map((workspace) => (
                <li key={workspace.id}>
                  <a
                    className="flex h-9 items-center gap-2.5 rounded-md px-2 hover:bg-accent"
                    href={switchWorkspaceUrl(workspace.workosOrganizationId, `/${workspace.urlKey}`)}
                  >
                    <WorkspaceLogo name={workspace.name} />
                    {workspace.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-center text-xs text-muted-foreground">
          Waiting for an invitation? Open the link in the email
          {mine?.user ? ` sent to ${mine.user.email}` : ""}, or{" "}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => signOut()}>
            log out
          </button>{" "}
          to use another account.
        </p>
      </div>
    </main>
  );
}
