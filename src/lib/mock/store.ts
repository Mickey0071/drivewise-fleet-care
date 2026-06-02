import { useSyncExternalStore } from "react";
import { rentals, vehicles, payments, drivers, inspections, maintenance, expenses, vehiclePhotos, insuranceEntries, insuranceChecklist, violations, staff, payrollRuns, repairTypes, serviceTypes, workOrders, type Rental, type RentalExtension, type Driver, type Inspection, type Payment, type Maintenance, type Expense, type VehiclePhoto, type InsuranceEntry, type InsuranceChecklistItem, type Violation, type Staff, type PayrollRun, type RepairType, type ServiceType, type WorkOrder } from "./data";
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
  color: r.color ?? undefined,
  transmission: r.transmission ?? undefined,
  fuelType: r.fuel_type ?? undefined,
  seats: r.seats ?? undefined,
  fuelLevelPickup: r.fuel_level_pickup ?? undefined,
  ezPassTag: r.ez_pass_tag ?? undefined,
  registrationExpiry: r.registration_expiry ?? undefined,
  insuranceExpiry: r.insurance_expiry ?? undefined,
  hasOpenIssues: !!r.has_open_issues,
  maintenanceSettings: r.maintenance_settings ?? undefined,
});
const toVehicle = (v: any) => ({
  id: v.id, make: v.make, model: v.model, year: v.year, vin: v.vin,
  plate: v.plate, mileage: v.mileage, status: v.status, risk_tier: v.riskTier,
  daily_rate: v.dailyRate, weekly_rate: v.weeklyRate,
  notes: v.notes ?? null, next_service_due: v.nextServiceDue ?? null,
  image_url: v.imageUrl ?? null,
  color: v.color ?? null,
  transmission: v.transmission ?? null,
  fuel_type: v.fuelType ?? null,
  seats: v.seats ?? null,
  fuel_level_pickup: v.fuelLevelPickup ?? null,
  ez_pass_tag: v.ezPassTag ?? null,
  registration_expiry: v.registrationExpiry ?? null,
  insurance_expiry: v.insuranceExpiry ?? null,
  maintenance_settings: v.maintenanceSettings ?? {},
});
const fromDriver = (r: any) => ({
  id: r.id, fullName: r.full_name, phone: r.phone, email: r.email,
  licenseNumber: r.license_number, licenseExpiry: r.license_expiry,
  insuranceOnFile: r.insurance_on_file, rideshare: r.rideshare,
  status: r.status, dateAdded: r.date_added,
  dateOfBirth: r.date_of_birth ?? undefined,
  address: r.address ?? undefined,
  firstName: r.first_name ?? undefined,
  middleInitial: r.middle_initial ?? undefined,
  lastName: r.last_name ?? undefined,
  dlState: r.dl_state ?? undefined,
  streetAddress: r.street_address ?? undefined,
  aptUnit: r.apt_unit ?? undefined,
  city: r.city ?? undefined,
  state: r.state ?? undefined,
  zipCode: r.zip_code ?? undefined,
  altContactName: r.alt_contact_name ?? undefined,
  altContactPhone: r.alt_contact_phone ?? undefined,
  blocked: r.blocked ?? false,
  blockReason: r.block_reason ?? undefined,
  blockedAt: r.blocked_at ?? undefined,
});
const toDriver = (d: any) => ({
  // (card fields are written server-side only; not mapped back here)
  id: d.id, full_name: d.fullName, phone: d.phone, email: d.email,
  license_number: d.licenseNumber, license_expiry: d.licenseExpiry,
  insurance_on_file: d.insuranceOnFile, rideshare: d.rideshare,
  status: d.status, date_added: d.dateAdded,
  date_of_birth: d.dateOfBirth ?? null,
  address: d.address ?? null,
  first_name: d.firstName ?? null,
  middle_initial: d.middleInitial ?? null,
  last_name: d.lastName ?? null,
  dl_state: d.dlState ?? null,
  street_address: d.streetAddress ?? null,
  apt_unit: d.aptUnit ?? null,
  city: d.city ?? null,
  state: d.state ?? null,
  zip_code: d.zipCode ?? null,
  alt_contact_name: d.altContactName ?? null,
  alt_contact_phone: d.altContactPhone ?? null,
  blocked: d.blocked ?? false,
  block_reason: d.blockReason ?? null,
  blocked_at: d.blockedAt ?? null,
});
const fromRental = (r: any, exts: any[] = []): Rental => ({
  id: r.id, vehicleId: r.vehicle_id, driverId: r.driver_id,
  startDate: r.start_date, endDate: r.end_date ?? undefined,
  weeklyRate: Number(r.weekly_rate), depositPaid: Number(r.deposit_paid),
  paymentStatus: r.payment_status, notes: r.notes ?? undefined,
  billingPeriod: r.billing_period ?? undefined,
  rate: r.rate != null ? Number(r.rate) : undefined,
  billingCadence: r.billing_cadence ?? undefined,
  rateAmount: r.rate_amount != null ? Number(r.rate_amount) : undefined,
  autoRenew: r.auto_renew ?? undefined,
  currentPeriodEnd: r.current_period_end ?? undefined,
  skipDailyMinimum: r.skip_daily_minimum ?? false,
  signatureDataUrl: r.signature_data_url ?? undefined,
  signedAt: r.signed_at ?? undefined, signedBy: r.signed_by ?? undefined,
  agreementVersion: r.agreement_version ?? undefined,
  reservationStatus: r.reservation_status ?? undefined,
  pendingCreatedAt: r.pending_created_at ?? undefined,
  activatedAt: r.activated_at ?? undefined,
  paymentReceived: !!r.payment_received,
  licenseImageUrl: r.license_image_url ?? undefined,
  selfieImageUrl: r.selfie_image_url ?? undefined,
  clientSignatureUrl: r.client_signature_url ?? undefined,
  clientSignedAt: r.client_signed_at ?? undefined,
  paymentLinkAutoSentAt: r.payment_link_auto_sent_at ?? undefined,
  agreementPdfUrl: r.agreement_pdf_url ?? undefined,
  agreementPdfGeneratedAt: r.agreement_pdf_generated_at ?? undefined,
  receiptPdfUrl: r.receipt_pdf_url ?? undefined,
  receiptPdfGeneratedAt: r.receipt_pdf_generated_at ?? undefined,
  staffReviewStatus: r.staff_review_status ?? undefined,
  returnedAt: r.returned_at ?? undefined,
  portalLinkSends: Array.isArray(r.portal_link_sends) ? r.portal_link_sends : [],
  extensions: exts.filter(e => e.rental_id === r.id).map(fromExt),
});
const toRental = (r: any) => ({
  id: r.id, vehicle_id: r.vehicleId, driver_id: r.driverId,
  start_date: r.startDate, end_date: r.endDate ?? null,
  weekly_rate: r.weeklyRate, deposit_paid: r.depositPaid,
  payment_status: r.paymentStatus, notes: r.notes ?? null,
  billing_period: r.billingPeriod ?? null, rate: r.rate ?? null,
  billing_cadence: r.billingCadence ?? null,
  rate_amount: r.rateAmount ?? null,
  auto_renew: r.autoRenew ?? true,
  current_period_end: r.currentPeriodEnd ?? null,
  skip_daily_minimum: r.skipDailyMinimum ?? false,
  signature_data_url: r.signatureDataUrl ?? null,
  signed_at: r.signedAt ?? null, signed_by: r.signedBy ?? null,
  agreement_version: r.agreementVersion ?? null,
  reservation_status: r.reservationStatus ?? null,
  pending_created_at: r.pendingCreatedAt ?? null,
  activated_at: r.activatedAt ?? null,
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

/** Does an existing rental block a vehicle from a new booking?
 *  When `newStart` is omitted (reconcile / picker before dates are entered),
 *  any active+unreturned rental is considered blocking — this preserves the
 *  "vehicle is marked rented" behavior driven by reconcileVehicleAvailability.
 *  When `newStart` is provided, we do a real date-range overlap check so
 *  bounded rentals (with an end_date) correctly block overlapping windows.
 */
function rentalBlocksVehicle(
  r: Rental,
  ignoreRentalId?: string,
  newStart?: Date | null,
  newEnd?: Date | null,
) {
  if (ignoreRentalId && r.id === ignoreRentalId) return false;
  if (r.returnedAt) return false;
  const status = r.reservationStatus ?? "active";
  if (status !== "active" && status !== "pending") return false;

  // Active/on-rent vehicles stay blocked until the rental is explicitly
  // returned. The stored end date is billing/expected-return context, not
  // permission to rebook the car while it is still out.
  if (status === "active") return true;

  // No new window provided → block all active/pending unreturned rentals.
  if (!newStart) return true;

  const existingStart = r.startDate ? new Date(r.startDate) : null;
  if (!existingStart) return true; // malformed; treat as blocking
  const INF = new Date("2999-12-31");
  const existingEnd = r.endDate ? new Date(r.endDate) : INF;
  const nEnd = newEnd ?? INF;

  // Inclusive overlap: ranges intersect iff existingStart <= nEnd AND existingEnd >= newStart
  return existingStart <= nEnd && existingEnd >= newStart;
}

/** A vehicle is "awaiting post-return inspection" once it has been returned
 *  and before a runner has submitted a passing return inspection. We track
 *  this with the existing `vehicles.status = "inspection"` flag, which is
 *  set in markReturnedAwaitingInspection and cleared in addInspection when a
 *  passing return-type inspection lands. */
export function awaitingPostReturnInspection(vehicleId: string) {
  const v = vehicles.find(x => x.id === vehicleId);
  return !!v && v.status === "inspection";
}

export function isVehicleBookable(
  vehicleId: string,
  newStart?: Date | string | null,
  newEnd?: Date | string | null,
  allowOverride = false,
  ignoreRentalId?: string,
) {
  const vehicle = vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return false;
  if (vehicle.status === "maintenance" || vehicle.status === "impound" || vehicle.status === "rented") return false;
  // An open maintenance issue (repair ticket) blocks the vehicle from rentals
  // until the ticket is marked completed.
  if (vehicle.hasOpenIssues) return false;
  if (vehicle.status === "inspection" && !allowOverride) return false;
  const s = newStart == null ? null : (newStart instanceof Date ? newStart : new Date(newStart));
  const e = newEnd == null ? null : (newEnd instanceof Date ? newEnd : new Date(newEnd));
  return !rentals.some(r => r.vehicleId === vehicleId && rentalBlocksVehicle(r, ignoreRentalId, s, e));
}

function reconcileVehicleAvailability(persist = false) {
  for (const v of vehicles) {
    const blocking = rentals.find(r => r.vehicleId === v.id && rentalBlocksVehicle(r));
    // Only auto-flip "rented" → "available" when no blocking rental remains.
    // Vehicles in "inspection" stay there until a passing post-return
    // inspection is submitted (handled in addInspection).
    const nextStatus = blocking && (blocking.reservationStatus ?? "active") === "active"
      ? "rented"
      : !blocking && v.status === "rented"
        ? "available"
        : v.status;
    if (nextStatus !== v.status) {
      v.status = nextStatus;
      if (persist) cloudWrite("vehicle:status-reconcile", supabase.from("vehicles").update({ status: nextStatus }).eq("id", v.id));
    }
  }
}
const fromInspection = (r: any): Inspection => ({
  id: r.id, vehicleId: r.vehicle_id, rentalId: r.rental_id,
  type: r.type, date: r.date, mileage: r.mileage, fuelLevel: r.fuel_level,
  damageNoted: r.damage_noted, completedBy: r.completed_by,
  inspectorName: r.inspector_name ?? undefined,
  jobType: r.job_type ?? undefined,
  checklistItems: r.checklist_items ?? undefined,
  readyToRent: r.ready_to_rent ?? undefined,
  submittedAt: r.submitted_at ?? undefined,
  createdAt: r.created_at ?? undefined,
});
const toInspection = (i: Inspection) => ({
  id: i.id, vehicle_id: i.vehicleId, rental_id: i.rentalId,
  type: i.type, date: i.date, mileage: i.mileage,
  fuel_level: i.fuelLevel == null ? "full" : String(i.fuelLevel),
  damage_noted: i.damageNoted, completed_by: i.completedBy,
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
const fromVehiclePhoto = (r: any): VehiclePhoto => ({
  id: r.id, vehicleId: r.vehicle_id, url: r.url,
  caption: r.caption ?? undefined, sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});
const fromInsuranceEntry = (r: any): InsuranceEntry => ({
  id: r.id, vehicleId: r.vehicle_id ?? undefined, type: r.type,
  claimType: r.claim_type ?? undefined, date: r.date, amount: Number(r.amount),
  description: r.description ?? "", notes: r.notes ?? undefined,
  policyNumber: r.policy_number ?? undefined, claimNumber: r.claim_number ?? undefined,
  status: r.status, createdAt: r.created_at,
  company: r.company ?? undefined,
  renterName: r.renter_name ?? undefined,
  renterPhone: r.renter_phone ?? undefined,
});
const toInsuranceEntry = (e: InsuranceEntry) => ({
  id: e.id, vehicle_id: e.vehicleId ?? null, type: e.type,
  claim_type: e.claimType ?? null, date: e.date, amount: e.amount,
  description: e.description, notes: e.notes ?? null,
  policy_number: e.policyNumber ?? null, claim_number: e.claimNumber ?? null,
  status: e.status,
  company: e.company ?? null,
  renter_name: e.renterName ?? null,
  renter_phone: e.renterPhone ?? null,
});
const fromChecklist = (r: any): InsuranceChecklistItem => ({
  id: r.id, entryId: r.entry_id, label: r.label,
  done: !!r.done, sortOrder: r.sort_order ?? 0,
  notes: r.notes ?? undefined,
  amount: r.amount != null ? Number(r.amount) : undefined,
  requiresAmount: !!r.requires_amount,
  requiresDocument: r.requires_document !== false,
  documentUrl: r.document_url ?? undefined,
  documentName: r.document_name ?? undefined,
});

// ---- violations ----
const fromViolation = (r: any): Violation => ({
  id: r.id, vehicleId: r.vehicle_id, driverId: r.driver_id ?? undefined,
  type: r.type, amount: Number(r.amount), dateIssued: r.date_issued,
  status: r.status, notes: r.notes ?? undefined,
});
const toViolation = (v: Violation) => ({
  id: v.id, vehicle_id: v.vehicleId, driver_id: v.driverId ?? null,
  type: v.type, amount: v.amount, date_issued: v.dateIssued,
  status: v.status, notes: v.notes ?? null,
});

// ---- maintenance ----
const fromMaintenance = (r: any): Maintenance => ({
  id: r.id, vehicleId: r.vehicle_id, serviceType: r.service_type,
  vendor: r.vendor, dateCompleted: r.date_completed,
  mileageAtService: r.mileage_at_service, cost: Number(r.cost),
  nextServiceDue: r.next_service_due, notes: r.notes ?? undefined,
  completedBy: r.completed_by ?? undefined,
  sourceInspectionId: r.source_inspection_id ?? undefined,
  createdAt: r.created_at ?? undefined,
});
const toMaintenance = (m: Maintenance) => ({
  id: m.id, vehicle_id: m.vehicleId, service_type: m.serviceType,
  vendor: m.vendor, date_completed: m.dateCompleted,
  mileage_at_service: m.mileageAtService, cost: m.cost,
  next_service_due: m.nextServiceDue, notes: m.notes ?? null,
  completed_by: m.completedBy ?? null,
});

// ---- staff ----
const fromStaff = (r: any): Staff => ({
  id: r.id, fullName: r.full_name, role: r.role, phone: r.phone, email: r.email,
  payType: r.pay_type, payRate: Number(r.pay_rate),
  stripeConnected: !!r.stripe_connected, status: r.status,
});
const toStaff = (s: Staff) => ({
  id: s.id, full_name: s.fullName, role: s.role, phone: s.phone, email: s.email,
  pay_type: s.payType, pay_rate: s.payRate,
  stripe_connected: s.stripeConnected, status: s.status,
});

// ---- payroll runs (header + lines) ----
const fromPayrollRun = (r: any, lines: any[] = []): PayrollRun => ({
  id: r.id, periodStart: r.period_start, periodEnd: r.period_end,
  runDate: r.run_date, totalPayout: Number(r.total_payout),
  status: r.status,
  lines: lines.filter(l => l.run_id === r.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(l => ({
      staffId: l.staff_id, hours: Number(l.hours), vehicles: l.vehicles,
      gross: Number(l.gross), net: Number(l.net), status: l.status,
    })),
});
const toPayrollRun = (r: PayrollRun) => ({
  id: r.id, period_start: r.periodStart, period_end: r.periodEnd,
  run_date: r.runDate, total_payout: r.totalPayout, status: r.status,
});
const fromRepairType = (r: any): RepairType => ({
  id: r.id, name: r.name, description: r.description ?? "", sortOrder: r.sort_order ?? 0, createdAt: r.created_at,
});
const toRepairType = (t: RepairType) => ({
  id: t.id, name: t.name, description: t.description, sort_order: t.sortOrder, created_at: t.createdAt,
});
const fromServiceType = (r: any): ServiceType => ({
  id: r.id, name: r.name, description: r.description ?? "", sortOrder: r.sort_order ?? 0, createdAt: r.created_at,
});

// ---- work orders ----
const fromWorkOrder = (r: any): WorkOrder => ({
  id: r.id, vehicleId: r.vehicle_id, serviceType: r.service_type,
  scheduledDate: r.scheduled_date, estimatedCost: Number(r.estimated_cost ?? 0),
  description: r.description ?? "", assignedTo: r.assigned_to ?? undefined,
  priority: r.priority, status: r.status,
  completedDate: r.completed_date ?? undefined,
  actualCost: r.actual_cost != null ? Number(r.actual_cost) : undefined,
  partsUsed: r.parts_used ?? undefined,
  completionNotes: r.completion_notes ?? undefined,
  mechanicSignature: r.mechanic_signature ?? undefined,
  mechanicSignedAt: r.mechanic_signed_at ?? undefined,
  reviewedBy: r.reviewed_by ?? undefined,
  adminSignature: r.admin_signature ?? undefined,
  adminSignedAt: r.admin_signed_at ?? undefined,
  signedDocUrl: r.signed_doc_url ?? undefined,
  createdAt: r.created_at ?? undefined,
  fieldToken: r.field_token ?? undefined,
  fieldSubmittedAt: r.field_submitted_at ?? undefined,
});
const toWorkOrder = (w: WorkOrder) => ({
  id: w.id, vehicle_id: w.vehicleId, service_type: w.serviceType,
  scheduled_date: w.scheduledDate, estimated_cost: w.estimatedCost,
  description: w.description, assigned_to: w.assignedTo ?? null,
  priority: w.priority, status: w.status,
  completed_date: w.completedDate ?? null,
  actual_cost: w.actualCost ?? null,
  parts_used: w.partsUsed ?? null,
  completion_notes: w.completionNotes ?? null,
  mechanic_signature: w.mechanicSignature ?? null,
  mechanic_signed_at: w.mechanicSignedAt ?? null,
  reviewed_by: w.reviewedBy ?? null,
  admin_signature: w.adminSignature ?? null,
  admin_signed_at: w.adminSignedAt ?? null,
  signed_doc_url: w.signedDocUrl ?? null,
  field_token: w.fieldToken ?? null,
  field_submitted_at: w.fieldSubmittedAt ?? null,
});

let hydrationPromise: Promise<void> | null = null;
let hydrated = false;
export function isStoreHydrated() { return hydrated; }

export function hydrateFromCloud(options?: { force?: boolean }): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (options?.force) {
    hydrationPromise = null;
    hydrated = false;
  }
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    const [v, d, r, p, i, e, ex, vp, ie, ic, vio, mnt, stf, prr, prl, rt, st, wo] = await Promise.all([
      supabase.from("vehicles").select("*"),
      supabase.from("drivers").select("*"),
      supabase.from("rentals").select("*"),
      supabase.from("payments").select("*"),
      supabase.from("inspections").select("*"),
      supabase.from("rental_extensions").select("*"),
      supabase.from("expenses").select("*"),
      supabase.from("vehicle_photos").select("*").order("sort_order", { ascending: true }),
      supabase.from("insurance_entries").select("*").order("date", { ascending: false }),
      supabase.from("insurance_claim_checklist").select("*").order("sort_order", { ascending: true }),
      supabase.from("violations").select("*").order("date_issued", { ascending: false }),
      supabase.from("maintenance").select("*").order("date_completed", { ascending: false }),
      supabase.from("staff").select("*").order("full_name", { ascending: true }),
      supabase.from("payroll_runs").select("*").order("period_end", { ascending: false }),
      supabase.from("payroll_lines").select("*"),
      supabase.from("repair_types").select("*").order("sort_order", { ascending: true }),
      supabase.from("service_types").select("*").order("sort_order", { ascending: true }),
      supabase.from("work_orders").select("*").order("scheduled_date", { ascending: true }),
    ]);
    const failures = [v, d, r, p, i, e, ex, vp, ie, ic, vio, mnt, stf, prr, prl, rt, st, wo].filter(result => result.error);
    if (failures.length) {
      failures.forEach(result => console.error("[cloud:hydrate]", result.error));
      hydrationPromise = null;
      throw new Error("Cloud data did not load. Please sign in again or refresh.");
    }
    replaceArray(vehicles, (v.data ?? []).map(fromVehicle));
    replaceArray(drivers, (d.data ?? []).map(fromDriver));
    replaceArray(rentals, (r.data ?? []).map(row => fromRental(row, e.data ?? [])));
    replaceArray(payments, (p.data ?? []).map(fromPayment));
    replaceArray(inspections, (i.data ?? []).map(fromInspection));
    replaceArray(expenses, (ex.data ?? []).map(fromExpense));
    replaceArray(vehiclePhotos, (vp.data ?? []).map(fromVehiclePhoto));
    replaceArray(insuranceEntries, (ie.data ?? []).map(fromInsuranceEntry));
    replaceArray(insuranceChecklist, (ic.data ?? []).map(fromChecklist));
    replaceArray(violations, (vio.data ?? []).map(fromViolation));
    replaceArray(maintenance, (mnt.data ?? []).map(fromMaintenance));
    replaceArray(staff, (stf.data ?? []).map(fromStaff));
    replaceArray(payrollRuns, (prr.data ?? []).map(row => fromPayrollRun(row, prl.data ?? [])));
    replaceArray(repairTypes, (rt.data ?? []).map(fromRepairType));
    replaceArray(serviceTypes, (st.data ?? []).map(fromServiceType));
    replaceArray(workOrders, (wo.data ?? []).map(fromWorkOrder));
    reconcileVehicleAvailability(true);
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
    .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_photos" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = vehiclePhotos.findIndex(x => x.id === id);
        if (idx >= 0) vehiclePhotos.splice(idx, 1);
      } else {
        const next = fromVehiclePhoto(payload.new);
        const idx = vehiclePhotos.findIndex(x => x.id === next.id);
        if (idx >= 0) vehiclePhotos[idx] = next; else vehiclePhotos.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "insurance_entries" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = insuranceEntries.findIndex(x => x.id === id);
        if (idx >= 0) insuranceEntries.splice(idx, 1);
      } else {
        const next = fromInsuranceEntry(payload.new);
        const idx = insuranceEntries.findIndex(x => x.id === next.id);
        if (idx >= 0) insuranceEntries[idx] = next; else insuranceEntries.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "insurance_claim_checklist" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = insuranceChecklist.findIndex(x => x.id === id);
        if (idx >= 0) insuranceChecklist.splice(idx, 1);
      } else {
        const next = fromChecklist(payload.new);
        const idx = insuranceChecklist.findIndex(x => x.id === next.id);
        if (idx >= 0) insuranceChecklist[idx] = next; else insuranceChecklist.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "violations" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = violations.findIndex(x => x.id === id);
        if (idx >= 0) violations.splice(idx, 1);
      } else {
        const next = fromViolation(payload.new);
        const idx = violations.findIndex(x => x.id === next.id);
        if (idx >= 0) violations[idx] = next; else violations.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "maintenance" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = maintenance.findIndex(x => x.id === id);
        if (idx >= 0) maintenance.splice(idx, 1);
      } else {
        const next = fromMaintenance(payload.new);
        const idx = maintenance.findIndex(x => x.id === next.id);
        if (idx >= 0) maintenance[idx] = next; else maintenance.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "staff" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = staff.findIndex(x => x.id === id);
        if (idx >= 0) staff.splice(idx, 1);
      } else {
        const next = fromStaff(payload.new);
        const idx = staff.findIndex(x => x.id === next.id);
        if (idx >= 0) staff[idx] = next; else staff.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "payroll_runs" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = payrollRuns.findIndex(x => x.id === id);
        if (idx >= 0) payrollRuns.splice(idx, 1);
      } else {
        const existing = payrollRuns.find(x => x.id === (payload.new as any).id);
        const next = fromPayrollRun(payload.new, []);
        next.lines = existing?.lines ?? [];
        const idx = payrollRuns.findIndex(x => x.id === next.id);
        if (idx >= 0) payrollRuns[idx] = next; else payrollRuns.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "payroll_lines" }, (payload) => {
      const row = (payload.new ?? payload.old) as any;
      const run = payrollRuns.find(r => r.id === row.run_id);
      if (!run) { emit(); return; }
      if (payload.eventType === "DELETE") {
        run.lines = run.lines.filter(l => !(l.staffId === row.staff_id));
      } else {
        const line = {
          staffId: row.staff_id, hours: Number(row.hours), vehicles: row.vehicles,
          gross: Number(row.gross), net: Number(row.net), status: row.status,
        };
        const idx = run.lines.findIndex(l => l.staffId === line.staffId);
        if (idx >= 0) run.lines[idx] = line; else run.lines.push(line);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "repair_types" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = repairTypes.findIndex(x => x.id === id);
        if (idx >= 0) repairTypes.splice(idx, 1);
      } else {
        const next = fromRepairType(payload.new);
        const idx = repairTypes.findIndex(x => x.id === next.id);
        if (idx >= 0) repairTypes[idx] = next; else repairTypes.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "service_types" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = serviceTypes.findIndex(x => x.id === id);
        if (idx >= 0) serviceTypes.splice(idx, 1);
      } else {
        const next = fromServiceType(payload.new);
        const idx = serviceTypes.findIndex(x => x.id === next.id);
        if (idx >= 0) serviceTypes[idx] = next; else serviceTypes.push(next);
      }
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = workOrders.findIndex(x => x.id === id);
        if (idx >= 0) workOrders.splice(idx, 1);
      } else {
        const next = fromWorkOrder(payload.new);
        const idx = workOrders.findIndex(x => x.id === next.id);
        if (idx >= 0) workOrders[idx] = next; else workOrders.push(next);
      }
      emit();
    })
    .subscribe();
}

// fire-and-forget cloud writes; log failures but don't block UI
const cloudWrite = (label: string, p: PromiseLike<{ error: any }>) => {
  // Returns a promise that resolves on success and rejects on failure so
  // callers that care can `await` it. We also attach a `.catch` so callers
  // that ignore the promise don't trigger an unhandled-rejection crash.
  const promise = Promise.resolve(p).then(({ error }) => {
    if (error) {
      console.error(`[cloud:${label}]`, error);
      throw new Error(`[cloud:${label}] ${error.message ?? "write failed"}`);
    }
  });
  promise.catch(() => { /* logged above; swallow to avoid unhandled rejection */ });
  return promise;
};

// Hydration is started after auth restores so cloud reads include the session.

function nextRentalId() {
  const n = rentals.reduce((m, r) => Math.max(m, parseInt(r.id.replace(/\D/g, "")) || 0), 500);
  return `R-${n + 1}`;
}
function nextPaymentId() {
  const n = payments.reduce((m, p) => Math.max(m, parseInt(p.id.replace(/\D/g, "")) || 0), 9000);
  return `P-${n + 1}`;
}

/** True if vehicle has any active/pending rental overlapping [start, end?]. */
export function hasConflict(vehicleId: string, startDate: string, endDate?: string, ignoreRentalId?: string) {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;
  return rentals.some(r =>
    r.vehicleId === vehicleId && rentalBlocksVehicle(r, ignoreRentalId, start, end),
  );
}

/** Live overlap check against the cloud DB. Use before write operations to
 *  catch cross-session double-bookings that the in-memory store hasn't seen yet. */
export async function checkVehicleOverlapInDb(
  vehicleId: string,
  startDate: string,
  endDate?: string | null,
  ignoreRentalId?: string,
): Promise<{ conflictId: string; startDate: string; endDate: string | null } | null> {
  let q = supabase
    .from("rentals")
    .select("id, start_date, end_date, reservation_status, returned_at")
    .eq("vehicle_id", vehicleId)
    .is("returned_at", null)
    .in("reservation_status", ["active", "pending"]);
  if (ignoreRentalId) q = q.neq("id", ignoreRentalId);
  const { data, error } = await q;
  if (error) {
    // Don't block on transient cloud errors — sync in-memory check is still in place.
    console.warn("[checkVehicleOverlapInDb] cloud query failed, skipping live check:", error.message);
    return null;
  }
  const nStart = new Date(startDate);
  const INF = new Date("2999-12-31");
  const nEnd = endDate ? new Date(endDate) : INF;
  const hit = (data ?? []).find(row => {
    if (!row.start_date) return true;
    const cStart = new Date(row.start_date);
    const cEnd = row.end_date ? new Date(row.end_date) : INF;
    return cStart <= nEnd && cEnd >= nStart;
  });
  return hit ? { conflictId: hit.id, startDate: hit.start_date, endDate: hit.end_date } : null;
}

export function addRental(input: Omit<Rental, "id" | "paymentStatus"> & { paymentStatus?: Rental["paymentStatus"] }) {
  // Synchronous in-memory overlap guard. Defense-in-depth alongside the
  // optional async checkVehicleOverlapInDb callers should run before this.
  if (hasConflict(input.vehicleId, input.startDate, input.endDate ?? undefined)) {
    const v = vehicles.find(x => x.id === input.vehicleId);
    const label = v ? `${v.year} ${v.make} ${v.model} (${v.plate})` : input.vehicleId;
    throw new Error(`Cannot create rental: ${label} is already booked during these dates.`);
  }
  const cadence: "daily" | "weekly" =
    input.billingCadence ?? (input.billingPeriod === "daily" ? "daily" : "weekly");
  const rateAmount = input.rateAmount ?? input.rate ?? input.weeklyRate ?? 0;
  const currentPeriodEnd = input.currentPeriodEnd ?? calcCurrentPeriodEnd(input.startDate, cadence);
  const rental: Rental = {
    id: nextRentalId(),
    paymentStatus: "current",
    reservationStatus: "pending",
    pendingCreatedAt: new Date().toISOString(),
    paymentReceived: false,
    ...input,
    billingCadence: cadence,
    rateAmount,
    autoRenew: input.autoRenew ?? true,
    skipDailyMinimum: input.skipDailyMinimum ?? false,
    currentPeriodEnd,
  };
  rentals.push(rental);
  const cloudReady = cloudWrite("rental:insert", supabase.from("rentals").insert(toRental(rental))).catch((error) => {
    const idx = rentals.findIndex(r => r.id === rental.id);
    if (idx >= 0) { rentals.splice(idx, 1); emit(); }
    throw error;
  });
  emit();
  return Object.assign(rental, { cloudReady });
}

/** Advance startDate by cadence increments until on/after today. */
export function calcCurrentPeriodEnd(startDate: string, cadence: "daily" | "weekly"): string {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(startDate + "T00:00:00");
  const step = cadence === "daily" ? 1 : 7;
  if (d.getTime() >= today.getTime()) return d.toISOString().slice(0, 10);
  const diffDays = Math.ceil((today.getTime() - d.getTime()) / 86_400_000);
  const periods = Math.ceil(diffDays / step);
  d.setDate(d.getDate() + periods * step);
  return d.toISOString().slice(0, 10);
}

/** Find an unpaid Payment matching the rental's current_period_end,
 *  or synthesize and persist one so the existing RecordPaymentDialog can use it. */
export function getOrCreateDuePaymentForRental(rentalId: string): Payment | null {
  const r = rentals.find(x => x.id === rentalId);
  if (!r) return null;
  const due = r.currentPeriodEnd ?? calcCurrentPeriodEnd(r.startDate, (r.billingCadence ?? "weekly"));
  const amount = r.rateAmount ?? r.rate ?? r.weeklyRate ?? 0;
  const existing = payments.find(p => p.rentalId === r.id && p.status !== "paid" && p.dueDate === due);
  if (existing) return existing;
  const p: Payment = {
    id: nextPaymentId(), rentalId: r.id, driverId: r.driverId,
    amount, dueDate: due, status: "late",
  };
  payments.push(p);
  cloudWrite("payment:insert", supabase.from("payments").insert(toPayment(p)));
  emit();
  return p;
}

export async function ensureRentalSynced(id: string) {
  const rental = rentals.find(r => r.id === id);
  if (!rental) throw new Error("Reservation not found");
  const driver = drivers.find(d => d.id === rental.driverId);
  const vehicle = vehicles.find(v => v.id === rental.vehicleId);
  if (vehicle) await cloudWrite("vehicle:upsert", supabase.from("vehicles").upsert(toVehicle(vehicle)));
  if (driver) await cloudWrite("driver:upsert", supabase.from("drivers").upsert(toDriver(driver)));
  await cloudWrite("rental:upsert", supabase.from("rentals").upsert(toRental(rental)));
}

/** Returns the renter's current open rental (active or pending), if any. */
export function getActiveRentalForDriver(driverId: string, ignoreRentalId?: string): Rental | null {
  return rentals.find(r =>
    r.driverId === driverId &&
    rentalBlocksVehicle(r, ignoreRentalId)
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
  const r = rentals[idx];
  rentals.splice(idx, 1);
  // Free the vehicle if no other active/pending rental holds it
  const stillHeld = rentals.some(x => x.vehicleId === r.vehicleId && rentalBlocksVehicle(x));
  if (!stillHeld) {
    const v = vehicles.find(v => v.id === r.vehicleId);
    if (v && v.status !== "available") {
      v.status = "available";
      cloudWrite("vehicle:update", supabase.from("vehicles").update({ status: "available" }).eq("id", v.id));
    }
  }
  cloudWrite("rental:delete", supabase.from("rentals").delete().eq("id", id));
  emit();
}

function tryActivate(rental: Rental) {
  if (rental.reservationStatus !== "pending") return false;
  // Payment is the ONLY trigger for activation. Signature is no longer required.
  if (!rental.paymentReceived) return false;
  rental.reservationStatus = "active";
  rental.pendingCreatedAt = undefined;
  rental.activatedAt = new Date().toISOString();
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

  // Record the cash receipt so it flows into Payments + P&L immediately.
  const today = new Date().toISOString().slice(0, 10);
  const amount = Number(r.rateAmount ?? r.rate ?? r.weeklyRate ?? 0);
  if (amount > 0) {
    const cashPayment: Payment = {
      id: nextPaymentId(),
      rentalId: r.id,
      driverId: r.driverId,
      amount,
      dueDate: today,
      paidDate: today,
      method: "cash",
      status: "paid",
    };
    payments.push(cashPayment);
    cloudWrite("payment:insert", supabase.from("payments").insert(toPayment(cashPayment)));
  }

  emit();
  return activated;
}

/**
 * Has the renter paid for the current billing period?
 * - Pending reservations: true once paymentReceived flag is set (first-week capture).
 * - Active reservations: true when no unpaid payment has a due date on/before today.
 * - Completed (returned) rentals: always considered paid.
 */
export function currentPeriodPaid(rental: Rental): boolean {
  if (rental.endDate) return true;
  if ((rental.reservationStatus ?? "active") === "pending") return !!rental.paymentReceived;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = payments.some(
    p => p.rentalId === rental.id && p.status !== "paid" && p.dueDate <= today,
  );
  return !overdue;
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
  r.reservationStatus = "returned";
  const v = vehicles.find(v => v.id === r.vehicleId);
  if (v) {
    v.status = "available";
    cloudWrite("vehicle:update", supabase.from("vehicles").update({ status: "available" }).eq("id", v.id));
  }
  cloudWrite("rental:update", supabase.from("rentals").update({ ...toRental(r), reservation_status: "returned" }).eq("id", r.id));
  emit();
}

/** Local-only optimistic update after a server-side return completes.
 *  Does NOT write to cloud (server fn already did). Safe to call alongside
 *  realtime — idempotent. */
export async function refreshStoreFromCloud() {
  await hydrateFromCloud({ force: true });
}

export function syncLocalReturn(rentalId: string) {
  const r = rentals.find(x => x.id === rentalId);
  if (r) {
    r.reservationStatus = "returned";
    const v = vehicles.find(v => v.id === r.vehicleId);
    if (v) v.status = "available";
  }
  emit();
}

/** Mark a rental returned but leave the vehicle in "inspection" status
 *  until the runner submits the post-return inspection. */
export function markReturnedAwaitingInspection(id: string, endDate?: string) {
  const r = rentals.find(r => r.id === id);
  if (!r) return;
  r.endDate = endDate || new Date().toISOString().slice(0, 10);
  r.reservationStatus = "returned";
  const v = vehicles.find(v => v.id === r.vehicleId);
  if (v) {
    v.status = "inspection";
    cloudWrite("vehicle:update", supabase.from("vehicles").update({ status: "inspection" }).eq("id", v.id));
  }
  cloudWrite("rental:update", supabase.from("rentals").update({ ...toRental(r), reservation_status: "returned" }).eq("id", r.id));
  emit();
}

/** Swap the vehicle on an active rental. Old vehicle → available, new → rented. */
export function swapVehicle(rentalId: string, newVehicleId: string, reason?: string) {
  const r = rentals.find(x => x.id === rentalId);
  if (!r) throw new Error("Rental not found");
  if (r.vehicleId === newVehicleId) throw new Error("Already on that vehicle");
  const newV = vehicles.find(v => v.id === newVehicleId);
  if (!newV) throw new Error("New vehicle not found");
  if (newV.status !== "available") throw new Error("Target vehicle is not available");
  // Guard against double-booking the target vehicle for this rental's window.
  if (hasConflict(newVehicleId, r.startDate, r.endDate ?? undefined, r.id)) {
    throw new Error(`Cannot swap: ${newV.year} ${newV.make} ${newV.model} is already booked during this rental's dates.`);
  }
  const oldV = vehicles.find(v => v.id === r.vehicleId);
  const oldVehicleId = r.vehicleId;
  r.vehicleId = newVehicleId;
  const stamp = new Date().toISOString();
  const historyLine =
    `Swapped vehicle ${oldVehicleId} → ${newVehicleId} on ${stamp.slice(0, 10)}` +
    (reason ? ` — Reason: ${reason}` : "");
  r.notes = [r.notes, historyLine].filter(Boolean).join(" · ");
  newV.status = "rented";
  if (oldV) {
    oldV.status = "available";
    cloudWrite("vehicle:update", supabase.from("vehicles").update({ status: "available" }).eq("id", oldV.id));
  }
  cloudWrite("vehicle:update", supabase.from("vehicles").update({ status: "rented" }).eq("id", newV.id));
  cloudWrite("rental:update", supabase.from("rentals").update(toRental(r)).eq("id", r.id));
  emit();
  return { oldVehicleId, newVehicle: newV };
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
  // Guard against an extension overlapping another rental for the same vehicle.
  if (hasConflict(r.vehicleId, r.startDate, newEndDate, r.id)) {
    throw new Error(`Cannot extend: vehicle already has another rental overlapping the new end date.`);
  }
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
  const cloudReady = cloudWrite("vehicle:insert", supabase.from("vehicles").insert(toVehicle(vehicle))).catch((error) => {
    const idx = vehicles.findIndex(v => v.id === vehicle.id);
    if (idx >= 0) { vehicles.splice(idx, 1); emit(); }
    throw error;
  });
  emit();
  return Object.assign(vehicle, { cloudReady });
}

export function updateVehicleImage(id: string, imageUrl: string | null) {
  const v = vehicles.find(x => x.id === id);
  if (!v) return Promise.reject(new Error("Vehicle not found"));
  v.imageUrl = imageUrl ?? undefined;
  const cloudReady = cloudWrite("vehicle:update", supabase.from("vehicles").update({ image_url: imageUrl }).eq("id", id));
  emit();
  return cloudReady;
}

export function updateVehicle(id: string, fields: Partial<Omit<Vehicle, "id">>) {
  const v = vehicles.find(x => x.id === id);
  if (!v) return Promise.reject(new Error("Vehicle not found"));
  const prev = { ...v };
  Object.assign(v, fields);
  const patch: Record<string, unknown> = {};
  if (fields.make !== undefined) patch.make = fields.make;
  if (fields.model !== undefined) patch.model = fields.model;
  if (fields.year !== undefined) patch.year = fields.year;
  if (fields.vin !== undefined) patch.vin = fields.vin;
  if (fields.plate !== undefined) patch.plate = fields.plate;
  if (fields.mileage !== undefined) patch.mileage = fields.mileage;
  if (fields.status !== undefined) patch.status = fields.status;
  if (fields.riskTier !== undefined) patch.risk_tier = fields.riskTier;
  if (fields.dailyRate !== undefined) patch.daily_rate = fields.dailyRate;
  if (fields.weeklyRate !== undefined) patch.weekly_rate = fields.weeklyRate;
  if (fields.notes !== undefined) patch.notes = fields.notes ?? null;
  if (fields.nextServiceDue !== undefined) patch.next_service_due = fields.nextServiceDue ?? null;
  if (fields.imageUrl !== undefined) patch.image_url = fields.imageUrl ?? null;
  if (fields.color !== undefined) patch.color = fields.color ?? null;
  if (fields.transmission !== undefined) patch.transmission = fields.transmission ?? null;
  if (fields.fuelType !== undefined) patch.fuel_type = fields.fuelType ?? null;
  if (fields.seats !== undefined) patch.seats = fields.seats ?? null;
  if (fields.fuelLevelPickup !== undefined) patch.fuel_level_pickup = fields.fuelLevelPickup ?? null;
  if (fields.ezPassTag !== undefined) patch.ez_pass_tag = fields.ezPassTag ?? null;
  if (fields.registrationExpiry !== undefined) patch.registration_expiry = fields.registrationExpiry ?? null;
  if (fields.insuranceExpiry !== undefined) patch.insurance_expiry = fields.insuranceExpiry ?? null;
  if (fields.hasOpenIssues !== undefined) patch.has_open_issues = fields.hasOpenIssues;
  if (fields.maintenanceSettings !== undefined) patch.maintenance_settings = fields.maintenanceSettings ?? {};
  const cloudReady = cloudWrite("vehicle:update", supabase.from("vehicles").update(patch as never).eq("id", id)).catch((error) => {
    Object.assign(v, prev);
    emit();
    throw error;
  });
  emit();
  return cloudReady;
}

export function setVehicleAvailabilityOverride(vehicleId: string, available: boolean, reason?: string) {
  const v = vehicles.find(x => x.id === vehicleId);
  if (!v) return Promise.reject(new Error("Vehicle not found"));
  const stamp = new Date().toISOString();
  const today = stamp.slice(0, 10);
  const note = reason?.trim() || (available ? "Admin override: block lifted" : "Admin override: vehicle manually blocked");
  const writes: Promise<unknown>[] = [];

  if (available) {
    for (const m of maintenance.filter(m => m.vehicleId === vehicleId && !m.dateCompleted)) {
      m.dateCompleted = today;
      m.completedBy = "Admin override";
      m.notes = [m.notes, `${note} on ${today}`].filter(Boolean).join("\n\n");
      writes.push(cloudWrite("maintenance:override", supabase.from("maintenance").update(toMaintenance(m)).eq("id", m.id)));
    }
    for (const r of rentals.filter(r => r.vehicleId === vehicleId && rentalBlocksVehicle(r))) {
      r.endDate = r.endDate ?? today;
      r.returnedAt = stamp;
      r.reservationStatus = "returned";
      r.notes = [r.notes, `${note} on ${today}`].filter(Boolean).join(" · ");
      writes.push(cloudWrite("rental:override", supabase.from("rentals").update({ ...toRental(r), returned_at: r.returnedAt, reservation_status: "returned" }).eq("id", r.id)));
    }
    v.status = "available";
    v.hasOpenIssues = false;
    writes.push(cloudWrite("vehicle:override", supabase.from("vehicles").update({ status: "available", has_open_issues: false }).eq("id", vehicleId)));
  } else {
    v.status = "maintenance";
    writes.push(cloudWrite("vehicle:override", supabase.from("vehicles").update({ status: "maintenance" }).eq("id", vehicleId)));
  }

  emit();
  return Promise.all(writes).then(() => undefined);
}

export function deleteVehicle(id: string) {
  const idx = vehicles.findIndex(x => x.id === id);
  if (idx < 0) return Promise.reject(new Error("Vehicle not found"));
  const removed = vehicles[idx];
  vehicles.splice(idx, 1);
  const cloudReady = cloudWrite("vehicle:delete", supabase.from("vehicles").delete().eq("id", id)).catch((error) => {
    vehicles.splice(idx, 0, removed);
    emit();
    throw error;
  });
  emit();
  return cloudReady;
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

export function getVehiclePhotos(vehicleId: string): VehiclePhoto[] {
  return vehiclePhotos
    .filter(p => p.vehicleId === vehicleId)
    .slice()
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.createdAt.localeCompare(b.createdAt));
}

export async function addVehicleGalleryPhoto(vehicleId: string, file: File, caption?: string): Promise<VehiclePhoto> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${vehicleId}/gallery/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage.from("vehicle-photos").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/jpeg",
  });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from("vehicle-photos").getPublicUrl(path);
  const url = pub.publicUrl;
  const maxOrder = vehiclePhotos.filter(p => p.vehicleId === vehicleId)
    .reduce((m, p) => Math.max(m, p.sortOrder), -1);
  const row = {
    vehicle_id: vehicleId,
    url,
    caption: caption ?? null,
    sort_order: maxOrder + 1,
  };
  const { data, error } = await supabase.from("vehicle_photos").insert(row as never).select().single();
  if (error) throw error;
  const photo = fromVehiclePhoto(data);
  if (!vehiclePhotos.some(p => p.id === photo.id)) vehiclePhotos.push(photo);
  emit();
  return photo;
}

