import { useSyncExternalStore } from "react";
import { rentals, vehicles, payments, drivers, inspections, type Rental, type RentalExtension, type Driver, type Inspection, type Payment } from "./data";

const listeners = new Set<() => void>();
let version = 0;
function emit() { version++; persist(); listeners.forEach(l => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }

export function useStoreVersion() {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

// ---------------------------------------------------------------------------
// Persistence layer
// Snapshots the mutable arrays into localStorage on every emit() and rehydrates
// on module load, so data survives page refreshes, re-deploys, and tab closes.
// Cross-device sync requires the database migration (next step).
// ---------------------------------------------------------------------------
const STORE_KEY = "camauto.store.v1";

function snapshot() {
  return { vehicles, drivers, rentals, payments, inspections };
}

function replaceArray<T>(target: T[], next: T[]) {
  target.splice(0, target.length, ...next);
}

let hydrated = false;
function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.vehicles) replaceArray(vehicles, data.vehicles);
    if (data.drivers) replaceArray(drivers, data.drivers);
    if (data.rentals) replaceArray(rentals, data.rentals);
    if (data.payments) replaceArray(payments, data.payments);
    if (data.inspections) replaceArray(inspections, data.inspections);
  } catch {}
}

function persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot())); } catch {}
}

/** Reset persisted store back to the seed mock data. */
export function resetStore() {
  if (typeof window !== "undefined") {
    try { localStorage.removeItem(STORE_KEY); } catch {}
  }
  // Force a reload so the seed arrays from data.ts are re-imported fresh.
  if (typeof window !== "undefined") window.location.reload();
}

hydrate();

function nextRentalId() {
  const n = rentals.reduce((m, r) => Math.max(m, parseInt(r.id.replace(/\D/g, "")) || 0), 500);
  return `R-${n + 1}`;
}
function nextPaymentId() {
  const n = payments.reduce((m, p) => Math.max(m, parseInt(p.id.replace(/\D/g, "")) || 0), 9000);
  return `P-${n + 1}`;
}

/** True if vehicle has any open (no endDate) or date-overlapping rental */
export function hasConflict(vehicleId: string, startDate: string, endDate?: string, ignoreRentalId?: string) {
  const start = new Date(startDate).getTime();
  const end = endDate ? new Date(endDate).getTime() : Infinity;
  return rentals.some(r => {
    if (r.id === ignoreRentalId) return false;
    if (r.vehicleId !== vehicleId) return false;
    const rs = new Date(r.startDate).getTime();
    const re = r.endDate ? new Date(r.endDate).getTime() : Infinity;
    return rs <= end && re >= start;
  });
}

export function addRental(input: Omit<Rental, "id" | "paymentStatus"> & { paymentStatus?: Rental["paymentStatus"] }) {
  const rental: Rental = {
    id: nextRentalId(),
    paymentStatus: "current",
    reservationStatus: "pending",
    pendingCreatedAt: new Date().toISOString(),
    paymentReceived: false,
    ...input,
  };
  rentals.push(rental);
  // Pending reservations block the vehicle on the calendar but don't flip its status
  // until activated (signature + payment).
  emit();
  return rental;
}

export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export function pendingExpiresAt(r: Rental): number | null {
  if (r.reservationStatus !== "pending" || !r.pendingCreatedAt) return null;
  return new Date(r.pendingCreatedAt).getTime() + PENDING_TTL_MS;
}

export function isPendingExpired(r: Rental): boolean {
  const exp = pendingExpiresAt(r);
  return exp !== null && Date.now() > exp;
}

/** Remove pending reservations whose 24h hold has elapsed. */
export function prunePendingReservations() {
  let changed = false;
  for (let i = rentals.length - 1; i >= 0; i--) {
    if (isPendingExpired(rentals[i])) {
      rentals.splice(i, 1);
      changed = true;
    }
  }
  if (changed) emit();
}

export function cancelReservation(id: string) {
  const idx = rentals.findIndex(r => r.id === id);
  if (idx < 0) return;
  rentals.splice(idx, 1);
  emit();
}

