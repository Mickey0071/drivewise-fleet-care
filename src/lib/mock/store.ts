import { useSyncExternalStore } from "react";
import { rentals, vehicles, payments, type Rental } from "./data";

const listeners = new Set<() => void>();
let version = 0;
function emit() { version++; listeners.forEach(l => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }

export function useStoreVersion() {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

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
  const rental: Rental = { id: nextRentalId(), paymentStatus: "current", ...input };
  rentals.push(rental);
  // Schedule first payment one week out
  const due = new Date(input.startDate);
  due.setDate(due.getDate() + 7);
  payments.push({
    id: nextPaymentId(), rentalId: rental.id, driverId: input.driverId,
    amount: input.weeklyRate, dueDate: due.toISOString().slice(0, 10), status: "late",
  });
  const v = vehicles.find(v => v.id === input.vehicleId);
  if (v) v.status = "rented";
  emit();
  return rental;
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
