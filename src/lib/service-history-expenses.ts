import type { Expense } from "@/lib/mock/data";
import { isTollOrViolationExpense } from "@/lib/money-rules";

/** Only hide linked expenses when their parent is already represented in this report. */
export function serviceHistoryExpenses(vehicleId: string, expenses: Expense[], reportedRepairIds: string[]) {
  const represented = new Set(reportedRepairIds);
  const rows = expenses.filter(e => e.vehicleId === vehicleId && !isTollOrViolationExpense(e)
    && !(e.maintenanceId && represented.has(e.maintenanceId)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const isRepair = (e: Expense) => /\b(repairs?|maintenance|parts|labor|mechanic|body shop|tires?|brakes?)\b/i.test(e.category);
  const repairRows = rows.filter(isRepair);
  const otherRows = rows.filter(e => !isRepair(e));
  return { rows, total: rows.reduce((sum, e) => sum + e.amount, 0), repairRows, otherRows,
    repairTotal: repairRows.reduce((sum, e) => sum + e.amount, 0),
    otherTotal: otherRows.reduce((sum, e) => sum + e.amount, 0) };
}