"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/workspace-context";

export default function MyIssuesIndex() {
  const { href } = useWorkspace();
  const router = useRouter();
  useEffect(() => router.replace(href("my-issues", "assigned")), [href, router]);
  return null;
}
