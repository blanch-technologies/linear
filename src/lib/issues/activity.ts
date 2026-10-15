import { priorityLabel } from "./index";

/*
 * Sentences for the issue activity timeline. Values arrive resolved to names
 * by `issues.activity` (statuses, people, labels as "A, B", issues as
 * identifiers); this only decides the wording.
 */

export type ActivityValue = string | number | null;
export type ActivityChange = { field: string; from: ActivityValue; to: ActivityValue };
export type ActivityKind = "created" | "updated" | "deleted" | "restored" | "moved";

const relationWords: Record<string, [added: string, removed: string]> = {
  blocks: ["marked this as blocking", "removed the blocking relation with"],
  blocked_by: ["marked this as blocked by", "removed the blocked-by relation with"],
  related: ["related this to", "removed the relation to"],
  duplicate: ["marked this as a duplicate of", "removed the duplicate relation with"],
};

function list(value: ActivityValue): string[] {
  return typeof value === "string" && value ? value.split(", ") : [];
}

function formatDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** One change as a phrase that follows the actor's name, or null to skip it. */
export function describeChange({ field, from, to }: ActivityChange): string | null {
  if (field.startsWith("relation:")) {
    const words = relationWords[field.slice("relation:".length)];
    if (!words) return null;
    return to !== null ? `${words[0]} ${to}` : `${words[1]} ${from ?? "an issue"}`;
  }
  switch (field) {
    case "title":
      return `changed the title to “${to}”`;
    case "description":
      return "updated the description";
    case "stateId":
      return from !== null ? `changed status from ${from} to ${to}` : `set status to ${to}`;
    case "priority":
      return Number(to) === 0 ? "removed the priority" : `set priority to ${priorityLabel(Number(to))}`;
    case "assigneeId":
      if (to === null) return from !== null ? `unassigned ${from}` : null;
      return `assigned the issue to ${to}`;
    case "labelIds": {
      const before = list(from);
      const after = list(to);
      const added = after.filter((l) => !before.includes(l));
      const removed = before.filter((l) => !after.includes(l));
      const parts = [
        added.length ? `added ${added.length === 1 ? "label" : "labels"} ${added.join(", ")}` : "",
        removed.length ? `removed ${removed.length === 1 ? "label" : "labels"} ${removed.join(", ")}` : "",
      ].filter(Boolean);
      return parts.length ? parts.join(" and ") : null;
    }
    case "estimate":
      return to === null ? "removed the estimate" : `set the estimate to ${to}`;
    case "dueDate":
      return to === null ? "removed the due date" : `set the due date to ${formatDate(String(to))}`;
    case "parentId":
      return to === null ? `removed the parent ${from ?? ""}`.trim() : `made this a sub-issue of ${to}`;
    case "teamId":
      return `moved the issue from ${from} to ${to}`;
    default:
      return null;
  }
}

/** Every phrase for one history entry. */
export function describeEntry(kind: ActivityKind, changes: ActivityChange[]): string[] {
  if (kind === "created") return ["created the issue"];
  if (kind === "deleted") return ["deleted the issue"];
  if (kind === "restored") return ["restored the issue"];
  return changes.map(describeChange).filter((phrase): phrase is string => phrase !== null);
}
