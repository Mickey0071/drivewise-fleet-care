import {
  vehicles,
  rentals,
  payments,
  expenses,
  maintenance,
  violations,
  driverById,
  type Maintenance,
} from "@/lib/mock/data";
import {
  effectiveRepairCost,
  isCompletedRepair,
  isIssueRecord,
  isAutoPostedRepairRow,
} from "@/lib/maintenance-utils";

// ---------------------------------------------------------------------------
// UNIFIED VEHICLE FINANCIAL ENGINE
// ---------------------------------------------------------------------------
// getVehicleFinancials(vehicleId) is the SINGLE source of truth for every
// money figure shown for a vehicle: the fleet card, the vehicle Analytics/P&L
// tab, the vehicle Expenses tab, the global P&L report, and printable reports.
// No screen may compute its own income/expense/net/ROI — they all call this so
// the numbers are always identical.
//
// It derives everything live from the existing records, so it is automatically
// retroactive: historical data recalculates on every render, no migration.
//
// It does NOT touch payment collection, reservation logic, or the balance
// engine (rentalCanonicalOwed / rentalTimeCharge / rentalPaymentsReceived).
// ---------------------------------------------------------------------------

export type ExpenseSource = "manual" | "repair" | "maintenance" | "violation";

export interface FinancialIncomeItem {
  id: string;
  date: string;
  renterName: string;
  amount: number;
  method?: string;
  rentalId: string;
}

export interface FinancialExpenseItem {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  source: ExpenseSource;
}

export interface VehicleFinancials {
  vehicleId: string;
  totalIncome: number;
  totalExpenses: number;
  netPnl: number;
  /** null when there are no expenses (ROI undefined). */
  roi: number | null;
  incomeLineItems: FinancialIncomeItem[];
  expenseLineItems: FinancialExpenseItem[];
  /** Expense subtotals keyed by source, for category roll-ups. */
  expenseBySource: Record<ExpenseSource, number>;
}

export interface FinancialDateRange {
  /** inclusive ISO date (YYYY-MM-DD) */
  from?: string;
  /** inclusive ISO date (YYYY-MM-DD) */
  to?: string;
}

