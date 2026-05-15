import { useSyncExternalStore } from "react";
import { rentals, vehicles, payments, drivers, inspections, maintenance, expenses, type Rental, type RentalExtension, type Driver, type Inspection, type Payment, type Maintenance, type Expense } from "./data";
import { supabase } from "@/integrations/supabase/client";

const listeners = new Set<() => void>();
let version = 0;
function emit() { version++; listeners.forEach(l => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }

export function useStoreVersion() {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

// ---------------------------------------------------------------------------
// Cloud persistence layer
// All mutations mirror to Supabase; remote changes flow back through realtime
// channels. The in-memory arrays remain the single source of truth for
// components — they're hydrated from the cloud on first import.
// ---------------------------------------------------------------------------
function replaceArray<T>(target: T[], next: T[]) {
  target.splice(0, target.length, ...next);
}

// ---- row <-> camelCase mappers ----
const fromVehicle = (r: any) => ({
  id: r.id, make: r.make, model: r.model, year: r.year, vin: r.vin,
  plate: r.plate, mileage: r.mileage, status: r.status, riskTier: r.risk_tier,
  dailyRate: Number(r.daily_rate), weeklyRate: Number(r.weekly_rate),
  notes: r.notes ?? undefined, nextServiceDue: r.next_service_due ?? undefined,
  imageUrl: r.image_url ?? undefined,
});
const toVehicle = (v: any) => ({
  id: v.id, make: v.make, model: v.model, year: v.year, vin: v.vin,
  plate: v.plate, mileage: v.mileage, status: v.status, risk_tier: v.riskTier,
  daily_rate: v.dailyRate, weekly_rate: v.weeklyRate,
  notes: v.notes ?? null, next_service_due: v.nextServiceDue ?? null,
  image_url: v.imageUrl ?? null,
});
const fromDriver = (r: any) => ({
  id: r.id, fullName: r.full_name, phone: r.phone, email: r.email,
  licenseNumber: r.license_number, licenseExpiry: r.license_expiry,
  insuranceOnFile: r.insurance_on_file, rideshare: r.rideshare,
  status: r.status, dateAdded: r.date_added,
});
const toDriver = (d: any) => ({
  id: d.id, full_name: d.fullName, phone: d.phone, email: d.email,
  license_number: d.licenseNumber, license_expiry: d.licenseExpiry,
  insurance_on_file: d.insuranceOnFile, rideshare: d.rideshare,
  status: d.status, date_added: d.dateAdded,
});
const fromRental = (r: any, exts: any[] = []): Rental => ({
  id: r.id, vehicleId: r.vehicle_id, driverId: r.driver_id,
  startDate: r.start_date, endDate: r.end_date ?? undefined,
  weeklyRate: Number(r.weekly_rate), depositPaid: Number(r.deposit_paid),
  paymentStatus: r.payment_status, notes: r.notes ?? undefined,
  billingPeriod: r.billing_period ?? undefined,
  rate: r.rate != null ? Number(r.rate) : undefined,
  signatureDataUrl: r.signature_data_url ?? undefined,
  signedAt: r.signed_at ?? undefined, signedBy: r.signed_by ?? undefined,
  agreementVersion: r.agreement_version ?? undefined,
  reservationStatus: r.reservation_status ?? undefined,
  pendingCreatedAt: r.pending_created_at ?? undefined,
  paymentReceived: !!r.payment_received,
  extensions: exts.filter(e => e.rental_id === r.id).map(fromExt),
});
const toRental = (r: any) => ({
  id: r.id, vehicle_id: r.vehicleId, driver_id: r.driverId,
  start_date: r.startDate, end_date: r.endDate ?? null,
  weekly_rate: r.weeklyRate, deposit_paid: r.depositPaid,
  payment_status: r.paymentStatus, notes: r.notes ?? null,
  billing_period: r.billingPeriod ?? null, rate: r.rate ?? null,
  signature_data_url: r.signatureDataUrl ?? null,
  signed_at: r.signedAt ?? null, signed_by: r.signedBy ?? null,
  agreement_version: r.agreementVersion ?? null,
  reservation_status: r.reservationStatus ?? null,
  pending_created_at: r.pendingCreatedAt ?? null,
  payment_received: !!r.paymentReceived,
});
const fromExt = (r: any): RentalExtension => ({
  id: r.id, extendedAt: r.extended_at, previousEndDate: r.previous_end_date ?? undefined,
  newEndDate: r.new_end_date, periods: r.periods, periodLabel: r.period_label,
  additionalAmount: Number(r.additional_amount), paymentId: r.payment_id ?? undefined,
  signatureDataUrl: r.signature_data_url ?? undefined, signedBy: r.signed_by ?? undefined,
  agreementVersion: r.agreement_version ?? undefined,
});
const toExt = (rentalId: string, e: RentalExtension) => ({
  id: e.id, rental_id: rentalId, extended_at: e.extendedAt,
  previous_end_date: e.previousEndDate ?? null, new_end_date: e.newEndDate,
  periods: e.periods, period_label: e.periodLabel,
  additional_amount: e.additionalAmount, payment_id: e.paymentId ?? null,
  signature_data_url: e.signatureDataUrl ?? null, signed_by: e.signedBy ?? null,
  agreement_version: e.agreementVersion ?? null,
});
const fromPayment = (r: any): Payment => ({
  id: r.id, rentalId: r.rental_id, driverId: r.driver_id,
  amount: Number(r.amount), dueDate: r.due_date, paidDate: r.paid_date ?? undefined,
  method: r.method ?? undefined, status: r.status,
});
const toPayment = (p: Payment) => ({
  id: p.id, rental_id: p.rentalId, driver_id: p.driverId,
  amount: p.amount, due_date: p.dueDate, paid_date: p.paidDate ?? null,
  method: p.method ?? null, status: p.status,
});
const fromInspection = (r: any): Inspection => ({
  id: r.id, vehicleId: r.vehicle_id, rentalId: r.rental_id,
  type: r.type, date: r.date, mileage: r.mileage, fuelLevel: r.fuel_level,
  damageNoted: r.damage_noted, completedBy: r.completed_by,
});
const toInspection = (i: Inspection) => ({
  id: i.id, vehicle_id: i.vehicleId, rental_id: i.rentalId,
  type: i.type, date: i.date, mileage: i.mileage,
  fuel_level: i.fuelLevel, damage_noted: i.damageNoted, completed_by: i.completedBy,
});
const fromExpense = (r: any): Expense => ({
  id: r.id, category: r.category, amount: Number(r.amount), date: r.date,
  vendor: r.vendor ?? undefined, vehicleId: r.vehicle_id ?? undefined,
  notes: r.notes ?? undefined, receiptUrl: r.receipt_url ?? undefined,
});
const toExpense = (e: Expense) => ({
  id: e.id, category: e.category, amount: e.amount, date: e.date,
  vendor: e.vendor ?? null, vehicle_id: e.vehicleId ?? null,
  notes: e.notes ?? null, receipt_url: e.receiptUrl ?? null,
});

let hydrationPromise: Promise<void> | null = null;
let hydrated = false;
export function isStoreHydrated() { return hydrated; }

export function hydrateFromCloud(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    const [v, d, r, p, i, e, ex] = await Promise.all([
      supabase.from("vehicles").select("*"),
      supabase.from("drivers").select("*"),
      supabase.from("rentals").select("*"),
      supabase.from("payments").select("*"),
      supabase.from("inspections").select("*"),
      supabase.from("rental_extensions").select("*"),
      supabase.from("expenses").select("*"),
    ]);
    if (v.data) replaceArray(vehicles, v.data.map(fromVehicle));
    if (d.data) replaceArray(drivers, d.data.map(fromDriver));
    if (r.data) replaceArray(rentals, r.data.map(row => fromRental(row, e.data ?? [])));
    if (p.data) replaceArray(payments, p.data.map(fromPayment));
    if (i.data) replaceArray(inspections, i.data.map(fromInspection));
    if (ex.data) replaceArray(expenses, ex.data.map(fromExpense));
    hydrated = true;
    emit();
    subscribeRealtime();
  })();
  return hydrationPromise;
}

