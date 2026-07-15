import type { Maintenance } from "@/lib/mock/data";
import type { Vehicle, ScheduledTaskKey } from "@/lib/mock/data";

// Issue tickets (repairs) are created via AddIssueDialog, which writes an
// "Issue opened" marker as the first notes line. Everything else is treated
// as routine service-log maintenance (logged via LogServiceDialog).
export function isIssueRecord(m: Maintenance): boolean {
  if (!m.dateCompleted) return true; // open tickets are always issues
  const notes = m.notes ?? "";
  return notes.includes("Issue opened") || notes.includes("Resolved ");
}

export function isServiceLogRecord(m: Maintenance): boolean {
  return !!m.dateCompleted && !isIssueRecord(m);
}

// ---------------------------------------------------------------------------
// Repair ticket title / reported-issue helpers.
//
// Chain: Reported Issue (symptom) → Diagnosis (becomes the title) → repair work.
// Once a diagnosis exists it becomes the ticket's display title everywhere; the
// original reported issue is preserved separately. Falls back to the reported
// issue (then serviceType) when no diagnosis has been entered yet.
// ---------------------------------------------------------------------------

/** The reported symptom the ticket was opened with. */
export function repairReportedIssue(m: Maintenance): string {
  return (m.issueDescription ?? m.serviceType ?? "").trim();
}

/** Display title: the diagnosis when present, otherwise the reported issue. */
export function repairDisplayTitle(m: Maintenance): string {
  const diag = (m.diagnosisTitle ?? "").trim();
  if (diag) return diag;
  const sol = (m.selectedSolution?.name ?? "").trim();
  if (sol) return sol;
  return repairReportedIssue(m) || "Repair";
}

/** Small linked indicator for split tickets, e.g. "1 of 2 from original issue". */
export function repairSplitLabel(m: Maintenance): string | null {
  if (m.splitTotal && m.splitTotal > 1 && m.splitIndex) {
    return `${m.splitIndex} of ${m.splitTotal} from original issue`;
  }
  return null;
}

// Effective cost for a maintenance/repair row. Prefer the explicit `cost`,
// but fall back to parts + labor when `cost` was never rolled up (null/zero).
// Use this everywhere a repair cost is displayed or summed so totals stay
// consistent across the fleet card, P&L, and repair history views.
export function effectiveRepairCost(m: Maintenance): number {
  const cost = Number(m.cost) || 0;
  if (cost > 0) return cost;
  const parts = Number(m.partsCost ?? m.selectedSolution?.partsCost) || 0;
  const labor = Number(m.laborCost ?? m.selectedSolution?.laborCost) || 0;
  return parts + labor;
}

// A repair is "completed" once it has a completion date or status. Use this
// everywhere completed repair costs are summed so totals stay consistent.
export function isCompletedRepair(m: Maintenance): boolean {
  return m.status === "complete" || !!m.dateCompleted;
}

// When a repair is completed its cost auto-posts into the expense ledger
// (notes like "Repair <id> completed …"). Those rows must be excluded from
// operational-expense sums so the repair is only counted once via the
// maintenance table's effectiveRepairCost. Single source of truth shared by
// the vehicle detail page and the P&L dashboard.
export function isAutoPostedRepairRow(e: { maintenanceId?: string; notes?: string | null }): boolean {
  return !!e.maintenanceId && /Repair\s+.*\bcompleted\b/i.test(e.notes ?? "");
}

// Most recent completed routine service for a vehicle.
export function lastServiceFor(list: Maintenance[], vehicleId: string): Maintenance | undefined {
  return list
    .filter((m) => m.vehicleId === vehicleId && isServiceLogRecord(m))
    .sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""))[0];
}

// ---------------------------------------------------------------------------
// Open maintenance issue (repair ticket) helpers — used to block rentals.
// ---------------------------------------------------------------------------

/** The most recent OPEN (incomplete) maintenance issue for a vehicle, if any. */
export function openIssueFor(list: Maintenance[], vehicleId: string): Maintenance | undefined {
  return list
    .filter((m) => m.vehicleId === vehicleId && !m.dateCompleted)
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id))[0];
}

