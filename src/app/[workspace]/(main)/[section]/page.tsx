"use client";

import { notFound, useParams } from "next/navigation";
import { EmptyState } from "@/components/shell/empty-state";
import { placeholderSections } from "@/components/shell/nav";
import { useWorkspace } from "@/components/workspace/workspace-context";

/** Sidebar destinations that later phases build out. */
export default function SectionPage() {
  const { section } = useParams<{ section: string }>();
  const { viewer } = useWorkspace();
  const meta = placeholderSections[section];
  if (!meta) notFound();
  // D-18: guests have no workspace-wide surfaces.
  if (viewer.role === "guest" && ["views", "initiatives", "more"].includes(section)) notFound();
  return <EmptyState icon={meta.icon} title={meta.label} body="This page arrives in a later phase." />;
}
