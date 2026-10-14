"use client";

import { useEffect } from "react";
import { GateMessage } from "@/components/workspace/workspace-gate";
import { errorCode, errorMessage } from "@/lib/errors";

/** Access lost mid-session (removed, suspended) or an unexpected failure. */
export default function WorkspaceError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!errorCode(error)) console.error(error);
  }, [error]);
  const code = errorCode(error);
  const title = code === "FORBIDDEN" || code === "NO_WORKSPACE" ? "You no longer have access" : "Something went wrong";
  return <GateMessage title={title}>{errorMessage(error, "Reload the page to try again.")}</GateMessage>;
}