export interface OpenIssueSummary {
  issue: string;
  vendor: string;
  downPayment?: string;
  balance?: string;
  estimatedReturn?: string;
}

function matchLine(notes: string, label: string): string | undefined {
  const re = new RegExp(`${label}\\s*:\\s*(.+)`, "i");
  const m = notes.match(re);
  return m ? m[1].trim() : undefined;
}

/** Parse the human-readable issue details out of a maintenance ticket. */
export function summarizeOpenIssue(m: Maintenance): OpenIssueSummary {
  const notes = m.notes ?? "";
  return {
    issue: m.serviceType || "Maintenance issue",
    vendor: (m.vendor && m.vendor.trim()) || "—",
    downPayment: matchLine(notes, "Down payment"),
    balance: matchLine(notes, "Balance"),
    estimatedReturn: matchLine(notes, "Estimated return"),
  };
}

// ---------------------------------------------------------------------------
// Red-alert system for overdue / upcoming maintenance.
// ---------------------------------------------------------------------------

export interface VehicleAlert {
  key: string;
  /** Short headline, e.g. "Oil Change Due". */
  label: string;
  /** Detail string, e.g. "500 miles remaining" or "expired May 15, 2026". */
  detail: string;
  /** true = past due (red), false = upcoming warning (amber). */
  overdue: boolean;
}

const MS_DAY = 86_400_000;
const OIL_MILES_WARN = 500; // miles remaining threshold to surface alert
const OIL_DAYS_WARN = 15; // days remaining threshold (time-based oil change)
const REGISTRATION_LEAD_DAYS = 10; // alert this many days before expiration