export async function deleteVehicleGalleryPhoto(photoId: string): Promise<void> {
  const idx = vehiclePhotos.findIndex(p => p.id === photoId);
  if (idx < 0) return;
  const photo = vehiclePhotos[idx];
  // attempt to remove the storage object (best-effort)
  try {
    const m = photo.url.match(/\/vehicle-photos\/(.+)$/);
    if (m) await supabase.storage.from("vehicle-photos").remove([m[1]]);
  } catch (e) {
    console.warn("[cloud:vehicle_photos:storage] could not delete object", e);
  }
  vehiclePhotos.splice(idx, 1);
  emit();
  const cloudReady = cloudWrite("vehicle_photos:delete", supabase.from("vehicle_photos").delete().eq("id", photoId)).catch((error) => {
    vehiclePhotos.splice(idx, 0, photo);
    emit();
    throw error;
  });
  await cloudReady;
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
  const cloudReady = cloudWrite("driver:insert", supabase.from("drivers").insert(toDriver(driver))).catch((error) => {
    const idx = drivers.findIndex(d => d.id === driver.id);
    if (idx >= 0) { drivers.splice(idx, 1); emit(); }
    throw error;
  });
  emit();
  return Object.assign(driver, { cloudReady });
}

export function updateDriver(id: string, fields: Partial<Omit<Driver, "id">>) {
  const d = drivers.find(x => x.id === id);
  if (!d) return Promise.reject(new Error("Driver not found"));
  const prev = { ...d };
  Object.assign(d, fields);
  const patch: Record<string, unknown> = {};
  if (fields.fullName !== undefined) patch.full_name = fields.fullName;
  if (fields.phone !== undefined) patch.phone = fields.phone;
  if (fields.email !== undefined) patch.email = fields.email;
  if (fields.licenseNumber !== undefined) patch.license_number = fields.licenseNumber;
  if (fields.licenseExpiry !== undefined) patch.license_expiry = fields.licenseExpiry;
  if (fields.insuranceOnFile !== undefined) patch.insurance_on_file = fields.insuranceOnFile;
  if (fields.rideshare !== undefined) patch.rideshare = fields.rideshare;
  if (fields.status !== undefined) patch.status = fields.status;
  if (fields.dateOfBirth !== undefined) patch.date_of_birth = fields.dateOfBirth ?? null;
  if (fields.address !== undefined) patch.address = fields.address ?? null;
  if (fields.firstName !== undefined) patch.first_name = fields.firstName ?? null;
  if (fields.middleInitial !== undefined) patch.middle_initial = fields.middleInitial ?? null;
  if (fields.lastName !== undefined) patch.last_name = fields.lastName ?? null;
  if (fields.dlState !== undefined) patch.dl_state = fields.dlState ?? null;
  if (fields.streetAddress !== undefined) patch.street_address = fields.streetAddress ?? null;
  if (fields.aptUnit !== undefined) patch.apt_unit = fields.aptUnit ?? null;
  if (fields.city !== undefined) patch.city = fields.city ?? null;
  if (fields.state !== undefined) patch.state = fields.state ?? null;
  if (fields.zipCode !== undefined) patch.zip_code = fields.zipCode ?? null;
  if (fields.altContactName !== undefined) patch.alt_contact_name = fields.altContactName ?? null;
  if (fields.altContactPhone !== undefined) patch.alt_contact_phone = fields.altContactPhone ?? null;
  if (fields.blocked !== undefined) patch.blocked = fields.blocked;
  if (fields.blockReason !== undefined) patch.block_reason = fields.blockReason ?? null;
  if (fields.blockedAt !== undefined) patch.blocked_at = fields.blockedAt ?? null;
  const cloudReady = cloudWrite("driver:update", supabase.from("drivers").update(patch as never).eq("id", id)).catch((error) => {
    Object.assign(d, prev);
    emit();
    throw error;
  });
  emit();
  return cloudReady;
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
  // If this is a passing post-return inspection, lift the inspection hold so
  // the vehicle becomes bookable again. Failing inspections leave the vehicle
  // in the "inspection" status and flag has_open_issues via the DB trigger.
  if (v && v.status === "inspection") {
    const isReturnJob = input.jobType === "vehicle_return";
    const checklistFailed = Object.values(input.checklistItems ?? {}).some(x => x === "fail");
    const passing = isReturnJob && input.readyToRent === true && !input.damageNoted && !checklistFailed;
    if (passing) {
      v.status = "available";
      cloudWrite("vehicle:update", supabase.from("vehicles").update({ status: "available" }).eq("id", v.id));
    }
  }
  emit();
  return insp;
}

