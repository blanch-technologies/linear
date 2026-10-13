"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/workspace-context";

export default function SettingsIndex() {
  const { href } = useWorkspace();
  const router = useRouter();
  useEffect(() => router.replace(href("settings", "preferences")), [href, router]);
  return null;
}
