import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

type IssueResult = NonNullable<FunctionReturnType<typeof api.issues.get>>;

/** The issue page's data: a readable, not-deleted issue. */
export type IssueDetail = Extract<IssueResult, { deleted: false }>;

/** Rail pickers that keyboard shortcuts can open. */
export type RailPicker = "status" | "priority" | "assignee" | "labels" | "estimate" | "dueDate" | "team" | "parent";
