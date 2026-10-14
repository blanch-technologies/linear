/** Workflow state categories (D-27), in display order. */
export const stateCategories = ["triage", "backlog", "unstarted", "started", "completed", "canceled"] as const;
export type StateCategory = (typeof stateCategories)[number];

export const stateCategoryLabels: Record<StateCategory, string> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  canceled: "Canceled",
};

/** Categories a team's default state may use: new issues start un-begun. */
export const defaultableCategories: readonly StateCategory[] = ["backlog", "unstarted"];

/**
 * Categories every team keeps at least one state in, so issues can always be
 * started, finished, or canceled. Triage is opt-in (D-30).
 */
export const requiredCategories: readonly StateCategory[] = ["backlog", "unstarted", "started", "completed", "canceled"];

/** D-27 defaults for a new team. Colors follow the D-33 status tokens. */
export const defaultWorkflowStates: ReadonlyArray<{
  name: string;
  category: StateCategory;
  color: string;
  isDefault?: true;
}> = [
  { name: "Backlog", category: "backlog", color: "#83858e" },
  { name: "Todo", category: "unstarted", color: "#a3a5ad", isDefault: true },
  { name: "In Progress", category: "started", color: "#ebaa69" },
  { name: "In Review", category: "started", color: "#66a8e9" },
  { name: "Done", category: "completed", color: "#83bd9d" },
  { name: "Canceled", category: "canceled", color: "#777985" },
  { name: "Duplicate", category: "canceled", color: "#777985" },
];

/** Swatches offered in the state editor. */
export const stateColors = [
  "#83858e", "#a3a5ad", "#ebaa69", "#e4b560", "#66a8e9", "#8e7cf8",
  "#83bd9d", "#5cb788", "#df726f", "#777985",
] as const;

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