function tryActivate(rental: Rental) {
  if (rental.reservationStatus !== "pending") return false;
  if (!rental.signatureDataUrl || !rental.paymentReceived) return false;
  rental.reservationStatus = "active";
  rental.pendingCreatedAt = undefined;
  const v = vehicles.find(v => v.id === rental.vehicleId);
  if (v) v.status = "rented";
  // Schedule first payment one period out
  const period = rental.billingPeriod ?? "weekly";
  const due = new Date(rental.startDate);
  if (period === "daily") due.setDate(due.getDate() + 1);
  else if (period === "monthly") due.setMonth(due.getMonth() + 1);
  else due.setDate(due.getDate() + 7);
  const exists = payments.some(p => p.rentalId === rental.id);
  if (!exists) {
    payments.push({
      id: nextPaymentId(), rentalId: rental.id, driverId: rental.driverId,
      amount: rental.rate ?? rental.weeklyRate,
      dueDate: due.toISOString().slice(0, 10), status: "late",
    });
  }
  return true;
}

export function captureSignature(id: string, signatureDataUrl: string, signedBy: string, agreementVersion: string) {
  const r = rentals.find(r => r.id === id);
  if (!r) return false;
  r.signatureDataUrl = signatureDataUrl;
  r.signedAt = new Date().toISOString();
  r.signedBy = signedBy;
  r.agreementVersion = agreementVersion;
  const activated = tryActivate(r);
  emit();
  return activated;
}

export function markReservationPaid(id: string) {
  const r = rentals.find(r => r.id === id);
  if (!r) return false;
  r.paymentReceived = true;
  const activated = tryActivate(r);
  emit();
  return activated;
}

export function updateRental(id: string, patch: Partial<Rental>) {
  const r = rentals.find(r => r.id === id);
  if (!r) return;
  Object.assign(r, patch);
  emit();
}

export function markReturned(id: string, endDate?: string) {
  const r = rentals.find(r => r.id === id);
  if (!r) return;
  r.endDate = endDate || new Date().toISOString().slice(0, 10);
  const v = vehicles.find(v => v.id === r.vehicleId);
  if (v) v.status = "available";
  emit();
}

/** Compute additional periods + charge for extending a rental. */
export function computeExtensionCharge(rental: Rental, newEndDate: string): { periods: number; periodLabel: "day" | "week" | "month"; additionalAmount: number } {
  const period = rental.billingPeriod ?? "weekly";
  const periodLabel: "day" | "week" | "month" = period === "daily" ? "day" : period === "monthly" ? "month" : "week";
  const baseDate = rental.endDate ? new Date(rental.endDate) : new Date(rental.startDate);
  const end = new Date(newEndDate);
  const msDiff = end.getTime() - baseDate.getTime();
  const days = Math.max(0, Math.ceil(msDiff / 86_400_000));
  let periods = 0;
  if (period === "daily") periods = days;
  else if (period === "monthly") periods = Math.max(1, Math.ceil(days / 30));
  else periods = Math.max(1, Math.ceil(days / 7));
  const rate = rental.rate ?? rental.weeklyRate;
  return { periods, periodLabel, additionalAmount: periods * rate };
}

/** Extend a rental with a signed addendum and a billable receipt line. */
export function extendRental(
  id: string,
  newEndDate: string,
  opts?: { signatureDataUrl?: string; signedBy?: string; agreementVersion?: string },
) {
  const r = rentals.find(r => r.id === id);
  if (!r) return;
  const prev = r.endDate;
  const { periods, periodLabel, additionalAmount } = computeExtensionCharge(r, newEndDate);
  r.endDate = newEndDate;
  r.notes = [r.notes, `Extended ${prev ? `from ${prev} ` : ""}to ${newEndDate} (+${periods} ${periodLabel}${periods === 1 ? "" : "s"})`].filter(Boolean).join(" · ");

  // Create a billable receipt line for the extension charge
  let paymentId: string | undefined;
  if (additionalAmount > 0) {
    paymentId = nextPaymentId();
    payments.push({
      id: paymentId,
      rentalId: r.id,
      driverId: r.driverId,
      amount: additionalAmount,
      dueDate: newEndDate,
      status: "late",
    });
  }

  const ext: RentalExtension = {
    id: `EXT-${Date.now().toString(36).toUpperCase()}`,
    extendedAt: new Date().toISOString(),
    previousEndDate: prev,
    newEndDate,
    periods,
    periodLabel,
    additionalAmount,
    paymentId,
    signatureDataUrl: opts?.signatureDataUrl,
    signedBy: opts?.signedBy,
    agreementVersion: opts?.agreementVersion,
  };
  r.extensions = [...(r.extensions ?? []), ext];
  emit();
  return ext;
}

