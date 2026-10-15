"use client";

import { useParams } from "next/navigation";
import { IssuePage } from "@/components/issues/page/issue-page";

export default function IssueRoute() {
  const { identifier } = useParams<{ identifier: string }>();
  // Keyed so prev/next starts each issue fresh (picker state, title draft).
  return <IssuePage key={identifier} identifier={decodeURIComponent(identifier)} />;
}