let realtimeSubscribed = false;
function subscribeRealtime() {
  if (realtimeSubscribed || typeof window === "undefined") return;
  realtimeSubscribed = true;
  supabase.channel("fleet-store")
    .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = vehicles.findIndex(x => x.id === id);
        if (idx >= 0) vehicles.splice(idx, 1);
      } else {
        const next = fromVehicle(payload.new);
        const idx = vehicles.findIndex(x => x.id === next.id);
        if (idx >= 0) vehicles[idx] = next as any; else vehicles.push(next as any);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = drivers.findIndex(x => x.id === id);
        if (idx >= 0) drivers.splice(idx, 1);
      } else {
        const next = fromDriver(payload.new);
        const idx = drivers.findIndex(x => x.id === next.id);
        if (idx >= 0) drivers[idx] = next as any; else drivers.push(next as any);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "rentals" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = rentals.findIndex(x => x.id === id);
        if (idx >= 0) rentals.splice(idx, 1);
      } else {
        const next = fromRental(payload.new);
        const idx = rentals.findIndex(x => x.id === next.id);
        if (idx >= 0) rentals[idx] = { ...next, extensions: rentals[idx].extensions };
        else rentals.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = payments.findIndex(x => x.id === id);
        if (idx >= 0) payments.splice(idx, 1);
      } else {
        const next = fromPayment(payload.new);
        const idx = payments.findIndex(x => x.id === next.id);
        if (idx >= 0) payments[idx] = next; else payments.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "inspections" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = inspections.findIndex(x => x.id === id);
        if (idx >= 0) inspections.splice(idx, 1);
      } else {
        const next = fromInspection(payload.new);
        const idx = inspections.findIndex(x => x.id === next.id);
        if (idx >= 0) inspections[idx] = next; else inspections.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "rental_extensions" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        for (const r of rentals) {
          if (r.extensions?.some(e => e.id === id)) {
            r.extensions = r.extensions.filter(e => e.id !== id);
          }
        }
      } else {
        const ext = fromExt(payload.new);
        const rentalId = (payload.new as any).rental_id;
        const r = rentals.find(x => x.id === rentalId);
        if (r) {
          const exts = r.extensions ?? [];
          const idx = exts.findIndex(e => e.id === ext.id);
          if (idx >= 0) exts[idx] = ext; else exts.push(ext);
          r.extensions = exts;
        }
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = expenses.findIndex(x => x.id === id);
        if (idx >= 0) expenses.splice(idx, 1);
      } else {
        const next = fromExpense(payload.new);
        const idx = expenses.findIndex(x => x.id === next.id);
        if (idx >= 0) expenses[idx] = next; else expenses.push(next);
      }
      emit();
    })
    .subscribe();
}