function nextDriverId() {
  const n = drivers.reduce((m, d) => Math.max(m, parseInt(d.id.replace(/\D/g, "")) || 0), 1000);
  return `D-${n + 1}`;
}

export function addDriver(input: Omit<Driver, "id" | "dateAdded" | "status" | "insuranceOnFile"> & Partial<Pick<Driver, "status" | "insuranceOnFile" | "dateAdded">>) {
  const driver: Driver = {
    id: nextDriverId(),
    dateAdded: new Date().toISOString().slice(0, 10),
    status: "active",
    insuranceOnFile: false,
    ...input,
  };
  drivers.push(driver);
  emit();
  return driver;
}

function nextInspectionId() {
  const n = inspections.reduce((m, i) => Math.max(m, parseInt(i.id.replace(/\D/g, "")) || 0), 400);
  return `I-${n + 1}`;
}

export function getInspectionsForRental(rentalId: string) {
  return inspections.filter(i => i.rentalId === rentalId);
}

export function addInspection(input: Omit<Inspection, "id">) {
  const insp: Inspection = { id: nextInspectionId(), ...input };
  inspections.push(insp);
  const v = vehicles.find(v => v.id === input.vehicleId);
  if (v && input.mileage) v.mileage = input.mileage;
  emit();
  return insp;
}

export function recordPayment(id: string, method: Payment["method"], paidDate?: string) {
  const p = payments.find(p => p.id === id);
  if (!p) return;
  p.status = "paid";
  p.method = method;
  p.paidDate = paidDate || new Date().toISOString().slice(0, 10);
  // Schedule next weekly payment for the rental if still active
  const rental = rentals.find(r => r.id === p.rentalId);
  if (rental && !rental.endDate) {
    const hasFuture = payments.some(x => x.rentalId === rental.id && x.status !== "paid");
    if (!hasFuture) {
      const due = new Date(p.dueDate);
      due.setDate(due.getDate() + 7);
      payments.push({
        id: nextPaymentId(),
        rentalId: rental.id,
        driverId: rental.driverId,
        amount: rental.rate ?? rental.weeklyRate,
        dueDate: due.toISOString().slice(0, 10),
        status: "late",
      });
    }
    // Refresh rental's payment status from outstanding payments
    const overdue = payments.some(x => x.rentalId === rental.id && x.status === "missed");
    const late = payments.some(x => x.rentalId === rental.id && x.status === "late");
    rental.paymentStatus = overdue ? "defaulted" : late ? "late" : "current";
  }
  emit();
}

export interface RunnerReport {
  id: string;
  runnerId: string;
  runnerName: string;
  submittedAt: string;
  totalTasks: number;
  completedTasks: number;
  items: { id: string; label: string; detail?: string; done: boolean }[];
  notes?: string;
  read?: boolean;
}

const RR_KEY = "camauto.runnerReports.v1";
function loadReports(): RunnerReport[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(RR_KEY) || "[]"); } catch { return []; }
}
function saveReports() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(RR_KEY, JSON.stringify(runnerReports)); } catch {}
}
export const runnerReports: RunnerReport[] = loadReports();

export function unreadReportCount() {
  return runnerReports.filter(r => !r.read).length;
}

export function markReportRead(id: string) {
  const r = runnerReports.find(r => r.id === id);
  if (r && !r.read) { r.read = true; saveReports(); emit(); }
}

export function markAllReportsRead() {
  let changed = false;
  runnerReports.forEach(r => { if (!r.read) { r.read = true; changed = true; } });
  if (changed) { saveReports(); emit(); }
}

export function addRunnerReport(r: Omit<RunnerReport, "id" | "submittedAt">) {
  const report: RunnerReport = {
    id: `RR-${Date.now().toString(36).toUpperCase()}`,
    submittedAt: new Date().toISOString(),
    read: false,
    ...r,
  };
  runnerReports.unshift(report);
  saveReports();
  emit();
  return report;
}