function nextMaintenanceId() {
  const n = maintenance.reduce((m, x) => Math.max(m, parseInt(x.id.replace(/\D/g, "")) || 0), 300);
  return `M-${n + 1}`;
}

/** Recompute the local vehicle.hasOpenIssues flag from open maintenance
 *  tickets. The DB keeps the persisted flag in sync via triggers; this
 *  mirrors it in-memory so the UI reflects the change immediately. */
function syncVehicleOpenIssues(vehicleId: string) {
  const v = vehicles.find(x => x.id === vehicleId);
  if (!v) return;
  const open = maintenance.some(m => m.vehicleId === vehicleId && !m.dateCompleted);
  if (v.hasOpenIssues !== open) {
    v.hasOpenIssues = open;
  }
  if (open && v.status !== "rented" && v.status !== "impound") {
    v.status = "maintenance";
    cloudWrite("vehicle:update", supabase.from("vehicles").update({ status: "maintenance", has_open_issues: true }).eq("id", v.id));
  } else if (!open && v.status === "maintenance") {
    const activeRental = rentals.some(r => r.vehicleId === v.id && rentalBlocksVehicle(r));
    v.status = activeRental ? "rented" : "available";
    cloudWrite("vehicle:update", supabase.from("vehicles").update({ status: v.status, has_open_issues: false }).eq("id", v.id));
  }
}

