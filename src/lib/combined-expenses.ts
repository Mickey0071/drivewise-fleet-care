import { expenses, maintenance, type Expense, type Maintenance } from "@/lib/mock/data";
import { isIssueRecord, isServiceLogRecord } from "@/lib/maintenance-utils";
import { isRepairCost, repairCost, countableExpenses } from "@/lib/money-rules";

export type ExpenseSource = "operational" | "repair" | "maintenance";

/**
 * A single normalized "money out" row combining the operational expenses table
 * with completed repairs/maintenance from the maintenance module. This is the
 * single source of truth for the Expense Tracker so its totals match the
 * vehicle detail page and the P&L dashboard.
 */
export interface CombinedExpense {
  id: string;
  category: string;
  amount: number;
  date: string;
  vehicleId?: string;
  vendor?: string;
  notes?: string;
  source: ExpenseSource;
  /** Only operational rows are editable/deletable here (others live in Maintenance). */
  editable: boolean;
  /** The underlying operational expense row, when source === "operational". */
  expense?: Expense;
}

function maintenanceDate(m: Maintenance): string {
  return (m.dateCompleted || m.completionDate || m.createdAt || "").slice(0, 10);
}

function maintenanceLabel(m: Maintenance): string {
  return m.issueDescription || m.serviceType || "Maintenance";
}

/**
 * Build the combined expense list:
 * - operational expense rows (excluding auto-posted repair rows to avoid
 *   double counting a completed repair)
 * - completed repairs (labeled "Repair") and routine service logs
 *   (labeled "Maintenance"), valued with effectiveRepairCost.
 */
export function buildCombinedExpenses(): CombinedExpense[] {
  const rows: CombinedExpense[] = [];

  // Operational expenses — money-rules.countableExpenses only drops rows
  // whose parent maintenance record is actually being counted below, so
  // no dollar can fall through both sides.
  for (const e of countableExpenses(expenses, maintenance)) {
    rows.push({
      id: e.id,
      category: e.category,
      amount: e.amount,
      date: e.date,
      vehicleId: e.vehicleId,
      vendor: e.vendor,
      notes: e.notes,
      source: "operational",
      editable: true,
      expense: e,
    });
  }

  // Repairs / maintenance — the single-source predicate. A row counts the
  // moment it has a real cost, regardless of workflow status.
  for (const m of maintenance) {
    if (!isRepairCost(m)) continue;
    const amount = repairCost(m);
    const source: ExpenseSource = isIssueRecord(m)
      ? "repair"
      : isServiceLogRecord(m)
        ? "maintenance"
        : "maintenance";
    rows.push({
      id: m.id,
      category: source === "repair" ? "Repair" : "Maintenance",
      amount,
      date: maintenanceDate(m),
      vehicleId: m.vehicleId,
      vendor: m.vendor || undefined,
      notes: maintenanceLabel(m),
      source,
      editable: false,
    });
  }

  return rows;
}
