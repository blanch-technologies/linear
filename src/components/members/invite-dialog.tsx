"use client";

import { useState, type FormEvent } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import type { WorkspaceRole } from "@/lib/permissions";
import { roleDescriptions, roleLabels } from "@/lib/roles";
import { validateEmail } from "@/lib/validation";

/** Splits "a@x.com, b@y.com\nc@z.com" into addresses. */
export function parseEmails(input: string): string[] {
  return [...new Set(input.split(/[\s,;]+/).map((part) => part.trim().toLowerCase()).filter(Boolean))];
}

export function InviteDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: WorkspaceRole[];
}) {
  const send = useAction(api.invitations.send);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<WorkspaceRole>(roles.includes("member") ? "member" : roles[0]!);
  const [sending, setSending] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const addresses = parseEmails(emails);
  const invalid = addresses.filter((address) => !validateEmail(address).ok);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (addresses.length === 0 || invalid.length > 0) return;
    setSending(true);
    const failures: string[] = [];
    const sent: string[] = [];
    // One at a time: WorkOS rate limits, and each result is reported.
    for (const email of addresses) {
      try {
        await send({ email, role });
        sent.push(email);
      } catch (error) {
        failures.push(`${email}: ${errorMessage(error)}`);
      }
    }
    setSending(false);
    if (sent.length > 0) toast.success(sent.length === 1 ? `Invitation sent to ${sent[0]}` : `${sent.length} invitations sent`);
    setProblems(failures);
    if (failures.length === 0) {
      setEmails("");
      onOpenChange(false);
    } else {
      setEmails(failures.map((line) => line.split(":")[0]).join("\n"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Invite to workspace</DialogTitle>
            <DialogDescription>They&apos;ll get an email with a link to join.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="invite-emails">Email addresses</Label>
            <Textarea
              id="invite-emails"
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              placeholder="name@company.com, another@company.com"
              aria-describedby="invite-emails-help"
              aria-invalid={invalid.length > 0}
              rows={3}
              autoFocus
            />
            <p id="invite-emails-help" className="text-xs text-muted-foreground">
              {invalid.length > 0 ? (
                <span className="text-destructive">Not valid: {invalid.join(", ")}</span>
              ) : (
                "Separate addresses with commas or new lines."
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as WorkspaceRole)}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((option) => (
                  <SelectItem key={option} value={option}>
                    {roleLabels[option]}
                    <span className="text-xs text-muted-foreground">{roleDescriptions[option]}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {problems.length > 0 && (
            <ul role="alert" className="space-y-1 text-sm text-destructive">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="submit" disabled={sending || addresses.length === 0 || invalid.length > 0}>
              {sending ? "Sending…" : addresses.length > 1 ? `Send ${addresses.length} invitations` : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
