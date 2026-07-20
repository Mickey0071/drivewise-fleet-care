// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH FOR MONEY MATH
// ---------------------------------------------------------------------------
// Every repair/expense total in the app must go through the four helpers
// exported below. Nothing else in the codebase is allowed to independently
// decide whether a row counts, or how much a repair is worth.
//
// Two invariants:
//   1. A cost is a cost the moment it exists. We do NOT gate on status.
//      A maintenance row with a non-zero cost / parts_cost / labor_cost is
//      a real repair, whether it is diagnosing, pending_complete, or
//      complete. The only exclusion is routine "scheduled" reminders
//      (oil change, battery test, etc.) which live in a different bucket.
//   2. An auto-posted expense (one whose maintenance_id points back at a
//      maintenance row) is identified by that FK — never by matching note
//      text. The old regex looked for the word "completed" but the accept
//      path writes "approved", so the dedupe silently never fired.
// ---------------------------------------------------------------------------

/** Keywords that mark a maintenance row as a routine scheduled reminder
 *  (not a real repair with a price attached). Case-insensitive substring
 *  match against issueDescription + serviceType. */
export const SCHEDULED_KEYWORDS = [
  "oil",
  "battery",
  "alternator",
  "inspection",
  "scheduled",
  "tire rotation",
  "alignment",
];

/** Shape we accept — supports both the camelCase Maintenance interface used
 *  in the app and the snake_case rows that come straight from Supabase. */
type MaintenanceLike = {
  cost?: number | null;
  partsCost?: number | null;
  laborCost?: number | null;
  parts_cost?: number | null;
  labor_cost?: number | null;
  issueDescription?: string | null;
  serviceType?: string | null;
  issue_description?: string | null;
  service_type?: string | null;
};

type ExpenseLike = {
  maintenanceId?: string | null;
  maintenance_id?: string | null;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function repairLabel(m: MaintenanceLike): string {
  const issue = m.issueDescription ?? m.issue_description ?? "";
  const svc = m.serviceType ?? m.service_type ?? "";
  return `${issue} ${svc}`.toLowerCase();
}

function isScheduledReminder(m: MaintenanceLike): boolean {
  const label = repairLabel(m);
  if (!label.trim()) return false;
  return SCHEDULED_KEYWORDS.some((k) => label.includes(k));
}

/**
 * The single authoritative amount for one maintenance/repair row.
 *
 * Precedence (never sum both paths):
 *   1. If `cost` is > 0, use it.
 *   2. Otherwise fall back to `parts_cost + labor_cost`.
 *
 * Returns 0 for empty rows.
 */
export function repairCost(m: MaintenanceLike): number {
  const cost = num(m.cost);
  if (cost > 0) return cost;
  const parts = num(m.partsCost ?? m.parts_cost);
  const labor = num(m.laborCost ?? m.labor_cost);
  return parts + labor;
}

/**
 * TRUE when this maintenance row represents money spent on a repair.
 * A row counts the moment it has a non-zero cost, regardless of its
 * workflow status. Scheduled reminders (oil, battery, etc.) are excluded
 * because they don't carry real repair pricing.
 */
export function isRepairCost(m: MaintenanceLike): boolean {
  if (repairCost(m) <= 0) return false;
  if (isScheduledReminder(m)) return false;
  return true;
}

/**
 * TRUE when an expense row was auto-posted from the Accept-a-repair flow
 * (i.e. its maintenance_id FK is populated). These rows are duplicates of
 * the underlying maintenance row and must be filtered out of any expense
 * total so we don't double count. Identity is determined by the FK alone —
 * never by matching text in `notes`, which is what caused the previous bug.
 */
export function isAutoPostedExpense(e: ExpenseLike): boolean {
  const id = e.maintenanceId ?? e.maintenance_id;
  return typeof id === "string" && id.trim().length > 0;
}

/** All expenses that should be summed into the operational expense total. */
export function countableExpenses<T extends ExpenseLike>(rows: T[]): T[] {
  return rows.filter((r) => !isAutoPostedExpense(r));
}
