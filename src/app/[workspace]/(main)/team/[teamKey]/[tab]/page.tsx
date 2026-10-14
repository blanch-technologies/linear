"use client";

import { notFound, useParams } from "next/navigation";
import { EmptyState } from "@/components/shell/empty-state";
import { teamNav } from "@/components/shell/nav";
import { useWorkspace } from "@/components/workspace/workspace-context";

export default function TeamTabPage() {
  const { teamKey, tab } = useParams<{ teamKey: string; tab: string }>();
  const { teams } = useWorkspace();
  const team = teams.find((item) => item.key === teamKey.toUpperCase());
  const item = teamNav.find((entry) => entry.segment === tab);
  if (!team || !item) notFound();
  if (!team.can.read) {
    return (
      <EmptyState
        icon={item.icon}
        title={`${team.name} is private`}
        body="Join the team to see its issues, projects, and views."
      />
    );
  }
  return <EmptyState icon={item.icon} title={`${team.name} ${item.label.toLowerCase()}`} body="This page arrives in Phase 2." />;
}