export function addMaintenance(input: Omit<Maintenance, "id">) {
  const rec: Maintenance = { id: nextMaintenanceId(), ...input };
  maintenance.push(rec);
  cloudWrite("maintenance:insert", supabase.from("maintenance").insert(toMaintenance(rec)));
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
    // Opening a repair ticket (no completion date) marks the vehicle
    // unavailable for rentals until the ticket is completed.
    if (!input.dateCompleted) syncVehicleOpenIssues(v.id);
  }
  emit();
  return rec;
}

export async function addRepairType(name: string, description = ""): Promise<RepairType> {
  const maxOrder = repairTypes.reduce((m, t) => Math.max(m, t.sortOrder), -1);
  const row = { name, description, sort_order: maxOrder + 1 };
  const { data, error } = await supabase.from("repair_types").insert(row).select().single();
  if (error) throw error;
  const t = fromRepairType(data);
  if (!repairTypes.some(x => x.id === t.id)) repairTypes.push(t);
  emit();
  return t;
}

export async function addServiceType(name: string, description = ""): Promise<ServiceType> {
  const maxOrder = serviceTypes.reduce((m, t) => Math.max(m, t.sortOrder), -1);
  const row = { name, description, sort_order: maxOrder + 1 };
  const { data, error } = await supabase.from("service_types").insert(row).select().single();
  if (error) throw error;
  const t = fromServiceType(data);
  if (!serviceTypes.some(x => x.id === t.id)) serviceTypes.push(t);
  emit();
  return t;
}