function parseDay(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / MS_DAY);
}
function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function addYears(d: Date, n: number): Date {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}
function fmtShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Compute all active maintenance alerts for a vehicle as of `now`. */
export function computeVehicleAlerts(v: Vehicle, now: Date = new Date()): VehicleAlert[] {
  const alerts: VehicleAlert[] = [];
  const s = v.maintenanceSettings ?? {};
  const today = startOfDay(now);

  // --- Oil change ---
  if (s.oilChange && s.oilChange.interval > 0) {
    const oc = s.oilChange;
    if (oc.mode === "miles" && oc.lastMileage != null) {
      const dueAt = oc.lastMileage + oc.interval;
      const remaining = dueAt - v.mileage;
      if (remaining <= OIL_MILES_WARN) {
        alerts.push({
          key: "oil",
          label: "Oil Change Due",
          detail: remaining < 0
            ? `overdue ${Math.abs(remaining).toLocaleString()} miles`
            : `${remaining.toLocaleString()} miles remaining`,
          overdue: remaining <= 0,
        });
      }
    } else if (oc.mode === "months") {
      const last = parseDay(oc.lastDate);
      if (last) {
        const due = addMonths(last, oc.interval);
        const daysLeft = daysBetween(due, today);
        if (daysLeft <= OIL_DAYS_WARN) {
          alerts.push({
            key: "oil",
            label: "Oil Change Due",
            detail: daysLeft < 0
              ? `overdue ${Math.abs(daysLeft)} days`
              : `${daysLeft} days remaining`,
            overdue: daysLeft <= 0,
          });
        }
      }
    }
  }

  // --- Inspection (alert ON expiration date) ---
  const insp = parseDay(s.inspectionExpiry);
  if (insp && daysBetween(insp, today) <= 0) {
    alerts.push({
      key: "inspection",
      label: "Inspection Overdue",
      detail: `expired ${fmtShort(insp)}`,
      overdue: true,
    });
  }

  // --- Registration (alert 10 days before expiration) ---
  const reg = parseDay(v.registrationExpiry);
  if (reg) {
    const daysLeft = daysBetween(reg, today);
    if (daysLeft <= REGISTRATION_LEAD_DAYS) {
      alerts.push({
        key: "registration",
        label: "Registration Alert",
        detail: daysLeft < 0
          ? `expired ${Math.abs(daysLeft)} days ago`
          : daysLeft === 0
            ? "expires today"
            : `expires in ${daysLeft} days`,
        overdue: daysLeft <= 0,
      });
    }
  }

  // --- Battery check (annual) ---
  const batt = parseDay(s.batteryLastDone);
  if (batt) {
    const due = addYears(batt, 1);
    const overdueDays = daysBetween(today, due);
    if (overdueDays >= 0) {
      alerts.push({
        key: "battery",
        label: "Battery Check Due",
        detail: `overdue ${overdueDays} days`,
        overdue: true,
      });
    }
  }

  // --- Alternator check (annual) ---
  const alt = parseDay(s.alternatorLastDone);
  if (alt) {
    const due = addYears(alt, 1);
    const overdueDays = daysBetween(today, due);
    if (overdueDays >= 0) {
      alerts.push({
        key: "alternator",
        label: "Alternator Check Due",
        detail: `overdue ${overdueDays} days`,
        overdue: true,
      });
    }
  }

  // --- Custom alerts ---
  for (const c of s.customAlerts ?? []) {
    const last = parseDay(c.lastDate);
    if (!last || !(c.intervalDays > 0)) continue;
    const due = new Date(last.getTime() + c.intervalDays * MS_DAY);
    const daysLeft = daysBetween(due, today);
    if (daysLeft <= 0) {
      alerts.push({
        key: `custom-${c.id}`,
        label: c.label || "Custom Alert",
        detail: `overdue ${Math.abs(daysLeft)} days`,
        overdue: true,
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Scheduled maintenance configuration.
// ---------------------------------------------------------------------------

/** Tasks required before a vehicle's schedule counts as "fully configured". */
export const REQUIRED_SCHEDULED_TASKS: ScheduledTaskKey[] = ["oil", "battery", "alternator"];

/**
 * A scheduled maintenance schedule is considered fully configured when every
 * required task is enabled and has a "last done" date recorded.
 */
export function isScheduleConfigured(v: Vehicle): boolean {
  const tasks = v.maintenanceSettings?.scheduledTasks;
  if (!tasks) return false;
  return REQUIRED_SCHEDULED_TASKS.every((k) => {
    const t = tasks[k];
    return !!t && t.enabled && !!t.lastDone;
  });
}

// ---------------------------------------------------------------------------
// Scheduled maintenance items (dashboard) — derived from per-vehicle Alert
// Settings. "Due soon" = overdue, OR within 7 days, OR within 100 miles.
// ---------------------------------------------------------------------------

export type ScheduledType =
  | "oil"
  | "battery"
  | "alternator"
  | "inspection"
  | "tires"
  | "brakes"
  | "alignment"
  | "custom";
export type ScheduledStatus = "overdue" | "due_soon" | "upcoming";

/** Dashboard "due soon" thresholds (distinct from the Fleet badge thresholds). */
export const SCHEDULED_DAYS_SOON = 7;
export const SCHEDULED_MILES_SOON = 500;

export interface ScheduledItem {
  key: string;
  vehicleId: string;
  type: ScheduledType;
  /** Original custom-alert id (only set when type === "custom"). */
  customId?: string;
  label: string;
  dueDate?: string;
  dueMileage?: number;
  milesRemaining?: number;
  daysRemaining?: number;
  status: ScheduledStatus;
  /** True when the vehicle has no last-done recorded for this item yet. */
  unconfigured?: boolean;
}

function classify(daysRemaining?: number, milesRemaining?: number): ScheduledStatus {
  const overdue =
    (daysRemaining != null && daysRemaining < 0) ||
    (milesRemaining != null && milesRemaining < 0);
  if (overdue) return "overdue";
  const soon =
    (daysRemaining != null && daysRemaining <= SCHEDULED_DAYS_SOON) ||
    (milesRemaining != null && milesRemaining <= SCHEDULED_MILES_SOON);
  return soon ? "due_soon" : "upcoming";
}

/** All scheduled maintenance items for a vehicle, regardless of urgency. */
export function computeScheduledItems(v: Vehicle, now: Date = new Date()): ScheduledItem[] {
  const items: ScheduledItem[] = [];
  const s = v.maintenanceSettings ?? {};
  const today = startOfDay(now);

  // --- Oil change ---
  if (s.oilChange && s.oilChange.interval > 0) {
    const oc = s.oilChange;
    if (oc.mode === "miles" && oc.lastMileage != null) {
      const dueMileage = oc.lastMileage + oc.interval;
      const milesRemaining = dueMileage - v.mileage;
      items.push({
        key: `${v.id}-oil`, vehicleId: v.id, type: "oil", label: "Oil Change",
        dueMileage, milesRemaining, status: classify(undefined, milesRemaining),
      });
    } else if (oc.mode === "months") {
      const last = parseDay(oc.lastDate);
      if (last) {
        const due = addMonths(last, oc.interval);
        const daysRemaining = daysBetween(due, today);
        items.push({
          key: `${v.id}-oil`, vehicleId: v.id, type: "oil", label: "Oil Change",
          dueDate: due.toISOString().slice(0, 10), daysRemaining,
          status: classify(daysRemaining),
        });
      }
    }
  }

  // --- Battery (annual) ---
  const batt = parseDay(s.batteryLastDone);
  if (batt) {
    const due = addYears(batt, 1);
    const daysRemaining = daysBetween(due, today);
    items.push({
      key: `${v.id}-battery`, vehicleId: v.id, type: "battery", label: "Battery Test",
      dueDate: due.toISOString().slice(0, 10), daysRemaining, status: classify(daysRemaining),
    });
  }

  // --- Alternator (annual) ---
  const alt = parseDay(s.alternatorLastDone);
  if (alt) {
    const due = addYears(alt, 1);
    const daysRemaining = daysBetween(due, today);
    items.push({
      key: `${v.id}-alternator`, vehicleId: v.id, type: "alternator", label: "Alternator Test",
      dueDate: due.toISOString().slice(0, 10), daysRemaining, status: classify(daysRemaining),
    });
  }

  // --- Inspection (expiry date) ---
  const insp = parseDay(s.inspectionExpiry);
  if (insp) {
    const daysRemaining = daysBetween(insp, today);
    items.push({
      key: `${v.id}-inspection`, vehicleId: v.id, type: "inspection", label: "Inspection",
      dueDate: insp.toISOString().slice(0, 10), daysRemaining, status: classify(daysRemaining),
    });
  }

  // --- Custom alerts ---
  for (const c of s.customAlerts ?? []) {
    const last = parseDay(c.lastDate);
    if (!last || !(c.intervalDays > 0)) continue;
    const due = new Date(last.getTime() + c.intervalDays * MS_DAY);
    const daysRemaining = daysBetween(due, today);
    items.push({
      key: `${v.id}-custom-${c.id}`, vehicleId: v.id, type: "custom", customId: c.id,
      label: c.label || "Custom Alert", dueDate: due.toISOString().slice(0, 10),
      daysRemaining, status: classify(daysRemaining),
    });
  }

  return items;
}

// Default intervals for the fixed maintenance items when the vehicle doesn't
// have per-item overrides configured yet.
const TIRES_DEFAULT_MILES = 5000;
const TIRES_DEFAULT_MONTHS = 6;
const BRAKES_DEFAULT_MONTHS = 12;
const ALIGNMENT_DEFAULT_MONTHS = 6;

/** All six default maintenance items for a vehicle, filling gaps with defaults.
 *  Never mutates the passed vehicle. Used by the fleet-wide overview so that
 *  every vehicle shows every column even if the admin hasn't opened the
 *  Maintenance Settings dialog yet. */
export function computeAllFixedItems(v: Vehicle, now: Date = new Date()): ScheduledItem[] {
  const base = computeScheduledItems(v, now);
  const s = v.maintenanceSettings ?? {};
  const today = startOfDay(now);
  const by = new Map<ScheduledType, ScheduledItem>();
  for (const it of base) if (it.type !== "custom") by.set(it.type, it);

  // Tires
  if (!by.has("tires")) {
    const lastMileage = s.tiresLastMileage;
    const last = parseDay(s.tiresLastDone);
    const intervalMiles = s.tiresIntervalMiles ?? TIRES_DEFAULT_MILES;
    const intervalMonths = s.tiresIntervalMonths ?? TIRES_DEFAULT_MONTHS;
    let milesRemaining: number | undefined;
    let daysRemaining: number | undefined;
    let dueDate: string | undefined;
    let dueMileage: number | undefined;
    if (lastMileage != null) {
      dueMileage = lastMileage + intervalMiles;
      milesRemaining = dueMileage - v.mileage;
    }
    if (last) {
      const due = addMonths(last, intervalMonths);
      dueDate = due.toISOString().slice(0, 10);
      daysRemaining = daysBetween(due, today);
    }
    if (last || lastMileage != null) {
      by.set("tires", {
        key: `${v.id}-tires`, vehicleId: v.id, type: "tires", label: "Tire Rotation",
        dueDate, dueMileage, milesRemaining, daysRemaining,
        status: classify(daysRemaining, milesRemaining),
      });
    }
  }

  // Brakes
  if (!by.has("brakes")) {
    const last = parseDay(s.brakesLastDone);
    if (last) {
      const intervalMonths = s.brakesIntervalMonths ?? BRAKES_DEFAULT_MONTHS;
      const due = addMonths(last, intervalMonths);
      const daysRemaining = daysBetween(due, today);
      by.set("brakes", {
        key: `${v.id}-brakes`, vehicleId: v.id, type: "brakes", label: "Brakes",
        dueDate: due.toISOString().slice(0, 10), daysRemaining,
        status: classify(daysRemaining),
      });
    }
  }

  // Alignment
  if (!by.has("alignment")) {
    const last = parseDay(s.alignmentLastDone);
    if (last) {
      const intervalMonths = s.alignmentIntervalMonths ?? ALIGNMENT_DEFAULT_MONTHS;
      const due = addMonths(last, intervalMonths);
      const daysRemaining = daysBetween(due, today);
      by.set("alignment", {
        key: `${v.id}-alignment`, vehicleId: v.id, type: "alignment", label: "Alignment",
        dueDate: due.toISOString().slice(0, 10), daysRemaining,
        status: classify(daysRemaining),
      });
    }
  }

  return Array.from(by.values()).concat(base.filter(it => it.type === "custom"));
}

/** Fixed columns for the fleet-wide overview, in display order. */
export const FLEET_ITEM_TYPES: { type: ScheduledType; label: string }[] = [
  { type: "oil", label: "Oil Change" },
  { type: "tires", label: "Tires" },
  { type: "inspection", label: "NJ Inspection" },
  { type: "battery", label: "Battery" },
  { type: "brakes", label: "Brakes" },
  { type: "alignment", label: "Alignment" },
];

/** Scheduled items that are overdue or due soon, most urgent first. */
export function dueSoonScheduledItems(list: Vehicle[], now: Date = new Date()): ScheduledItem[] {
  return list
    .flatMap((v) => computeScheduledItems(v, now))
    .filter((it) => it.status !== "upcoming")
    .sort((a, b) => urgencyScore(a) - urgencyScore(b));
}

function urgencyScore(it: ScheduledItem): number {
  // Lower = more urgent. Combine days and miles into a single ordering.
  const byDays = it.daysRemaining ?? Number.POSITIVE_INFINITY;
  const byMiles = it.milesRemaining != null ? it.milesRemaining / 14 : Number.POSITIVE_INFINITY;
  return Math.min(byDays, byMiles);
}

/** Human-readable "remaining" string for a scheduled item. */
export function scheduledRemainingLabel(it: ScheduledItem): string {
  if (it.milesRemaining != null) {
    return it.milesRemaining < 0
      ? `overdue ${Math.abs(it.milesRemaining).toLocaleString()} mi`
      : `${it.milesRemaining.toLocaleString()} mi left`;
  }
  if (it.daysRemaining != null) {
    return it.daysRemaining < 0
      ? `overdue ${Math.abs(it.daysRemaining)} days`
      : it.daysRemaining === 0
        ? "due today"
        : `${it.daysRemaining} days left`;
  }
  return "—";
}