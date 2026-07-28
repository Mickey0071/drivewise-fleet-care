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
import { isIssueRecord } from "@/lib/maintenance-utils";
import {
  isRepairCost,
  isAutoPostedExpense,
  repairCost,
  countableExpenses,
} from "@/lib/money-rules";
import { listOtherIncome } from "@/lib/other-income";

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
  /** Vendor / mechanic / paid-to for this line, when known. Used by the
   *  repair-history CSV & PDF so every repair row lists who did the work. */
  vendor?: string;
}

export interface VehicleFinancials {
  vehicleId: string;
  totalIncome: number;
  totalExpenses: number;
  netPnl: number;
  /** null when there are no expenses (ROI undefined). */
  roi: number | null;
  /** Sum of repairCost() over every maintenance row passing isRepairCost. */
  repairs: number;
  /** Sum of amounts across countableExpenses (auto-posted rows removed). */
  expenses: number;
  /** repairs + expenses. Equal to totalExpenses; kept as a named field so
   *  downstream code can read the split explicitly. */
  grand: number;
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

  // Manually-entered "other income" for this vehicle (insurance claims,
  // cash rentals, referral bonuses, etc.). Persisted in localStorage via
  // src/lib/other-income.ts and rolled into every income tile & ROI calc.
  for (const oi of listOtherIncome(vehicleId)) {
    if (!inRange(oi.date, range)) continue;
    incomeLineItems.push({
      id: oi.id,
      date: oi.date,
      renterName: oi.source || oi.category,
      amount: Number(oi.amount || 0),
      method: oi.category,
      rentalId: "",
    });
  }
  incomeLineItems.sort((a, b) => b.date.localeCompare(a.date));

  // ----- EXPENSES: manual + repairs/maintenance + violations -----
  const expenseLineItems: FinancialExpenseItem[] = [];

  // 1. Operational expenses — countableExpenses removes any row whose
  //    maintenance_id FK points at a maintenance record (those rows are the
  //    auto-posted duplicate of the underlying repair and are counted via
  //    the maintenance loop below). See src/lib/money-rules.ts.
  const vehicleExpenses = expenses.filter(
    (e) => e.vehicleId === vehicleId && inRange(e.date, range),
  );
  for (const e of countableExpenses(vehicleExpenses, maintenance)) {
    expenseLineItems.push({
      id: e.id,
      date: (e.date ?? "").slice(0, 10),
      category: e.category,
      description: e.notes || e.vendor || e.category,
      amount: Number(e.amount || 0),
      source: "manual",
      vendor: e.vendor || undefined,
    });
  }

  // 2. Repairs — every maintenance row with a real cost, regardless of
  //    workflow status. Scheduled reminders (oil/battery/etc.) are excluded
  //    inside isRepairCost. See src/lib/money-rules.ts.
  for (const m of maintenance) {
    if (m.vehicleId !== vehicleId) continue;
    if (!isRepairCost(m)) continue;
    const date = maintenanceDate(m);
    if (!inRange(date, range)) continue;
    const amount = repairCost(m);
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
          vendor: m.vendor || m.mechanicName || m.completedBy || undefined,
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
          vendor: m.mechanicName || m.completedBy || m.vendor || undefined,
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
          vendor: m.vendor || m.mechanicName || m.completedBy || undefined,
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
        vendor: m.vendor || m.mechanicName || m.completedBy || undefined,
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

  // Explicit repair / expense split so downstream code never has to guess.
  const repairsTotal = expenseLineItems
    .filter((it) => it.source === "repair" || it.source === "maintenance")
    .reduce((s, it) => s + it.amount, 0);
  const expensesTotal = expenseLineItems
    .filter((it) => it.source === "manual" || it.source === "violation")
    .reduce((s, it) => s + it.amount, 0);

  return {
    vehicleId,
    totalIncome,
    totalExpenses,
    netPnl,
    roi,
    repairs: repairsTotal,
    expenses: expensesTotal,
    grand: repairsTotal + expensesTotal,
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