export function updateMaintenance(id: string, patch: Partial<Maintenance>) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  Object.assign(m, patch);
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  // Completing (or reopening) a ticket flips the vehicle availability flag.
  syncVehicleOpenIssues(m.vehicleId);
  emit();
}

export function deleteMaintenance(id: string) {
  const idx = maintenance.findIndex(x => x.id === id);
  if (idx < 0) return;
  const vehicleId = maintenance[idx].vehicleId;
  maintenance.splice(idx, 1);
  cloudWrite("maintenance:delete", supabase.from("maintenance").delete().eq("id", id));
  syncVehicleOpenIssues(vehicleId);
  emit();
}

// ---------------------------------------------------------------------------
// Work orders (preventive maintenance scheduling)
// ---------------------------------------------------------------------------
function nextWorkOrderId() {
  const year = new Date().getFullYear();
  const prefix = `WO-${year}-`;
  const maxSeq = workOrders.reduce((m, w) => {
    if (!w.id.startsWith(prefix)) return m;
    const n = parseInt(w.id.slice(prefix.length), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

export function addWorkOrder(input: Omit<WorkOrder, "id" | "status" | "createdAt"> & { status?: WorkOrder["status"] }) {
  const rec: WorkOrder = {
    id: nextWorkOrderId(),
    status: input.status ?? "pending",
    createdAt: new Date().toISOString(),
    fieldToken: genFieldToken(),
    ...input,
  };
  workOrders.push(rec);
  cloudWrite("work_orders:insert", supabase.from("work_orders").insert(toWorkOrder(rec)));
  emit();
  return rec;
}

function genFieldToken(): string {
  const a = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Ensure a work order has a field-access token (for older records), returns it. */
export function ensureWorkOrderFieldToken(id: string): string | undefined {
  const w = workOrders.find(x => x.id === id);
  if (!w) return undefined;
  if (w.fieldToken) return w.fieldToken;
  const token = genFieldToken();
  updateWorkOrder(id, { fieldToken: token });
  return token;
}

export function updateWorkOrder(id: string, patch: Partial<WorkOrder>) {
  const w = workOrders.find(x => x.id === id);
  if (!w) return;
  Object.assign(w, patch);
  cloudWrite("work_orders:update", supabase.from("work_orders").update(toWorkOrder(w)).eq("id", id));
  emit();
}

export function deleteWorkOrder(id: string) {
  const idx = workOrders.findIndex(x => x.id === id);
  if (idx < 0) return;
  workOrders.splice(idx, 1);
  cloudWrite("work_orders:delete", supabase.from("work_orders").delete().eq("id", id));
  emit();
}

/** Upload a signed work-order document and return a temporary signed URL. */
export async function uploadWorkOrderDoc(workOrderId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
  const path = `${workOrderId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("work-order-docs").upload(path, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  updateWorkOrder(workOrderId, { signedDocUrl: path });
  const { data } = await supabase.storage.from("work-order-docs").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? path;
}

/** Resolve a stored work-order doc path into a viewable signed URL. */
export async function getWorkOrderDocUrl(path: string): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const { data } = await supabase.storage.from("work-order-docs").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------
function nextViolationId() {
  const n = violations.reduce((m, x) => Math.max(m, parseInt(x.id.replace(/\D/g, "")) || 0), 700);
  return `VIO-${n + 1}`;
}

export function addViolation(input: Omit<Violation, "id" | "status"> & Partial<Pick<Violation, "status">>) {
  const v: Violation = {
    id: nextViolationId(),
    status: "pending",
    ...input,
  };
  violations.push(v);
  cloudWrite("violation:insert", supabase.from("violations").insert(toViolation(v)));
  emit();
  return v;
}

export function updateViolation(id: string, patch: Partial<Violation>) {
  const v = violations.find(x => x.id === id);
  if (!v) return;
  Object.assign(v, patch);
  cloudWrite("violation:update", supabase.from("violations").update(toViolation(v)).eq("id", id));
  emit();
}

export function deleteViolation(id: string) {
  const idx = violations.findIndex(x => x.id === id);
  if (idx < 0) return;
  violations.splice(idx, 1);
  cloudWrite("violation:delete", supabase.from("violations").delete().eq("id", id));
  emit();
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
function nextStaffId() {
  const n = staff.reduce((m, x) => Math.max(m, parseInt(x.id.replace(/\D/g, "")) || 0), 0);
  return `S-${String(n + 1).padStart(2, "0")}`;
}

export function addStaff(input: Omit<Staff, "id" | "status" | "stripeConnected"> & Partial<Pick<Staff, "status" | "stripeConnected">>) {
  const s: Staff = {
    id: nextStaffId(),
    status: "active",
    stripeConnected: false,
    ...input,
  };
  staff.push(s);
  cloudWrite("staff:insert", supabase.from("staff").insert(toStaff(s)));
  emit();
  return s;
}

export function updateStaff(id: string, patch: Partial<Staff>) {
  const s = staff.find(x => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  cloudWrite("staff:update", supabase.from("staff").update(toStaff(s)).eq("id", id));
  emit();
}

export function deleteStaff(id: string) {
  const idx = staff.findIndex(x => x.id === id);
  if (idx < 0) return;
  staff.splice(idx, 1);
  cloudWrite("staff:delete", supabase.from("staff").delete().eq("id", id));
  emit();
}

// ---------------------------------------------------------------------------
// Payroll runs
// ---------------------------------------------------------------------------
function nextPayrollRunId() {
  const n = payrollRuns.reduce((m, x) => Math.max(m, parseInt(x.id.replace(/\D/g, "")) || 0), 0);
  return `PR-${String(n + 1).padStart(4, "0")}`;
}

export function addPayrollRun(input: Omit<PayrollRun, "id"> & { id?: string }) {
  const run: PayrollRun = { id: input.id ?? nextPayrollRunId(), ...input };
  payrollRuns.push(run);
  cloudWrite("payroll_run:insert", supabase.from("payroll_runs").insert(toPayrollRun(run)));
  run.lines.forEach((line, i) => {
    cloudWrite("payroll_line:insert", supabase.from("payroll_lines").insert({
      run_id: run.id, staff_id: line.staffId, hours: line.hours,
      vehicles: line.vehicles, gross: line.gross, net: line.net,
      status: line.status, sort_order: i,
    }));
  });
  emit();
  return run;
}

export function updatePayrollRun(id: string, patch: Partial<Omit<PayrollRun, "lines">>) {
  const r = payrollRuns.find(x => x.id === id);
  if (!r) return;
  Object.assign(r, patch);
  cloudWrite("payroll_run:update", supabase.from("payroll_runs").update(toPayrollRun(r)).eq("id", id));
  emit();
}

export function deletePayrollRun(id: string) {
  const idx = payrollRuns.findIndex(x => x.id === id);
  if (idx < 0) return;
  payrollRuns.splice(idx, 1);
  cloudWrite("payroll_run:delete", supabase.from("payroll_runs").delete().eq("id", id));
  emit();
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

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
function nextExpenseId() {
  const n = expenses.reduce((m, e) => Math.max(m, parseInt(e.id.replace(/\D/g, "")) || 0), 100);
  return `E-${n + 1}`;
}

export function addExpense(input: Omit<Expense, "id"> & { id?: string }) {
  const exp: Expense = {
    id: input.id ?? nextExpenseId(),
    category: input.category,
    amount: input.amount,
    date: input.date,
    vendor: input.vendor,
    vehicleId: input.vehicleId,
    notes: input.notes,
    receiptUrl: input.receiptUrl,
  };
  expenses.push(exp);
  const cloudReady = cloudWrite("expense:insert", supabase.from("expenses").insert(toExpense(exp))).catch((error) => {
    const idx = expenses.findIndex(e => e.id === exp.id);
    if (idx >= 0) { expenses.splice(idx, 1); emit(); }
    throw error;
  });
  emit();
  return Object.assign(exp, { cloudReady });
}

export function updateExpense(id: string, patch: Partial<Expense>) {
  const e = expenses.find(x => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  cloudWrite("expense:update", supabase.from("expenses").update(toExpense(e)).eq("id", id));
  emit();
}

export function deleteExpense(id: string) {
  const idx = expenses.findIndex(x => x.id === id);
  if (idx < 0) return;
  expenses.splice(idx, 1);
  cloudWrite("expense:delete", supabase.from("expenses").delete().eq("id", id));
  emit();
}

/** Upload a receipt file to private storage and return its signed download URL. */
export async function uploadExpenseReceipt(file: File): Promise<{ path: string; url: string }> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("expense-receipts").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  const { data, error: urlErr } = await supabase.storage
    .from("expense-receipts")
    .createSignedUrl(path, 60 * 60 * 24 * 365); // 1y
  if (urlErr || !data) throw urlErr ?? new Error("signed url failed");
  return { path, url: data.signedUrl };
}

// ---------------------------------------------------------------------------
// Insurance entries + claim checklist
// ---------------------------------------------------------------------------
export function addInsuranceEntry(input: Omit<InsuranceEntry, "id" | "createdAt" | "status"> & { status?: InsuranceEntry["status"] }) {
  const entry: InsuranceEntry = {
    id: `ins_${Math.random().toString(36).slice(2, 14)}`,
    vehicleId: input.vehicleId,
    type: input.type,
    claimType: input.claimType,
    date: input.date,
    amount: input.amount,
    description: input.description,
    notes: input.notes,
    policyNumber: input.policyNumber,
    claimNumber: input.claimNumber,
    status: input.status ?? (input.type === "claim" ? "open" : "closed"),
    createdAt: new Date().toISOString(),
  };
  insuranceEntries.push(entry);
  const cloudReady = cloudWrite("insurance:insert", supabase.from("insurance_entries").insert(toInsuranceEntry(entry))).catch((error) => {
    const idx = insuranceEntries.findIndex(e => e.id === entry.id);
    if (idx >= 0) { insuranceEntries.splice(idx, 1); emit(); }
    throw error;
  });
  emit();
  return Object.assign(entry, { cloudReady });
}

export function updateInsuranceEntry(id: string, patch: Partial<InsuranceEntry>) {
  const e = insuranceEntries.find(x => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  cloudWrite("insurance:update", supabase.from("insurance_entries").update(toInsuranceEntry(e)).eq("id", id));
  emit();
}

export function deleteInsuranceEntry(id: string) {
  const idx = insuranceEntries.findIndex(x => x.id === id);
  if (idx < 0) return;
  insuranceEntries.splice(idx, 1);
  // cascade in DB handles checklist rows; clear local mirror
  for (let i = insuranceChecklist.length - 1; i >= 0; i--) {
    if (insuranceChecklist[i].entryId === id) insuranceChecklist.splice(i, 1);
  }
  cloudWrite("insurance:delete", supabase.from("insurance_entries").delete().eq("id", id));
  emit();
}

export function getChecklistFor(entryId: string): InsuranceChecklistItem[] {
  return insuranceChecklist
    .filter(c => c.entryId === entryId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function toggleChecklistItem(id: string, done: boolean) {
  const item = insuranceChecklist.find(c => c.id === id);
  if (!item) return;
  item.done = done;
  cloudWrite("insurance_checklist:update", supabase.from("insurance_claim_checklist").update({ done }).eq("id", id));
  emit();
}

export function updateChecklistItem(id: string, patch: Partial<Pick<InsuranceChecklistItem, "done" | "notes" | "amount" | "documentUrl" | "documentName">>) {
  const item = insuranceChecklist.find(c => c.id === id);
  if (!item) return;
  Object.assign(item, patch);
  const row: {
    done?: boolean; notes?: string | null; amount?: number | null;
    document_url?: string | null; document_name?: string | null;
  } = {};
  if ("done" in patch) row.done = patch.done;
  if ("notes" in patch) row.notes = patch.notes ?? null;
  if ("amount" in patch) row.amount = patch.amount ?? null;
  if ("documentUrl" in patch) row.document_url = patch.documentUrl ?? null;
  if ("documentName" in patch) row.document_name = patch.documentName ?? null;
  cloudWrite("insurance_checklist:update", supabase.from("insurance_claim_checklist").update(row).eq("id", id));
  emit();
}

export async function uploadClaimDocument(itemId: string, file: File): Promise<void> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `${itemId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("claim-documents").upload(path, file, {
    cacheControl: "3600", upsert: true, contentType: file.type || undefined,
  });
  if (error) throw error;
  // Bucket is private — generate a long-lived signed URL.
  const { data, error: signErr } = await supabase.storage
    .from("claim-documents")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signErr || !data?.signedUrl) throw signErr ?? new Error("Failed to sign URL");
  updateChecklistItem(itemId, { documentUrl: data.signedUrl, documentName: file.name });
}

export function addChecklistItem(entryId: string, label: string) {
  const maxOrder = insuranceChecklist.filter(c => c.entryId === entryId).reduce((m, c) => Math.max(m, c.sortOrder), 0);
  const id = `icl_${Math.random().toString(36).slice(2, 14)}`;
  const item: InsuranceChecklistItem = {
    id, entryId, label, done: false, sortOrder: maxOrder + 1,
    requiresAmount: false, requiresDocument: true,
  };
  insuranceChecklist.push(item);
  cloudWrite("insurance_checklist:insert", supabase.from("insurance_claim_checklist").insert({
    id, entry_id: entryId, label, sort_order: item.sortOrder,
    requires_amount: false, requires_document: true,
  }));
  emit();
}

export function deleteChecklistItem(id: string) {
  const idx = insuranceChecklist.findIndex(c => c.id === id);
  if (idx < 0) return;
  insuranceChecklist.splice(idx, 1);
  cloudWrite("insurance_checklist:delete", supabase.from("insurance_claim_checklist").delete().eq("id", id));
  emit();
}
