import type { Expense } from "@/lib/mock/data";
import { isTollOrViolationExpense } from "@/lib/money-rules";

/** Only hide linked expenses when their parent is already represented in this report. */
export function serviceHistoryExpenses(vehicleId: string, expenses: Expense[], reportedRepairIds: string[]) {
  const represented = new Set(reportedRepairIds);
  const rows = expenses.filter(e => e.vehicleId === vehicleId && !isTollOrViolationExpense(e)
    && !(e.maintenanceId && represented.has(e.maintenanceId)))
    .sort((a, b) => b.date.localeCompare(a.date));
  return { rows, total: rows.reduce((sum, e) => sum + e.amount, 0) };
}