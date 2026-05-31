import type { Maintenance } from "@/lib/mock/data";
import type { Vehicle } from "@/lib/mock/data";

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

// Most recent completed routine service for a vehicle.
export function lastServiceFor(list: Maintenance[], vehicleId: string): Maintenance | undefined {
  return list
    .filter((m) => m.vehicleId === vehicleId && isServiceLogRecord(m))
    .sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""))[0];
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