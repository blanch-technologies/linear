import { notFound } from "next/navigation";
import { EmptyState } from "@/components/shell/empty-state";
import { placeholderSections } from "@/components/shell/nav";

// Placeholder for sidebar destinations that later phases build out.
export function generateStaticParams() {
  return placeholderSections.map((section) => ({ section }));
}

export default async function NotBuiltYetPage({ params }: PageProps<"/[section]">) {
  const { section } = await params;
  if (!placeholderSections.includes(section)) notFound();
  return <EmptyState title="Not built yet" body="This page arrives in a later phase." />;
}
