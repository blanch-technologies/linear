"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/workspace-context";

/** The workspace home is My issues, as in Linear's default. */
export default function WorkspaceHome() {
  const { href } = useWorkspace();
  const router = useRouter();
  useEffect(() => router.replace(href("my-issues")), [href, router]);
  return null;
}