function inRange(date: string | undefined, range?: FinancialDateRange): boolean {
  if (!range || (!range.from && !range.to)) return true;
  const d = (date ?? "").slice(0, 10);
  if (!d) return false;
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

function maintenanceDate(m: Maintenance): string {
  return (m.dateCompleted || m.completionDate || m.createdAt || "").slice(0, 10);
}

function maintenanceLabel(m: Maintenance): string {
  return m.issueDescription || m.serviceType || "Maintenance";
}

/**
 * The one true financial summary for a vehicle.
 * Pass an optional date range (used by the P&L report); omit for all-time
 * (fleet card, vehicle tab, expenses tab).
 */
export function getVehicleFinancials(
  vehicleId: string,
  range?: FinancialDateRange,
): VehicleFinancials {
  const rentalIds = new Set(
    rentals.filter((r) => r.vehicleId === vehicleId).map((r) => r.id),
  );

  // ----- INCOME: paid payments on this vehicle's rentals (exclude money-on-file credit) -----
  const incomeLineItems: FinancialIncomeItem[] = payments
    .filter(
      (p) =>
        rentalIds.has(p.rentalId) &&
        p.status === "paid" &&
        p.kind !== "credit",
    )
    .map((p) => ({
      id: p.id,
      date: (p.paidDate || p.dueDate || "").slice(0, 10),
      renterName: driverById(p.driverId)?.fullName ?? "Unknown",
      amount: Number(p.amount || 0),
      method: p.method,
      rentalId: p.rentalId,
    }))
    .filter((it) => inRange(it.date, range))
    .sort((a, b) => b.date.localeCompare(a.date));

  // ----- EXPENSES: manual + repairs/maintenance + violations -----
  const expenseLineItems: FinancialExpenseItem[] = [];

  // 1. Manual operational expenses (exclude auto-posted repair rows to avoid
  //    double-counting the maintenance record below).
  for (const e of expenses) {
    if (e.vehicleId !== vehicleId) continue;
    if (isAutoPostedRepairRow(e)) continue;
    if (!inRange(e.date, range)) continue;
    expenseLineItems.push({
      id: e.id,
      date: (e.date ?? "").slice(0, 10),
      category: e.category,
      description: e.notes || e.vendor || e.category,
      amount: Number(e.amount || 0),
      source: "manual",
    });
  }

  // 2. Completed repairs & routine maintenance, valued with effectiveRepairCost.
  for (const m of maintenance) {
    if (m.vehicleId !== vehicleId) continue;
    if (!isCompletedRepair(m)) continue;
    const date = maintenanceDate(m);
    if (!inRange(date, range)) continue;
    const amount = effectiveRepairCost(m);
    const source: ExpenseSource = isIssueRecord(m) ? "repair" : "maintenance";
    const label = maintenanceLabel(m);
    const partsTotal = Number(m.partsCost ?? m.selectedSolution?.partsCost ?? 0);
    const laborTotal = Number(m.laborCost ?? m.selectedSolution?.laborCost ?? 0);
    // Break out into Parts / Labor rows so the expense list mirrors the
    // repair breakdown. Fall back to a single lumped row when neither
    // parts nor labor was recorded (e.g. legacy rolled-up cost).
    if (partsTotal > 0 || laborTotal > 0) {
      if (partsTotal > 0) {
        expenseLineItems.push({
          id: `${m.id}::parts`,
          date,
          category: "Parts",
          description: `${label}${m.vendor ? ` · ${m.vendor}` : ""}`,
          amount: partsTotal,
          source,
        });
      }
      if (laborTotal > 0) {
        expenseLineItems.push({
          id: `${m.id}::labor`,
          date,
          category: "Labor",
          description: `${label}${m.mechanicName || m.completedBy ? ` · ${m.mechanicName || m.completedBy}` : ""}`,
          amount: laborTotal,
          source,
        });
      }
      // If the aggregate `cost` exceeded parts+labor (e.g. rounding, fees),
      // capture the remainder so totals stay identical.
      const remainder = amount - partsTotal - laborTotal;
      if (Math.abs(remainder) >= 0.01) {
        expenseLineItems.push({
          id: `${m.id}::other`,
          date,
          category: source === "repair" ? "Repair" : "Maintenance",
          description: `${label} (other)`,
          amount: remainder,
          source,
        });
      }
    } else {
      expenseLineItems.push({
        id: m.id,
        date,
        category: source === "repair" ? "Repair" : "Maintenance",
        description: label,
        amount,
        source,
      });
    }
  }

  // 3. Violations / impound charges tied to the vehicle.
  for (const x of violations) {
    if (x.vehicleId !== vehicleId) continue;
    if (!inRange(x.dateIssued, range)) continue;
    expenseLineItems.push({
      id: x.id,
      date: (x.dateIssued ?? "").slice(0, 10),
      category: "Violation",
      description: x.notes || `${x.type} charge`,
      amount: Number(x.amount || 0),
      source: "violation",
    });
  }

  expenseLineItems.sort((a, b) => b.date.localeCompare(a.date));

  const totalIncome = incomeLineItems.reduce((s, it) => s + it.amount, 0);
  const totalExpenses = expenseLineItems.reduce((s, it) => s + it.amount, 0);
  const netPnl = totalIncome - totalExpenses;
  const roi = totalExpenses > 0 ? (netPnl / totalExpenses) * 100 : null;

  const expenseBySource: Record<ExpenseSource, number> = {
    manual: 0,
    repair: 0,
    maintenance: 0,
    violation: 0,
  };
  for (const it of expenseLineItems) expenseBySource[it.source] += it.amount;

  return {
    vehicleId,
    totalIncome,
    totalExpenses,
    netPnl,
    roi,
    incomeLineItems,
    expenseLineItems,
    expenseBySource,
  };
}

/** Fleet-wide roll-up: sum of getVehicleFinancials across every vehicle. */
export function getFleetFinancials(range?: FinancialDateRange) {
  const perVehicle = vehicles.map((v) => ({
    vehicle: v,
    financials: getVehicleFinancials(v.id, range),
  }));
  const totalIncome = perVehicle.reduce((s, r) => s + r.financials.totalIncome, 0);
  const totalExpenses = perVehicle.reduce((s, r) => s + r.financials.totalExpenses, 0);
  const netPnl = totalIncome - totalExpenses;
  const roi = totalExpenses > 0 ? (netPnl / totalExpenses) * 100 : null;
  return { perVehicle, totalIncome, totalExpenses, netPnl, roi };
}
