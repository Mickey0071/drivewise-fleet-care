// Shared task-type metadata for the Runner task system.
export const TASK_TYPES = {
  inspection: "Inspection Checklist",
  mechanic: "Mechanic Maintenance",
  routine_maintenance: "Routine Maintenance",
  transport: "Transport",
  parts: "Parts Run",
  dmv: "DMV Run",
  repo: "Repossession",
  custom: "Custom Task",
} as const;

export type TaskType = keyof typeof TASK_TYPES;

export const TASK_TYPE_KEYS = Object.keys(TASK_TYPES) as TaskType[];

export function taskTypeLabel(t: string): string {
  return (TASK_TYPES as Record<string, string>)[t] ?? t;
}

export const TASK_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  approved: "Approved",
  rejected: "Rejected",
};