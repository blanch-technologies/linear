"use client";

import { notFound, useParams, useSearchParams } from "next/navigation";
import type { Id } from "@convex/_generated/dataModel";
import { EmptyState } from "@/components/shell/empty-state";
import { IssueView } from "@/components/issues/view/issue-view";
import { ViewTabs } from "@/components/issues/view/view-tabs";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { Filter } from "@/lib/filters";

const tabs = {
  all: { label: "All issues", filter: { op: "and", conditions: [] } },
  active: { label: "Active", filter: { op: "and", conditions: [{ field: "statusCategory", op: "in", values: ["unstarted", "started"] }] } },
  backlog: { label: "Backlog", filter: { op: "and", conditions: [{ field: "statusCategory", op: "in", values: ["backlog"] }] } },
} satisfies Record<string, { label: string; filter: Filter }>;

export default function TeamIssuesPage() {
  const { teamKey } = useParams<{ teamKey: string }>();
  const tab = (useSearchParams().get("tab") ?? "all") as keyof typeof tabs;
  const { teams, href } = useWorkspace();
  const team = teams.find((t) => t.key === teamKey.toUpperCase());
  if (!team || !(tab in tabs)) notFound();
  if (!team.can.read) return <EmptyState title={`${team.name} is private`} body="Join the team to see its issues." />;
  const base = href("team", team.key, "issues");
  return (
    <IssueView
      key={`${team.id}:${tab}`}
      source={{ kind: "team", teamId: team.id as Id<"teams"> }}
      viewKey={`team:${team.id}:${tab}`}
      baseFilter={tabs[tab].filter}
      scopeTeamId={team.id}
      header={
        <ViewTabs
          current={tab}
          tabs={Object.entries(tabs).map(([key, t]) => ({ key, label: t.label, href: key === "all" ? base : `${base}?tab=${key}` }))}
        />
      }
    />
  );
}