// fire-and-forget cloud writes; log failures but don't block UI
const cloudWrite = (label: string, p: PromiseLike<{ error: any }>) => {
  Promise.resolve(p).then(({ error }) => {
    if (error) console.error(`[cloud:${label}]`, error);
  });
};

// kick off hydration immediately on browser
if (typeof window !== "undefined") { hydrateFromCloud(); }

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
  cloudWrite("rental:insert", supabase.from("rentals").insert(toRental(rental)));
  emit();
  return rental;
}

/** Returns the renter's current open rental (active or pending), if any. */
export function getActiveRentalForDriver(driverId: string, ignoreRentalId?: string): Rental | null {
  return rentals.find(r =>
    r.driverId === driverId &&
    r.id !== ignoreRentalId &&
    !r.endDate
  ) ?? null;
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
      const id = rentals[i].id;
      cloudWrite("rental:delete", supabase.from("rentals").delete().eq("id", id));
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
  cloudWrite("rental:delete", supabase.from("rentals").delete().eq("id", id));
  emit();
}

function tryActivate(rental: Rental) {
  if (rental.reservationStatus !== "pending") return false;
  if (!rental.signatureDataUrl || !rental.paymentReceived) return false;
  rental.reservationStatus = "active";
  rental.pendingCreatedAt = undefined;
  const v = vehicles.find(v => v.id === rental.vehicleId);
  if (v) {
    v.status = "rented";
    cloudWrite("vehicle:update", supabase.from("vehicles").update({ status: "rented" }).eq("id", v.id));
  }
  // Schedule first payment one period out
  const period = rental.billingPeriod ?? "weekly";
  const due = new Date(rental.startDate);
  if (period === "daily") due.setDate(due.getDate() + 1);
  else if (period === "monthly") due.setMonth(due.getMonth() + 1);
  else due.setDate(due.getDate() + 7);
  const exists = payments.some(p => p.rentalId === rental.id);
  if (!exists) {
    const p: Payment = {
      id: nextPaymentId(), rentalId: rental.id, driverId: rental.driverId,
      amount: rental.rate ?? rental.weeklyRate,
      dueDate: due.toISOString().slice(0, 10), status: "late",
    };
    payments.push(p);
    cloudWrite("payment:insert", supabase.from("payments").insert(toPayment(p)));
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
  cloudWrite("rental:update", supabase.from("rentals").update(toRental(r)).eq("id", r.id));
  emit();
  return activated;
}

export function markReservationPaid(id: string) {
  const r = rentals.find(r => r.id === id);
  if (!r) return false;
  r.paymentReceived = true;
  const activated = tryActivate(r);
  cloudWrite("rental:update", supabase.from("rentals").update(toRental(r)).eq("id", r.id));
  emit();
  return activated;
}

export function updateRental(id: string, patch: Partial<Rental>) {
  const r = rentals.find(r => r.id === id);
  if (!r) return;
  Object.assign(r, patch);
  cloudWrite("rental:update", supabase.from("rentals").update(toRental(r)).eq("id", r.id));
  emit();
}

export function markReturned(id: string, endDate?: string) {
  const r = rentals.find(r => r.id === id);
  if (!r) return;
  r.endDate = endDate || new Date().toISOString().slice(0, 10);
  const v = vehicles.find(v => v.id === r.vehicleId);
  if (v) {
    v.status = "available";
    cloudWrite("vehicle:update", supabase.from("vehicles").update({ status: "available" }).eq("id", v.id));
  }
  cloudWrite("rental:update", supabase.from("rentals").update(toRental(r)).eq("id", r.id));
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
    const p: Payment = {
      id: paymentId, rentalId: r.id, driverId: r.driverId,
      amount: additionalAmount, dueDate: newEndDate, status: "late",
    };
    payments.push(p);
    cloudWrite("payment:insert", supabase.from("payments").insert(toPayment(p)));
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
  cloudWrite("rental:update", supabase.from("rentals").update(toRental(r)).eq("id", r.id));
  cloudWrite("ext:insert", supabase.from("rental_extensions").insert(toExt(r.id, ext)));
  emit();
  return ext;
}

function nextDriverId() {
  const n = drivers.reduce((m, d) => Math.max(m, parseInt(d.id.replace(/\D/g, "")) || 0), 1000);
  return `D-${n + 1}`;
}

function nextVehicleId() {
  const n = vehicles.reduce((m, v) => Math.max(m, parseInt(v.id.replace(/\D/g, "")) || 0), 100);
  return `V-${n + 1}`;
}

import type { Vehicle } from "./data";

export function addVehicle(input: Omit<Vehicle, "id" | "status" | "mileage" | "riskTier"> & Partial<Pick<Vehicle, "status" | "mileage" | "riskTier">>) {
  const vehicle: Vehicle = {
    id: nextVehicleId(),
    status: "available",
    mileage: 0,
    riskTier: "A",
    ...input,
  };
  vehicles.push(vehicle);
  cloudWrite("vehicle:insert", supabase.from("vehicles").insert(toVehicle(vehicle)));
  emit();
  return vehicle;
}

export function updateVehicleImage(id: string, imageUrl: string | null) {
  const v = vehicles.find(x => x.id === id);
  if (!v) return;
  v.imageUrl = imageUrl ?? undefined;
  cloudWrite("vehicle:update", supabase.from("vehicles").update({ image_url: imageUrl }).eq("id", id));
  emit();
}

/** Upload a photo file to storage and return its public URL. */
export async function uploadVehiclePhoto(vehicleId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${vehicleId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("vehicle-photos").upload(path, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  const { data } = supabase.storage.from("vehicle-photos").getPublicUrl(path);
  return data.publicUrl;
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
  cloudWrite("driver:insert", supabase.from("drivers").insert(toDriver(driver)));
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
  cloudWrite("inspection:insert", supabase.from("inspections").insert(toInspection(insp)));
  const v = vehicles.find(v => v.id === input.vehicleId);
  if (v && input.mileage) {
    v.mileage = input.mileage;
    cloudWrite("vehicle:update", supabase.from("vehicles").update({ mileage: input.mileage }).eq("id", v.id));
  }
  emit();
  return insp;
}

function nextMaintenanceId() {
  const n = maintenance.reduce((m, x) => Math.max(m, parseInt(x.id.replace(/\D/g, "")) || 0), 300);
  return `M-${n + 1}`;
}

export function addMaintenance(input: Omit<Maintenance, "id">) {
  const rec: Maintenance = { id: nextMaintenanceId(), ...input };
  maintenance.push(rec);
  const v = vehicles.find(v => v.id === input.vehicleId);
  if (v) {
    if (input.mileageAtService && input.mileageAtService > v.mileage) {
      v.mileage = input.mileageAtService;
      cloudWrite("vehicle:update", supabase.from("vehicles").update({ mileage: v.mileage }).eq("id", v.id));
    }
    if (input.nextServiceDue) {
      v.nextServiceDue = input.nextServiceDue;
      cloudWrite("vehicle:update", supabase.from("vehicles").update({ next_service_due: v.nextServiceDue }).eq("id", v.id));
    }
  }
  emit();
  return rec;
}

export function recordPayment(id: string, method: Payment["method"], paidDate?: string) {
  const p = payments.find(p => p.id === id);
  if (!p) return;
  p.status = "paid";
  p.method = method;
  p.paidDate = paidDate || new Date().toISOString().slice(0, 10);
  cloudWrite("payment:update", supabase.from("payments").update(toPayment(p)).eq("id", p.id));
  // Schedule next weekly payment for the rental if still active
  const rental = rentals.find(r => r.id === p.rentalId);
  if (rental && !rental.endDate) {
    const hasFuture = payments.some(x => x.rentalId === rental.id && x.status !== "paid");
    if (!hasFuture) {
      const due = new Date(p.dueDate);
      due.setDate(due.getDate() + 7);
      const np: Payment = {
        id: nextPaymentId(), rentalId: rental.id, driverId: rental.driverId,
        amount: rental.rate ?? rental.weeklyRate,
        dueDate: due.toISOString().slice(0, 10), status: "late",
      };
      payments.push(np);
      cloudWrite("payment:insert", supabase.from("payments").insert(toPayment(np)));
    }
    // Refresh rental's payment status from outstanding payments
    const overdue = payments.some(x => x.rentalId === rental.id && x.status === "missed");
    const late = payments.some(x => x.rentalId === rental.id && x.status === "late");
    rental.paymentStatus = overdue ? "defaulted" : late ? "late" : "current";
    cloudWrite("rental:update", supabase.from("rentals").update({ payment_status: rental.paymentStatus }).eq("id", rental.id));
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
