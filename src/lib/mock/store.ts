import { useSyncExternalStore } from "react";
import { rentals, vehicles, payments, drivers, inspections, maintenance, expenses, vehiclePhotos, insuranceEntries, insuranceChecklist, violations, staff, payrollRuns, repairTypes, serviceTypes, workOrders, type Rental, type RentalExtension, type Driver, type Inspection, type Payment, type Maintenance, type Expense, type VehiclePhoto, type InsuranceEntry, type InsuranceChecklistItem, type Violation, type Staff, type PayrollRun, type RepairType, type ServiceType, type WorkOrder, type RepairSolution } from "./data";
import { supabase } from "@/integrations/supabase/client";
import { computeScheduledItems, type ScheduledItem } from "@/lib/maintenance-utils";

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
  licenseImageUrl: r.license_image_url ?? undefined,
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
  stripeCustomerId: r.stripe_customer_id ?? undefined,
  stripePaymentMethodId: r.stripe_payment_method_id ?? undefined,
  cardLast4: r.card_last4 ?? undefined,
  cardBrand: r.card_brand ?? undefined,
  cardExpMonth: r.card_exp_month ?? undefined,
  cardExpYear: r.card_exp_year ?? undefined,
  cardSavedAt: r.card_saved_at ?? undefined,
});
const toDriver = (d: any) => ({
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
  license_image_url: d.licenseImageUrl ?? null,
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
  notesUpdatedAt: r.notes_updated_at ?? undefined,
  billingPeriod: r.billing_period ?? undefined,
  paidDaysWindow: r.paid_days_window != null ? Number(r.paid_days_window) : undefined,
  priorBalance: r.prior_balance != null ? Number(r.prior_balance) : undefined,
  discountTotal: r.discount_total != null ? Number(r.discount_total) : undefined,
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
  nameMismatchFlag: !!r.name_mismatch_flag,
  cardholderName: r.cardholder_name ?? undefined,
  cardholderPhone: r.cardholder_phone ?? undefined,
  cardholderRelationship: r.cardholder_relationship ?? undefined,
  cardholderLicenseUrl: r.cardholder_license_url ?? undefined,
  cardholderVerifiedAt: r.cardholder_verified_at ?? undefined,
  verificationStatus: r.verification_status ?? undefined,
  extensions: exts.filter(e => e.rental_id === r.id).map(fromExt),
  swapHistory: Array.isArray(r.swap_history) ? r.swap_history : [],
  lastAutoRenewDate: r.last_auto_renew_date ?? undefined,
  extensionDeclinedAt: r.extension_declined_at ?? undefined,
  accidentReport: r.accident_report ?? undefined,
  accidentToken: r.accident_token ?? undefined,
});
const toRental = (r: any) => ({
  id: r.id, vehicle_id: r.vehicleId, driver_id: r.driverId,
  start_date: r.startDate, end_date: r.endDate ?? null,
  weekly_rate: r.weeklyRate, deposit_paid: r.depositPaid,
  payment_status: r.paymentStatus, notes: r.notes ?? null,
  notes_updated_at: r.notesUpdatedAt ?? null,
  billing_period: r.billingPeriod ?? null, rate: r.rate ?? null,
  paid_days_window: r.paidDaysWindow ?? 2,
  prior_balance: r.priorBalance ?? 0,
  discount_total: r.discountTotal ?? 0,
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
  swap_history: r.swapHistory ?? [],
  last_auto_renew_date: r.lastAutoRenewDate ?? null,
  extension_declined_at: r.extensionDeclinedAt ?? null,
  accident_report: r.accidentReport ?? null,
  accident_token: r.accidentToken ?? null,
}) as any;
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
  kind: r.kind ?? "charge",
});
const toPayment = (p: Payment) => ({
  id: p.id, rental_id: p.rentalId, driver_id: p.driverId,
  amount: p.amount, due_date: p.dueDate, paid_date: p.paidDate ?? null,
  method: p.method ?? null, status: p.status,
  kind: p.kind ?? "charge",
});

/** An admin/renter extension that has been created/signed but NOT yet paid.
 *  These represent outstanding balance the renter still owes for an extension. */
export interface PendingExtension {
  id: string;
  rentalId: string;
  additionalAmount: number;
  status: string;
  newEndDate: string | null;
  expiresAt: string | null;
  signedAt: string | null;
}
export const pendingExtensions: PendingExtension[] = [];
const fromPendingExt = (r: any): PendingExtension => ({
  id: r.id,
  rentalId: r.rental_id,
  additionalAmount: Number(r.additional_amount ?? 0),
  status: r.status,
  newEndDate: r.new_end_date ?? null,
  expiresAt: r.expires_at ?? null,
  signedAt: r.signed_at ?? null,
});

/** Total still-owed for unpaid extensions on a rental.
 *
 *  By default this counts only extensions that have actually been SIGNED /
 *  activated — unsigned offers are not a real balance (this is what prevents
 *  the phantom-balance bug on returned reservations).
 *
 *  When `includePending` is set (used for active, not-yet-returned rentals),
 *  a SENT-but-unsigned extension is also counted: the renter still has the
 *  car past the period that was paid for, so the extension amount is owed.
 *
 *  Duplicate requests for the same new end date (e.g. the offer was sent
 *  several times) are de-duplicated so the balance reflects a single week. */
export function unpaidExtensionTotal(
  rentalId: string,
  opts: { includePending?: boolean } = {},
): number {
  const now = Date.now();
  const eligible = pendingExtensions.filter(e => {
    if (e.rentalId !== rentalId) return false;
    const st = (e.status ?? "").toLowerCase();
    if (st === "paid") return false;
    if (st.includes("refund") || st.includes("cancel") || st.includes("expired")) return false;
    if (e.expiresAt && new Date(e.expiresAt).getTime() <= now) return false;
    const signedOrActive = !!e.signedAt || st === "signed" || st === "active";
    if (signedOrActive) return true;
    // Unsigned "pending" offers only count when explicitly requested.
    return !!opts.includePending;
  });

  // De-duplicate: the same renewal can be represented by multiple requests
  // (offer re-sent) and/or a signed + pending pair. Collapse by the new end
  // date, keeping the largest amount for that date.
  const byPeriod = new Map<string, number>();
  for (const e of eligible) {
    const key = e.newEndDate ?? e.id;
    byPeriod.set(key, Math.max(byPeriod.get(key) ?? 0, e.additionalAmount || 0));
  }
  return Array.from(byPeriod.values()).reduce((s, v) => s + v, 0);
}

/** Signature status for the most recent extension agreement on a rental.
 *  This is purely an "on file" record — it does NOT gate the balance, which
 *  already reflects the time the car is out (see unpaidExtensionTotal). */
export function extensionSignatureStatus(
  rentalId: string,
): { state: "none" | "sent" | "signed"; label: string; date: string | null } {
  const mine = pendingExtensions
    .filter(e => e.rentalId === rentalId)
    .filter(e => {
      const st = (e.status ?? "").toLowerCase();
      return !st.includes("cancel") && !st.includes("expired");
    });
  if (mine.length === 0) return { state: "none", label: "Not sent", date: null };
  const signed = mine.find(e => !!e.signedAt || (e.status ?? "").toLowerCase() === "signed");
  if (signed) return { state: "signed", label: "Signed", date: signed.signedAt ?? null };
  return { state: "sent", label: "Sent — awaiting signature", date: null };
}

/** Overpayment credit on file for a rental: the sum of paid receipts that
 *  represent money received beyond what was owed (kind === "credit"). This is
 *  display-only — it is never auto-applied to future charges. */
export function rentalCredit(rentalId: string): number {
  return payments
    .filter(p => p.rentalId === rentalId && p.status === "paid" && p.kind === "credit")
    .reduce((s, p) => s + Number(p.amount || 0), 0);
}

/** Unpaid violation charges tied to a reservation. Counts toward balance per
 *  the canonical rule: violations(unpaid) add to balance due. */
const VIOLATION_PAID_STATES = new Set(["paid", "dismissed", "waived", "cancelled", "canceled", "resolved", "closed", "refunded"]);
export function rentalViolationsUnpaid(rentalId: string): number {
  return violations
    .filter(v => v.rentalId === rentalId)
    .filter(v => !v.paidAt && !VIOLATION_PAID_STATES.has(String(v.status ?? "").toLowerCase()))
    .reduce((s, v) => s + Number(v.totalAmount ?? v.amount ?? 0), 0);
}

/* ===========================================================================
 * CANONICAL BALANCE ENGINE — single source of truth
 *
 * Balance due = base rental owed for the time the car is actually out
 *             − every payment received (base + extension + any other)
 *
 *   • "Time actually out" runs from the start date to TODAY while the car is
 *     still out, and to the RETURN date once it is back. It keeps accruing
 *     day-by-day (daily plans) or week-by-week (weekly plans) until return.
 *   • The time charge already INCLUDES any extension time, so extension
 *     periods are never added a second time (that was the old double-count /
 *     phantom-balance bug). Extension PAYMENTS are subtracted like any other
 *     payment, so a paid extension nets to zero.
 *   • Violations are NEVER part of this number — see rentalViolationsUnpaid().
 * ========================================================================= */

/** Period rate + cadence for a rental. Weekly unless billingPeriod is daily. */
export function rentalPeriodRate(r: Rental): { rate: number; weekly: boolean } {
  const weekly = String(r.billingPeriod ?? "").toLowerCase() !== "daily";
  const rate = weekly
    ? (Number(r.weeklyRate) || Number(r.rate) || 0)
    : (Number(r.rate) || Number(r.weeklyRate) || 0);
  return { rate, weekly };
}

const DAY_MS = 86400000;

/** Default initial deposit-covered days for a daily rental. */
const DEFAULT_PAID_DAYS_WINDOW = 2;

/** Whole days from `a` to `b` (b − a), zero-clamped. */
function daysBetweenISO(a: string, b: string): number {
  const d = Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY_MS,
  );
  return d;
}

/** The date through which charges accrue: today while the car is still out,
 *  or the return date once it is back. Accrual stops ONLY on return. */
function rentalThroughDate(r: Rental): string {
  const rs = r.reservationStatus ?? "active";
  const today = new Date().toISOString().slice(0, 10);
  const returned = rs === "returned" || rs === "completed" || !!r.returnedAt;
  return (returned ? (r.returnedAt ?? r.endDate ?? today) : today).slice(0, 10);
}

/** Daily paid-days window (deposit-covered days), default 2. */
export function rentalPaidDaysWindow(r: Rental): number {
  const w = Number(r.paidDaysWindow);
  return Number.isFinite(w) && w >= 0 ? w : DEFAULT_PAID_DAYS_WINDOW;
}

/** Number of billing periods that have POSTED as owed, purely from elapsed
 *  possession vs. today's date. Extension rows are NEVER read for money.
 *
 *  WEEKLY: week 1 posts on the start day (first 7 days); each later week posts
 *  on its 8th morning. posted = floor(daysOut / 7) + 1.
 *  DAILY: the first `paidDaysWindow` days are covered by the deposit and post
 *  $0; from the morning after the window, one day posts each morning.
 *  posted = max(0, daysOutInclusive − window).
 *  Accrual stops at the return date. */
export function rentalPostedPeriods(r: Rental): { periods: number; rate: number; weekly: boolean } {
  const { rate, weekly } = rentalPeriodRate(r);
  const rs = r.reservationStatus ?? "active";
  if (rs === "pending" || !r.startDate || rate <= 0) return { periods: 0, rate, weekly };
  const start = r.startDate.slice(0, 10);
  const through = rentalThroughDate(r);
  const days = daysBetweenISO(start, through);
  if (days < 0) return { periods: 0, rate, weekly };
  if (weekly) return { periods: Math.floor(days / 7) + 1, rate, weekly };
  const window = rentalPaidDaysWindow(r);
  const daysOutInclusive = days + 1;
  return { periods: Math.max(0, daysOutInclusive - window), rate, weekly };
}

/** Base rental owed for the time the car is actually out.
 *  Possession + elapsed time is the ONLY money trigger. Extension records
 *  (signed, unsigned, or absent) contribute $0 — they are paperwork only. */
export function rentalTimeCharge(r: Rental): number {
  const { periods, rate } = rentalPostedPeriods(r);
  return periods * rate;
}

/** Sum of every payment received against a rental (excludes credit rows). */
export function rentalPaymentsReceived(rentalId: string): number {
  return payments
    .filter(p => p.rentalId === rentalId && p.status === "paid" && p.kind !== "credit" && p.kind !== "violation")
    .reduce((s, p) => s + Number(p.amount || 0), 0);
}

/** Money received toward violations (kind === "violation"). Tracked on the
 *  account but never offsets rent due — shown as its own figure. */
export function rentalViolationPaymentsReceived(rentalId: string): number {
  return payments
    .filter(p => p.rentalId === rentalId && p.status === "paid" && p.kind === "violation")
    .reduce((s, p) => s + Number(p.amount || 0), 0);
}

/** Documented prior balance carried forward from a previous rental that was
 *  not entered at booking. Adds to the amount owed. Display + engine only. */
export function rentalPriorBalance(r: Rental): number {
  return Number(r.priorBalance || 0);
}

/** Total goodwill discount / waived balance applied to a rental. Reduces the
 *  amount owed in the canonical engine without being booked as cash revenue. */
export function rentalDiscountTotal(r: Rental): number {
  return Number(r.discountTotal || 0);
}

/** Canonical amount owed: time charge + prior balance − payments received − discounts. */
export function rentalCanonicalOwed(r: Rental): number {
  if ((r.reservationStatus ?? "active") === "pending") return 0;
  return (
    rentalTimeCharge(r) +
    rentalPriorBalance(r) -
    rentalPaymentsReceived(r.id) -
    rentalDiscountTotal(r)
  );
}

/** Due date of the earliest billing period not yet covered by payments.
 *  Derived from the canonical engine (payments received ÷ period rate), so it
 *  never disagrees with the balance shown to the user. */
export function rentalNextDueDate(r: Rental): string {
  const start = r.startDate?.slice(0, 10) ?? "";
  const { rate, weekly } = rentalPeriodRate(r);
  if (!start || rate <= 0) return r.currentPeriodEnd ?? start;
  const received = rentalPaymentsReceived(r.id);
  const periodsCovered = Math.max(0, Math.floor(received / rate));
  const d = new Date(start + "T00:00:00Z");
  if (weekly) {
    // Next unpaid week posts on its posting morning (start + 7×covered).
    d.setUTCDate(d.getUTCDate() + periodsCovered * 7);
  } else {
    // Daily: the first `window` days are deposit-covered; the next unpaid
    // posted day falls after the window plus whatever payments already cover.
    d.setUTCDate(d.getUTCDate() + rentalPaidDaysWindow(r) + periodsCovered);
  }
  return d.toISOString().slice(0, 10);
}

/** Whole days a rental is past due, from the canonical engine.
 *  Returns 0 when nothing is owed or the current period is not yet due. */
export function rentalPastDueDays(r: Rental): number {
  if (rentalCanonicalOwed(r) <= 0) return 0;
  const due = rentalNextDueDate(r);
  const today = new Date().toISOString().slice(0, 10);
  if (!due || today <= due) return 0;
  return Math.round(
    (Date.parse(today + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / DAY_MS,
  );
}

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
  maintenanceId: r.maintenance_id ?? undefined,
  paymentMethod: r.payment_method ?? undefined,
  referenceNumber: r.reference_number ?? undefined,
  payrollEmployee: r.payroll_employee ?? undefined,
  payrollPeriodStart: r.payroll_period_start ?? undefined,
  payrollPeriodEnd: r.payroll_period_end ?? undefined,
  payrollHours: r.payroll_hours == null ? undefined : Number(r.payroll_hours),
  payrollRate: r.payroll_rate == null ? undefined : Number(r.payroll_rate),
});
const toExpense = (e: Expense) => ({
  id: e.id, category: e.category, amount: e.amount, date: e.date,
  vendor: e.vendor ?? null, vehicle_id: e.vehicleId ?? null,
  notes: e.notes ?? null, receipt_url: e.receiptUrl ?? null,
  maintenance_id: e.maintenanceId ?? null,
  payment_method: e.paymentMethod ?? null,
  reference_number: e.referenceNumber ?? null,
  payroll_employee: e.payrollEmployee ?? null,
  payroll_period_start: e.payrollPeriodStart ?? null,
  payroll_period_end: e.payrollPeriodEnd ?? null,
  payroll_hours: e.payrollHours ?? null,
  payroll_rate: e.payrollRate ?? null,
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
  rentalId: r.rental_id ?? undefined,
  type: r.type, amount: Number(r.amount),
  totalAmount: r.total_amount != null ? Number(r.total_amount) : undefined,
  paidAt: r.paid_at ?? undefined,
  dateIssued: r.date_issued,
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
  sourceWorkOrderId: r.source_work_order_id ?? undefined,
  createdAt: r.created_at ?? undefined,
  status: r.status ?? undefined,
  issueDescription: r.issue_description ?? undefined,
  customerNotes: r.customer_notes ?? undefined,
  problemCategory: r.problem_category ?? undefined,
  diagnosisNotes: r.diagnosis_notes ?? undefined,
  diagnosisTitle: r.diagnosis_title ?? undefined,
  originalIssueId: r.original_issue_id ?? undefined,
  splitIndex: r.split_index != null ? Number(r.split_index) : undefined,
  splitTotal: r.split_total != null ? Number(r.split_total) : undefined,
  createdFromIssue: !!r.created_from_issue,
  solutions: r.solutions ?? undefined,
  selectedSolution: r.selected_solution ?? undefined,
  downPayment: r.down_payment != null ? Number(r.down_payment) : undefined,
  amountPaid: r.amount_paid != null ? Number(r.amount_paid) : undefined,
  balance: r.balance != null ? Number(r.balance) : undefined,
  completionDate: r.completion_date ?? undefined,
  isRentalBlocking: !!r.is_rental_blocking,
  partsCost: r.parts_cost != null ? Number(r.parts_cost) : undefined,
  laborCost: r.labor_cost != null ? Number(r.labor_cost) : undefined,
  mechanicNotes: r.mechanic_notes ?? undefined,
  mechanicName: r.mechanic_name ?? undefined,
  runnerId: r.runner_id ?? undefined,
  repairRequestNotes: r.repair_request_notes ?? undefined,
  approvalStatus: r.approval_status ?? undefined,
  approvalDate: r.approval_date ?? undefined,
  approvedBy: r.approved_by ?? undefined,
  source: r.source ?? undefined,
  inspectionId: r.inspection_id ?? undefined,
  depositRequired: r.deposit_required != null ? Number(r.deposit_required) : undefined,
  depositAmount: r.deposit_amount != null ? Number(r.deposit_amount) : undefined,
  depositProcessed: !!r.deposit_processed,
  depositDate: r.deposit_date ?? undefined,
});
const toMaintenance = (m: Maintenance) => ({
  id: m.id, vehicle_id: m.vehicleId, service_type: m.serviceType,
  vendor: m.vendor, date_completed: m.dateCompleted,
  mileage_at_service: m.mileageAtService, cost: m.cost,
  next_service_due: m.nextServiceDue, notes: m.notes ?? null,
  completed_by: m.completedBy ?? null,
  status: m.status ?? null,
  issue_description: m.issueDescription ?? null,
  customer_notes: m.customerNotes ?? null,
  problem_category: m.problemCategory ?? null,
  diagnosis_notes: m.diagnosisNotes ?? null,
  diagnosis_title: m.diagnosisTitle ?? null,
  original_issue_id: m.originalIssueId ?? null,
  split_index: m.splitIndex ?? null,
  split_total: m.splitTotal ?? null,
  created_from_issue: m.createdFromIssue ?? false,
  solutions: (m.solutions ?? null) as any,
  selected_solution: (m.selectedSolution ?? null) as any,
  down_payment: m.downPayment ?? 0,
  amount_paid: m.amountPaid ?? 0,
  balance: m.balance ?? 0,
  completion_date: m.completionDate ?? null,
  is_rental_blocking: m.isRentalBlocking ?? false,
  parts_cost: m.partsCost ?? 0,
  labor_cost: m.laborCost ?? 0,
  mechanic_notes: m.mechanicNotes ?? null,
  mechanic_name: m.mechanicName ?? null,
  runner_id: m.runnerId ?? null,
  repair_request_notes: m.repairRequestNotes ?? null,
  approval_status: m.approvalStatus ?? null,
  approval_date: m.approvalDate ?? null,
  approved_by: m.approvedBy ?? null,
  source: m.source ?? "manual_report",
  inspection_id: m.inspectionId ?? null,
  source_work_order_id: m.sourceWorkOrderId ?? null,
  deposit_required: m.depositRequired ?? 0,
  deposit_amount: m.depositAmount ?? 0,
  deposit_processed: m.depositProcessed ?? false,
  deposit_date: m.depositDate ?? null,
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
    // Load unpaid extension requests so the dashboard balance reflects
    // amounts a renter still owes for an extension (best-effort: only
    // admins/runners can read this table, so ignore errors for others).
    try {
      const exr = await supabase
        .from("extension_requests")
        .select("id, rental_id, additional_amount, status, new_end_date, expires_at");
      if (!exr.error) {
        replaceArray(pendingExtensions, (exr.data ?? []).map(fromPendingExt));
      }
    } catch (e) {
      console.error("[cloud:hydrate] extension_requests", e);
    }
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
    .on("postgres_changes", { event: "*", schema: "public", table: "extension_requests" }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as any).id;
        const idx = pendingExtensions.findIndex(x => x.id === id);
        if (idx >= 0) pendingExtensions.splice(idx, 1);
      } else {
        const next = fromPendingExt(payload.new);
        const idx = pendingExtensions.findIndex(x => x.id === next.id);
        if (idx >= 0) pendingExtensions[idx] = next; else pendingExtensions.push(next);
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
  // Schedule first recurring payment one period out.
  // DAILY rentals collect the first 2 days upfront (1 day when the
  // family-&-friends override is on), so recurring billing only starts the
  // morning AFTER the prepaid days — i.e. the 3rd morning by default.
  const period = rental.billingPeriod ?? "weekly";
  const due = new Date(rental.startDate);
  if (period === "daily") {
    const prepaidDays = rental.skipDailyMinimum ? 1 : 2;
    due.setDate(due.getDate() + prepaidDays);
  } else if (period === "monthly") due.setMonth(due.getMonth() + 1);
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
 * Record a manual payment (cash or off-session card charge) of an arbitrary
 * amount against a rental. The amount is applied across the oldest unpaid
 * scheduled payments first; a partial amount splits the matching payment so
 * the remaining balance stays outstanding. Any leftover (first-payment capture
 * on a pending reservation, or an overpayment) is recorded as a standalone
 * paid receipt. Paid receipts flow straight into Payments + P&L revenue.
 */
export function recordManualPayment(
  rentalId: string,
  amount: number,
  method: NonNullable<Payment["method"]>,
  paidDate?: string,
): { activated: boolean; fullyPaid: boolean } {
  const r = rentals.find(r => r.id === rentalId);
  if (!r || !(amount > 0)) return { activated: false, fullyPaid: false };
  const date = paidDate || new Date().toISOString().slice(0, 10);

  let remaining = amount;
  const unpaid = payments
    .filter(p => p.rentalId === r.id && p.status !== "paid")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  for (const p of unpaid) {
    if (remaining <= 0) break;
    const owed = Number(p.amount || 0);
    if (remaining >= owed) {
      p.status = "paid";
      p.method = method;
      p.paidDate = date;
      cloudWrite("payment:update", supabase.from("payments").update(toPayment(p)).eq("id", p.id));
      remaining -= owed;
    } else {
      // Partial: keep the outstanding balance on the original record and add a
      // separate paid record for the portion received.
      p.amount = owed - remaining;
      cloudWrite("payment:update", supabase.from("payments").update(toPayment(p)).eq("id", p.id));
      const part: Payment = {
        id: nextPaymentId(), rentalId: r.id, driverId: r.driverId,
        amount: remaining, dueDate: p.dueDate, paidDate: date, method, status: "paid",
      };
      payments.push(part);
      cloudWrite("payment:insert", supabase.from("payments").insert(toPayment(part)));
      remaining = 0;
    }
  }

  if (remaining > 0) {
    const extra: Payment = {
      id: nextPaymentId(), rentalId: r.id, driverId: r.driverId,
      amount: remaining, dueDate: date, paidDate: date, method, status: "paid",
      kind: "credit",
    };
    payments.push(extra);
    cloudWrite("payment:insert", supabase.from("payments").insert(toPayment(extra)));
  }

  // First money in marks the reservation paid and activates a pending hold.
  let activated = false;
  if (!r.paymentReceived) {
    r.paymentReceived = true;
    activated = tryActivate(r);
    cloudWrite("rental:update", supabase.from("rentals").update(toRental(r)).eq("id", r.id));
  }

  emit();
  const fullyPaid = !payments.some(p => p.rentalId === r.id && p.status !== "paid");
  return { activated, fullyPaid };
}

/**
 * Apply a discount / balance adjustment to a reservation by reducing the
 * outstanding (unpaid) scheduled payments. Reduces oldest-due unpaid records
 * first. Returns the amount actually discounted. Use this for goodwill
 * discounts on past-due balances or to manually lower the balance owed.
 */
export function applyDiscount(
  rentalId: string,
  amount: number,
  note?: string,
): { discounted: number; fullyPaid: boolean } {
  const r = rentals.find(r => r.id === rentalId);
  if (!r || !(amount > 0)) return { discounted: 0, fullyPaid: false };
  const date = new Date().toISOString().slice(0, 10);

  // The canonical balance engine derives "owed" from elapsed time minus
  // payments minus discounts — it does NOT read scheduled-payment rows. So a
  // discount must be recorded against the rental's discountTotal to actually
  // lower the balance (the old approach edited unpaid payment rows, which the
  // engine ignored — that's why waived balances kept reappearing).
  const owedBefore = Math.max(0, rentalCanonicalOwed(r));
  const discounted = Math.min(amount, owedBefore);
  if (discounted <= 0) return { discounted: 0, fullyPaid: rentalCanonicalOwed(r) <= 0 };

  r.discountTotal = Number(r.discountTotal || 0) + discounted;
  r.notes = `${r.notes ? `${r.notes}\n` : ""}[${date}] Discount $${discounted.toFixed(2)}${note ? `: ${note}` : ""}`;

  const fullyPaid = rentalCanonicalOwed(r) <= 0;
  // Clearing the balance must also clear any past-due status so the
  // reservation no longer shows "Past Due".
  if (fullyPaid && (r.paymentStatus === "late" || r.paymentStatus === "defaulted")) {
    r.paymentStatus = "current";
  }

  cloudWrite("rental:update", supabase.from("rentals").update(toRental(r)).eq("id", r.id));
  emit();
  return { discounted, fullyPaid };
}

/**
 * Has the renter paid for the current billing period?
 * - Pending reservations: true once paymentReceived flag is set (first-week capture).
 * - Active reservations: true when no unpaid payment has a due date BEFORE today
 *   (a payment due today is not yet late).
 * - Completed (returned) rentals: always considered paid.
 */
export function currentPeriodPaid(rental: Rental): boolean {
  if (rental.endDate) return true;
  if ((rental.reservationStatus ?? "active") === "pending") return !!rental.paymentReceived;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = payments.some(
    p => p.rentalId === rental.id && p.status !== "paid" && p.dueDate < today,
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

/** Save (or clear) the accident report on a reservation. */
export function saveAccidentReport(id: string, report: import("@/lib/mock/data").AccidentReport | undefined) {
  const r = rentals.find(r => r.id === id);
  if (!r) return;
  r.accidentReport = report;
  cloudWrite("rental:update", supabase.from("rentals").update({ accident_report: report ?? null } as any).eq("id", r.id));
  emit();
}

/** Ensure a shareable accident-intake token exists; returns the token. */
export function ensureAccidentToken(id: string): string | undefined {
  const r = rentals.find(r => r.id === id);
  if (!r) return undefined;
  if (!r.accidentToken) {
    const token = `acc_${(crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "")}`;
    r.accidentToken = token;
    cloudWrite("rental:update", supabase.from("rentals").update({ accident_token: token } as any).eq("id", r.id));
    emit();
  }
  return r.accidentToken;
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
export function swapVehicle(rentalId: string, newVehicleId: string, reason?: string, swappedBy?: string) {
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
  const oldLabel = oldV ? `${oldV.year} ${oldV.make} ${oldV.model}${oldV.plate ? ` (${oldV.plate})` : ""}` : oldVehicleId;
  const newLabel = `${newV.year} ${newV.make} ${newV.model}${newV.plate ? ` (${newV.plate})` : ""}`;
  const swap = {
    id: `SWP-${stamp.replace(/[^0-9]/g, "").slice(0, 14)}`,
    swappedAt: stamp,
    oldVehicleId,
    newVehicleId,
    oldVehicleLabel: oldLabel,
    newVehicleLabel: newLabel,
    reason: reason || undefined,
    swappedBy: swappedBy || undefined,
  };
  r.swapHistory = [...(r.swapHistory ?? []), swap];
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

/** Delete a PENDING (unsigned) extension record. Signed extensions are kept
 *  as history and cannot be deleted here. Because extensions no longer move
 *  money (possession + elapsed time is the only money trigger), deleting one
 *  shifts no balance — it only removes the paperwork and voids any open
 *  payment link / request tied to that period. */
export function deletePendingExtension(rentalId: string, extId: string) {
  const r = rentals.find(x => x.id === rentalId);
  if (!r) return;
  const ext = (r.extensions ?? []).find(e => e.id === extId);
  if (!ext) return;
  const signed = !!ext.signedBy || !!ext.signatureDataUrl;
  if (signed) throw new Error("Signed extensions are kept as history and cannot be deleted.");

  // Remove the extension log row.
  r.extensions = (r.extensions ?? []).filter(e => e.id !== extId);
  cloudWrite("ext:delete", supabase.from("rental_extensions").delete().eq("id", extId));

  // Void the unpaid charge placeholder created for this extension, if any.
  if (ext.paymentId) {
    const pid = ext.paymentId;
    const idx = payments.findIndex(p => p.id === pid && p.status !== "paid");
    if (idx >= 0) {
      payments.splice(idx, 1);
      cloudWrite("payment:delete", supabase.from("payments").delete().eq("id", pid).neq("status", "paid"));
    }
  }

  // Void any open extension_requests payment link for the same new end date.
  cloudWrite(
    "ext-req:cancel",
    supabase.from("extension_requests")
      .update({ status: "cancelled" } as any)
      .eq("rental_id", rentalId)
      .eq("new_end_date", ext.newEndDate)
      .neq("status", "paid"),
  );
  for (const pe of pendingExtensions) {
    if (pe.rentalId === rentalId && pe.newEndDate === ext.newEndDate && (pe.status ?? "").toLowerCase() !== "paid") {
      pe.status = "cancelled";
    }
  }

  emit();
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
  return _setVehicleAvailabilityOverride(vehicleId, available, reason);
}

/** Mark a computed scheduled-maintenance item as done by resetting its
 * "last done" marker on the vehicle's Alert Settings. Clears the alert. */
export function markScheduledComplete(
  vehicleId: string,
  type: "oil" | "battery" | "alternator" | "inspection" | "custom",
  customId?: string,
) {
  const v = vehicles.find(x => x.id === vehicleId);
  if (!v) return Promise.reject(new Error("Vehicle not found"));
  const today = new Date().toISOString().slice(0, 10);
  const s = { ...(v.maintenanceSettings ?? {}) };
  if (type === "oil") {
    const oc = { ...(s.oilChange ?? { mode: "miles" as const, interval: 0 }) };
    oc.lastMileage = v.mileage;
    oc.lastDate = today;
    s.oilChange = oc;
  } else if (type === "battery") {
    s.batteryLastDone = today;
  } else if (type === "alternator") {
    s.alternatorLastDone = today;
  } else if (type === "inspection") {
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);
    s.inspectionExpiry = next.toISOString().slice(0, 10);
  } else if (type === "custom" && customId) {
    s.customAlerts = (s.customAlerts ?? []).map(c =>
      c.id === customId ? { ...c, lastDate: today } : c,
    );
  }
  return updateVehicle(vehicleId, { maintenanceSettings: s });
}

function _setVehicleAvailabilityOverride(vehicleId: string, available: boolean, reason?: string) {
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
  if (fields.licenseImageUrl !== undefined) patch.license_image_url = fields.licenseImageUrl ?? null;
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
  applyOdometerReading(input.vehicleId, input.mileage);
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

/** Does an open maintenance/repair row block the vehicle from new bookings?
 *  - Repair rows (status set) block ONLY when isRentalBlocking is true.
 *  - Legacy non-repair open issues (no status) keep blocking by default. */
function maintenanceBlocksVehicle(m: Maintenance): boolean {
  if (m.dateCompleted) return false;
  if (m.status === "complete") return false;
  if (m.status) return !!m.isRentalBlocking;
  return true;
}

/** Recompute the local vehicle.hasOpenIssues flag from open maintenance
 *  tickets. The DB keeps the persisted flag in sync via triggers; this
 *  mirrors it in-memory so the UI reflects the change immediately. */
function syncVehicleOpenIssues(vehicleId: string) {
  const v = vehicles.find(x => x.id === vehicleId);
  if (!v) return;
  const open = maintenance.some(m => m.vehicleId === vehicleId && maintenanceBlocksVehicle(m));
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

/** Update a vehicle's current mileage from the latest odometer reading captured
 *  during an inspection or maintenance/service entry. The most recent reading
 *  always wins (a newly entered reading is treated as the current truth), so a
 *  stray high value can be corrected by simply logging the real number again. */
function applyOdometerReading(vehicleId: string, mileage?: number | null) {
  if (typeof mileage !== "number" || !Number.isFinite(mileage) || mileage <= 0) return;
  const v = vehicles.find(x => x.id === vehicleId);
  if (!v || v.mileage === mileage) return;
  v.mileage = mileage;
  cloudWrite("vehicle:update", supabase.from("vehicles").update({ mileage }).eq("id", v.id));
}

export function addMaintenance(input: Omit<Maintenance, "id">) {
  const rec: Maintenance = { id: nextMaintenanceId(), ...input };
  maintenance.push(rec);
  cloudWrite("maintenance:insert", supabase.from("maintenance").insert(toMaintenance(rec)));
  const v = vehicles.find(v => v.id === input.vehicleId);
  if (v) {
    applyOdometerReading(v.id, input.mileageAtService);
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
  if (patch.mileageAtService !== undefined) applyOdometerReading(m.vehicleId, patch.mileageAtService);
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
// Repairs kanban (Open → In Progress → Complete)
// Repairs are maintenance rows with a non-null `status`. They stay "open"
// (no date_completed) so the vehicle is flagged unavailable until completed.
// ---------------------------------------------------------------------------
export function createRepair(input: {
  vehicleId: string;
  issueDescription: string;
  solutions: RepairSolution[];
  problemCategory?: string;
}) {
  const v = vehicles.find(x => x.id === input.vehicleId);
  const rec: Maintenance = {
    id: nextMaintenanceId(),
    vehicleId: input.vehicleId,
    serviceType: input.issueDescription,
    issueDescription: input.issueDescription,
    problemCategory: input.problemCategory,
    solutions: input.solutions,
    vendor: "Pending assignment",
    dateCompleted: undefined as unknown as string,
    mileageAtService: v?.mileage ?? 0,
    cost: 0,
    nextServiceDue: new Date().toISOString().slice(0, 10),
    status: "open",
    downPayment: 0,
    amountPaid: 0,
    balance: 0,
    createdAt: new Date().toISOString(),
  };
  maintenance.push(rec);
  cloudWrite("maintenance:insert", supabase.from("maintenance").insert(toMaintenance(rec)));
  if (v) syncVehicleOpenIssues(v.id);
  emit();
  return rec;
}

/** Open → In Progress: admin picks a solution and (optionally) a down payment. */
export function selectRepairSolution(id: string, solution: RepairSolution, downPayment = 0) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  const dp = Math.max(0, downPayment || 0);
  m.status = "in_progress";
  m.selectedSolution = solution;
  m.cost = solution.totalCost;
  m.downPayment = dp;
  m.amountPaid = dp;
  m.balance = Math.max(0, solution.totalCost - dp);
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  if (dp > 0) {
    addExpense({
      category: "Maintenance",
      amount: dp,
      date: new Date().toISOString().slice(0, 10),
      vehicleId: m.vehicleId,
      notes: `Down payment for repair ${m.id} — ${solution.name}`,
    });
  }
  emit();
}

/** In Progress: record an additional payment toward the repair. */
export function recordRepairPayment(id: string, amount: number) {
  const m = maintenance.find(x => x.id === id);
  if (!m || !m.selectedSolution) return;
  const amt = Math.max(0, amount || 0);
  if (amt <= 0) return;
  m.amountPaid = (m.amountPaid ?? 0) + amt;
  m.balance = Math.max(0, (m.selectedSolution.totalCost) - m.amountPaid);
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  addExpense({
    category: "Maintenance",
    amount: amt,
    date: new Date().toISOString().slice(0, 10),
    vehicleId: m.vehicleId,
    notes: `Payment for repair ${m.id} — ${m.selectedSolution.name}`,
  });
  emit();
}

/**
 * In Progress → Complete. Captures the actual parts/labor cost breakdown and
 * the mechanic's work notes. The actual total (parts + labor) becomes the
 * repair cost, and any amount not yet posted to P&L is recorded as a
 * Maintenance expense so the books reflect the full cost exactly once.
 */
/** Summary of everything that changed when a repair was completed. */
export interface ScheduledDueInfo { type: string; label: string; dueDate?: string; dueMileage?: number; }
export interface RepairCompletionSummary {
  maintenanceId: string;
  vehicleId: string;
  vehicleLabel: string;
  vehiclePlate?: string;
  issue: string;
  completedBy: string;
  completionDate: string; // YYYY-MM-DD
  mechanicName?: string;
  parts: number;
  labor: number;
  total: number;
  /** Amount newly posted to P&L at completion (total minus already-expensed). */
  expensePosted: number;
  /** Whether the vehicle is now available for rental. */
  vehicleAvailable: boolean;
  vehicleStatus: string;
  /** The scheduled-maintenance alert that was reset/cleared, if any. */
  alertCleared?: string;
  /** Upcoming scheduled services after the recalculation. */
  nextScheduled: ScheduledDueInfo[];
  /** runner_id of the runner who reported the issue (for notification). */
  runnerId?: string;
}

/** Map a repair's service type / issue text to a scheduled-maintenance key. */
function inferScheduledType(m: Maintenance): "oil" | "battery" | "alternator" | "inspection" | null {
  const hay = `${m.serviceType ?? ""} ${m.issueDescription ?? ""} ${m.selectedSolution?.name ?? ""}`.toLowerCase();
  if (/\boil\b|oil change|oil filter/.test(hay)) return "oil";
  if (/batter/.test(hay)) return "battery";
  if (/alternator/.test(hay)) return "alternator";
  if (/inspect/.test(hay)) return "inspection";
  return null;
}

export function completeRepair(
  id: string,
  opts?: {
    completedBy?: string;
    partsCost?: number;
    laborCost?: number;
    mechanicNotes?: string;
    mechanicName?: string;
  },
): RepairCompletionSummary | undefined {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  const today = new Date().toISOString().slice(0, 10);
  // Payments recorded so far (down payment + any recorded payments) were each
  // already posted to P&L, so only the difference is posted at completion.
  const alreadyExpensed = Math.max(0, m.amountPaid ?? 0);
  const parts = Math.max(0, opts?.partsCost ?? m.partsCost ?? m.selectedSolution?.partsCost ?? 0);
  const labor = Math.max(0, opts?.laborCost ?? m.laborCost ?? m.selectedSolution?.laborCost ?? 0);
  const total = parts + labor;

  m.status = "complete";
  m.partsCost = parts;
  m.laborCost = labor;
  m.cost = total;
  m.balance = 0;
  m.amountPaid = total;
  m.completionDate = new Date().toISOString();
  m.dateCompleted = today;
  if (m.selectedSolution) {
    m.selectedSolution = { ...m.selectedSolution, partsCost: parts, laborCost: labor, totalCost: total };
    m.serviceType = m.selectedSolution.name;
  }
  m.completedBy = opts?.completedBy?.trim() || m.completedBy || "Admin";
  if (opts?.mechanicNotes?.trim()) m.mechanicNotes = opts.mechanicNotes.trim();
  if (opts?.mechanicName?.trim()) m.mechanicName = opts.mechanicName.trim();
  if (m.vendor === "Pending assignment") m.vendor = m.completedBy;

  const resolution = `Repair completed ${today} by ${m.completedBy}: parts $${parts.toFixed(2)} + labor $${labor.toFixed(2)} = $${total.toFixed(2)}`;
  m.notes = m.notes ? `${m.notes}\n\n${resolution}` : resolution;
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));

  // Post the remaining (not-yet-expensed) cost to P&L so the total lands once.
  const remaining = Math.max(0, total - alreadyExpensed);
  const mechanic = m.mechanicName || (m.vendor && m.vendor !== "Pending assignment" ? m.vendor : undefined) || m.completedBy;
  const repairNote = `Repair ${m.id} completed — ${m.serviceType}`;
  if (remaining > 0) {
    if (alreadyExpensed <= 0 && parts > 0 && labor > 0) {
      // No prior payments posted: split into Parts and Labour for clean P&L breakdown.
      addExpense({
        category: "Parts", amount: parts, date: today, vehicleId: m.vehicleId,
        maintenanceId: m.id, vendor: mechanic, notes: `${repairNote} (parts)`,
      });
      addExpense({
        category: "Labour", amount: labor, date: today, vehicleId: m.vehicleId,
        maintenanceId: m.id, vendor: mechanic, notes: `${repairNote} (labour)`,
      });
    } else {
      addExpense({
        category: "Repair & Maintenance",
        amount: remaining,
        date: today,
        vehicleId: m.vehicleId,
        maintenanceId: m.id,
        vendor: mechanic,
        notes: `${repairNote} (parts $${parts.toFixed(2)} + labor $${labor.toFixed(2)})`,
      });
    }
  }

  // --- Log the completed repair to the vehicle's fleet-card repair history,
  //     and capture scorecard analytics data. ---
  const partsList = m.diagnosisNotes ?? null;
  // Log the diagnosis (display title) as the repair history "issue" so the
  // fleet card shows what was repaired, not the raw reported symptom.
  const issueText =
    (m.diagnosisTitle ?? "").trim() ||
    m.selectedSolution?.name ||
    m.issueDescription ||
    m.serviceType;
  let daysInRepair = 0;
  if (m.createdAt) {
    const start = new Date(m.createdAt).getTime();
    daysInRepair = Math.max(0, Math.round((Date.now() - start) / 86400000));
  }
  const issueCategory = inferScheduledType(m) ?? "general";
  cloudWrite(
    "repair_history:insert",
    supabase.from("repair_history").insert({
      vehicle_id: m.vehicleId,
      maintenance_id: m.id,
      repair_date: today,
      issue: issueText,
      parts: typeof partsList === "string" ? partsList : null,
      parts_cost: parts,
      labor_cost: labor,
      total_cost: total,
      mechanic_name: m.mechanicName ?? null,
      completed_by: m.completedBy ?? "Admin",
      notes: m.mechanicNotes ?? m.notes ?? null,
    } as never),
  );
  cloudWrite(
    "repair_scorecard:insert",
    supabase.from("repair_scorecard").insert({
      vehicle_id: m.vehicleId,
      maintenance_id: m.id,
      repair_date: today,
      cost: total,
      issue_category: issueCategory,
      days_in_repair: daysInRepair,
    } as never),
  );

  // --- Reset the related scheduled-maintenance marker so the alert clears
  //     and the next due date recalculates from today. ---
  const v = vehicles.find(x => x.id === m.vehicleId);
  let alertCleared: string | undefined;
  if (v) {
    const sType = inferScheduledType(m);
    if (sType) {
      const s = { ...(v.maintenanceSettings ?? {}) };
      if (sType === "oil") {
        const oc = { ...(s.oilChange ?? { mode: "miles" as const, interval: 0 }) };
        oc.lastMileage = v.mileage;
        oc.lastDate = today;
        s.oilChange = oc;
        alertCleared = "Oil change";
      } else if (sType === "battery") {
        s.batteryLastDone = today;
        alertCleared = "Battery test";
      } else if (sType === "alternator") {
        s.alternatorLastDone = today;
        alertCleared = "Alternator test";
      } else if (sType === "inspection") {
        const next = new Date();
        next.setFullYear(next.getFullYear() + 1);
        s.inspectionExpiry = next.toISOString().slice(0, 10);
        alertCleared = "Inspection";
      }
      v.maintenanceSettings = s;
      cloudWrite("vehicle:update", supabase.from("vehicles").update({ maintenance_settings: s as never }).eq("id", v.id));
    }
  }

  syncVehicleOpenIssues(m.vehicleId);
  emit();

  const vNow = vehicles.find(x => x.id === m.vehicleId);
  const nextScheduled: ScheduledDueInfo[] = vNow
    ? computeScheduledItems(vNow).map((it: ScheduledItem) => ({
        type: it.type,
        label: it.label,
        dueDate: it.dueDate,
        dueMileage: it.dueMileage,
      }))
    : [];

  return {
    maintenanceId: m.id,
    vehicleId: m.vehicleId,
    vehicleLabel: vNow ? `${vNow.year} ${vNow.make} ${vNow.model}` : m.vehicleId,
    vehiclePlate: vNow?.plate,
    issue: m.issueDescription || m.selectedSolution?.name || m.serviceType,
    completedBy: m.completedBy ?? "Admin",
    completionDate: today,
    mechanicName: m.mechanicName,
    parts,
    labor,
    total,
    expensePosted: remaining,
    vehicleAvailable: vNow?.status === "available",
    vehicleStatus: vNow?.status ?? "—",
    alertCleared,
    nextScheduled,
    runnerId: m.runnerId,
  };
}

/** Toggle whether an open repair blocks the vehicle from new bookings. */
export function setRepairRentalBlocking(id: string, blocking: boolean) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  m.isRentalBlocking = blocking;
  cloudWrite(
    "maintenance:update",
    supabase.from("maintenance").update({ is_rental_blocking: blocking }).eq("id", id),
  );
  syncVehicleOpenIssues(m.vehicleId);
  emit();
}

/** Open (non-completed) repairs for a vehicle, most recent first. */
export function openRepairsForVehicle(vehicleId: string): Maintenance[] {
  return maintenance
    .filter(m => m.vehicleId === vehicleId && !!m.status && m.status !== "complete" && !m.dateCompleted)
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));
}

// ---------------------------------------------------------------------------
// Runner repair requests (pending admin approval)
// Tickets created by a runner from a failed inspection item land here with
// approval_status = "pending". They are kept OUT of the Repairs kanban until
// an admin approves them.
// ---------------------------------------------------------------------------
/** Pending runner repair requests awaiting admin approval, newest first. */
export function pendingRunnerRepairs(): Maintenance[] {
  return maintenance
    .filter(m => m.approvalStatus === "pending")
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));
}

/** Admin: approve a pending runner repair → moves it into the Open column. */
export async function approveRunnerRepair(id: string) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  const { data } = await supabase.auth.getUser();
  m.approvalStatus = "approved";
  m.approvalDate = new Date().toISOString();
  m.approvedBy = data.user?.id ?? undefined;
  m.status = "open";
  m.isRentalBlocking = true;
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  syncVehicleOpenIssues(m.vehicleId);
  emit();
}

/** Admin: reject a pending runner repair → closes the alert, frees the vehicle. */
export function rejectRunnerRepair(id: string) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  m.approvalStatus = "rejected";
  m.isRentalBlocking = false;
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  syncVehicleOpenIssues(m.vehicleId);
  emit();
}

// ---------------------------------------------------------------------------
// Reported issues (optional diagnosis at save)
// An admin reports a customer issue without a diagnosis. The record lives as a
// maintenance row with status="reported" and blocks the vehicle from rentals.
// Later the admin fills diagnosis + parts/labour costs and moves it into the
// Repairs "Open" column.
// ---------------------------------------------------------------------------
/** Reported issues awaiting diagnosis, newest first. */
export function reportedIssues(): Maintenance[] {
  return maintenance
    .filter(m => m.status === "reported")
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));
}

/** Admin reports a customer issue with no diagnosis required. */
export function reportIssue(input: {
  vehicleId: string;
  issueDescription: string;
  customerNotes?: string;
}) {
  const v = vehicles.find(x => x.id === input.vehicleId);
  const rec: Maintenance = {
    id: nextMaintenanceId(),
    vehicleId: input.vehicleId,
    serviceType: input.issueDescription,
    issueDescription: input.issueDescription,
    customerNotes: input.customerNotes?.trim() || undefined,
    vendor: "Pending assignment",
    dateCompleted: undefined as unknown as string,
    mileageAtService: v?.mileage ?? 0,
    cost: 0,
    nextServiceDue: new Date().toISOString().slice(0, 10),
    status: "reported",
    isRentalBlocking: true,
    downPayment: 0,
    amountPaid: 0,
    balance: 0,
    createdAt: new Date().toISOString(),
  };
  maintenance.push(rec);
  cloudWrite("maintenance:insert", supabase.from("maintenance").insert(toMaintenance(rec)));
  if (v) syncVehicleOpenIssues(v.id);
  emit();
  return rec;
}

/** Save edits to a reported issue (issue text, customer + diagnosis notes, costs). */
export function updateIssue(id: string, patch: {
  issueDescription?: string;
  customerNotes?: string;
  diagnosisNotes?: string;
  partsCost?: number;
  laborCost?: number;
}) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  if (patch.issueDescription !== undefined) {
    m.issueDescription = patch.issueDescription;
    m.serviceType = patch.issueDescription;
  }
  if (patch.customerNotes !== undefined) m.customerNotes = patch.customerNotes.trim() || undefined;
  if (patch.diagnosisNotes !== undefined) m.diagnosisNotes = patch.diagnosisNotes.trim() || undefined;
  if (patch.partsCost !== undefined) m.partsCost = Math.max(0, patch.partsCost || 0);
  if (patch.laborCost !== undefined) m.laborCost = Math.max(0, patch.laborCost || 0);
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  emit();
}

/** Move a diagnosed reported issue into the Repairs "Open" column. */
export function moveIssueToOpenRepair(id: string) {
  return moveIssueToOpenRepairImpl(id);
}

/** Admin creates a repair ticket from an open (reported) inspection-fail repair.
 *  Stores parts/labour/total costs and moves the record to "pending_deposit". */
export function createRepairTicket(id: string, partsCost: number, laborCost: number) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  const parts = Math.max(0, partsCost || 0);
  const labor = Math.max(0, laborCost || 0);
  const total = parts + labor;
  m.partsCost = parts;
  m.laborCost = labor;
  m.cost = total;
  m.balance = total;
  m.depositRequired = Math.round(total * 0.5 * 100) / 100;
  if (!m.diagnosisNotes?.trim()) m.diagnosisNotes = m.repairRequestNotes?.trim() || m.serviceType;
  m.status = "pending_deposit";
  m.isRentalBlocking = true;
  m.source = m.source ?? "inspection_fail";
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  syncVehicleOpenIssues(m.vehicleId);
  emit();
  return m;
}

/** Admin processes (records) the deposit for a pending-deposit repair. Optional step. */
export function processRepairDeposit(id: string, depositAmount: number) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  const amt = Math.max(0, depositAmount || 0);
  m.depositAmount = amt;
  m.amountPaid = amt;
  m.balance = Math.max(0, (m.cost ?? 0) - amt);
  m.depositProcessed = true;
  m.depositDate = new Date().toISOString();
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  emit();
  return m;
}

function moveIssueToOpenRepairImpl(id: string) {
  const m = maintenance.find(x => x.id === id);
  if (!m || m.status !== "reported") return;
  const parts = Math.max(0, m.partsCost ?? 0);
  const labor = Math.max(0, m.laborCost ?? 0);
  if (!m.diagnosisNotes?.trim() || parts <= 0 || labor <= 0) return;
  const total = parts + labor;
  const solution: RepairSolution = {
    name: m.diagnosisNotes.trim(),
    partsCost: parts,
    laborCost: labor,
    totalCost: total,
  };
  m.status = "open";
  m.createdFromIssue = true;
  m.isRentalBlocking = true;
  m.solutions = [solution];
  m.cost = total;
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  syncVehicleOpenIssues(m.vehicleId);
  emit();
  return m;
}

// ---------------------------------------------------------------------------
// 3-phase repair workflow (reported → diagnosing → pending_complete → complete)
// Used by the Maintenance "Active Repairs" board.
// ---------------------------------------------------------------------------
/** [+ Create Repair] — admin opens a repair manually. Phase 1 (reported). */
export function createManualRepair(vehicleId: string, issueDescription: string, takeOffRental = true, problemCategory?: string) {
  const issue = issueDescription.trim();
  const v = vehicles.find(x => x.id === vehicleId);
  const rec: Maintenance = {
    id: nextMaintenanceId(),
    vehicleId,
    serviceType: issue,
    issueDescription: issue,
    problemCategory,
    vendor: "Pending assignment",
    dateCompleted: undefined as unknown as string,
    mileageAtService: v?.mileage ?? 0,
    cost: 0,
    nextServiceDue: new Date().toISOString().slice(0, 10),
    status: "reported",
    source: "manual",
    isRentalBlocking: takeOffRental,
    downPayment: 0,
    amountPaid: 0,
    balance: 0,
    createdAt: new Date().toISOString(),
  };
  maintenance.push(rec);
  cloudWrite("maintenance:insert", supabase.from("maintenance").insert(toMaintenance(rec)));
  if (v) syncVehicleOpenIssues(v.id);
  emit();
  return rec;
}

/** Phase 1 → Phase 2: move a reported repair into Diagnose. */
export function moveRepairToDiagnose(id: string) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  m.status = "diagnosing";
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  syncVehicleOpenIssues(m.vehicleId);
  emit();
  return m;
}

/** Phase 2 → Phase 3: save diagnosis (parts needed + costs) and move to Complete. */
export function saveRepairDiagnosis(
  id: string,
  input: {
    partsNeeded: string;
    partsCost: number;
    laborCost: number;
    mileageAtService?: number;
    /** Diagnosis text — becomes the ticket's display title. */
    diagnosis?: string;
    /**
     * When the mechanic found multiple problems, pass one entry per problem to
     * split into separate repair tickets. The first entry stays on this ticket;
     * each additional entry becomes a new ticket sharing the reported issue.
     */
    splits?: Array<{ diagnosis: string; partsNeeded: string; partsCost: number; laborCost: number }>;
  },
) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;

  const mileage =
    typeof input.mileageAtService === "number" ? Math.max(0, input.mileageAtService) : undefined;

  // ---- Multi-problem split path ----
  const splits = (input.splits ?? []).filter(s => s.diagnosis.trim() || s.partsNeeded.trim());
  if (splits.length >= 2) {
    const total = splits.length;
    const applyEntry = (
      rec: Maintenance,
      entry: { diagnosis: string; partsNeeded: string; partsCost: number; laborCost: number },
      index: number,
    ) => {
      const parts = Math.max(0, entry.partsCost || 0);
      const labor = Math.max(0, entry.laborCost || 0);
      const cost = parts + labor;
      rec.diagnosisTitle = entry.diagnosis.trim() || undefined;
      rec.diagnosisNotes = entry.partsNeeded.trim();
      rec.partsCost = parts;
      rec.laborCost = labor;
      rec.cost = cost;
      rec.balance = Math.max(0, cost - (rec.amountPaid ?? 0));
      if (mileage != null) rec.mileageAtService = mileage;
      rec.status = "pending_complete";
      rec.originalIssueId = m.id;
      rec.splitIndex = index + 1;
      rec.splitTotal = total;
    };

    // First entry stays on the original ticket.
    applyEntry(m, splits[0], 0);
    cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));

    // Remaining entries become new tickets sharing the reported issue.
    for (let i = 1; i < splits.length; i++) {
      const rec: Maintenance = {
        ...m,
        id: nextMaintenanceId(),
        amountPaid: 0,
        downPayment: 0,
        completedBy: undefined,
        completionDate: undefined,
        dateCompleted: undefined as unknown as string,
        mechanicName: undefined,
        mechanicNotes: undefined,
        createdAt: new Date().toISOString(),
      };
      applyEntry(rec, splits[i], i);
      maintenance.push(rec);
      cloudWrite("maintenance:insert", supabase.from("maintenance").insert(toMaintenance(rec)));
    }

    if (mileage != null) applyOdometerReading(m.vehicleId, mileage);
    syncVehicleOpenIssues(m.vehicleId);
    emit();
    return m;
  }

  // ---- Single-ticket path ----
  const parts = Math.max(0, input.partsCost || 0);
  const labor = Math.max(0, input.laborCost || 0);
  const total = parts + labor;
  if (input.diagnosis !== undefined) m.diagnosisTitle = input.diagnosis.trim() || undefined;
  m.diagnosisNotes = input.partsNeeded.trim();
  m.partsCost = parts;
  m.laborCost = labor;
  m.cost = total;
  m.balance = Math.max(0, total - (m.amountPaid ?? 0));
  if (mileage != null) m.mileageAtService = mileage;
  m.status = "pending_complete";
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  if (mileage != null) applyOdometerReading(m.vehicleId, mileage);
  syncVehicleOpenIssues(m.vehicleId);
  emit();
  return m;
}

/** Phase 3: record a payment toward the repair (tracks paid/balance only). */
export function recordRepairPaymentRaw(id: string, amount: number) {
  const m = maintenance.find(x => x.id === id);
  if (!m) return;
  const amt = Math.max(0, amount || 0);
  if (amt <= 0) return;
  m.amountPaid = (m.amountPaid ?? 0) + amt;
  m.balance = Math.max(0, (m.cost ?? 0) - m.amountPaid);
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  emit();
  return m;
}

/** Phase 3 → Phase 2: reverse a completed repair back into Diagnose (undo). */
export function reverseRepairToDiagnose(id: string) {
  const m = maintenance.find(x => x.id === id);
  if (!m || m.status !== "complete") return;

  // Remove the completion expense that was posted to P&L on completion, and
  // restore the amount paid to what was recorded before completion.
  const completionExpense = expenses.find(
    e => e.category === "Repair & Maintenance" && (e.notes ?? "").includes(`Repair ${m.id} completed`),
  );
  if (completionExpense) {
    const back = completionExpense.amount;
    deleteExpense(completionExpense.id);
    m.amountPaid = Math.max(0, (m.amountPaid ?? 0) - back);
  }

  // Remove the fleet-card history + scorecard rows logged at completion.
  cloudWrite("repair_history:delete", supabase.from("repair_history").delete().eq("maintenance_id", m.id));
  cloudWrite("repair_scorecard:delete", supabase.from("repair_scorecard").delete().eq("maintenance_id", m.id));

  m.status = "diagnosing";
  m.dateCompleted = undefined as unknown as string;
  m.completionDate = undefined;
  m.balance = Math.max(0, (m.cost ?? 0) - (m.amountPaid ?? 0));
  cloudWrite("maintenance:update", supabase.from("maintenance").update(toMaintenance(m)).eq("id", id));
  syncVehicleOpenIssues(m.vehicleId);
  emit();
  return m;
}

/**
 * Permanently delete a repair and all of its derived records:
 *  - linked P&L expense entries (down payment, payments, completion)
 *  - fleet-card repair_history rows
 *  - repair_scorecard rows
 *  - the maintenance record itself
 * Vehicle availability is then restored if no other active repair blocks it.
 */
export function deleteRepair(id: string) {
  const idx = maintenance.findIndex(x => x.id === id);
  if (idx < 0) return;
  const m = maintenance[idx];
  const vehicleId = m.vehicleId;

  // 1. Remove every P&L expense linked to this repair (notes reference the id).
  const needle = `repair ${id}`.toLowerCase();
  const linkedExpenses = expenses.filter(e => (e.notes ?? "").toLowerCase().includes(needle));
  for (const e of linkedExpenses) deleteExpense(e.id);

  // 2 & 3. Remove fleet-card history + scorecard rows logged at completion.
  cloudWrite("repair_history:delete", supabase.from("repair_history").delete().eq("maintenance_id", id));
  cloudWrite("repair_scorecard:delete", supabase.from("repair_scorecard").delete().eq("maintenance_id", id));

  // 4. Remove the maintenance record.
  maintenance.splice(idx, 1);
  cloudWrite("maintenance:delete", supabase.from("maintenance").delete().eq("id", id));

  // 5. Restore vehicle availability if nothing else blocks it.
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
  // Mirror the work order into the maintenance log so it shows up in the
  // vehicle's maintenance history. Created as an open, non-blocking service
  // item (scheduled preventive work shouldn't take the vehicle offline).
  ensureWorkOrderMaintenance(rec);
  emit();
  return rec;
}

/** Find (or create) the maintenance row mirroring a work order. */
function ensureWorkOrderMaintenance(wo: WorkOrder): Maintenance {
  const existing = maintenance.find(m => m.sourceWorkOrderId === wo.id);
  if (existing) return existing;
  const v = vehicles.find(x => x.id === wo.vehicleId);
  return addMaintenance({
    vehicleId: wo.vehicleId,
    serviceType: wo.serviceType,
    vendor: wo.assignedTo?.trim() || "Pending assignment",
    dateCompleted: "",
    mileageAtService: v?.mileage ?? 0,
    nextServiceDue: wo.scheduledDate,
    cost: 0,
    notes: wo.description || undefined,
    status: "open",
    issueDescription: wo.description || wo.serviceType,
    isRentalBlocking: false,
    source: "work_order",
    sourceWorkOrderId: wo.id,
    createdAt: wo.createdAt ?? new Date().toISOString(),
  });
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
  // When a work order reaches "completed", finalize its maintenance mirror:
  // mark it complete and post the actual cost to P&L. Idempotent — if the
  // linked maintenance is already complete, this does nothing.
  if (w.status === "completed") {
    const m = ensureWorkOrderMaintenance(w);
    if (m.status !== "complete") {
      const partsNote = w.partsUsed?.trim() ? `Parts: ${w.partsUsed.trim()}` : "";
      const notes = [w.completionNotes?.trim(), partsNote].filter(Boolean).join("\n");
      completeRepair(m.id, {
        completedBy: w.reviewedBy?.trim() || w.assignedTo?.trim() || "Admin",
        mechanicName: w.assignedTo?.trim() || undefined,
        partsCost: w.actualCost ?? w.estimatedCost ?? 0,
        laborCost: 0,
        mechanicNotes: notes || undefined,
      });
    }
  }
  emit();
}

export function deleteWorkOrder(id: string) {
  const idx = workOrders.findIndex(x => x.id === id);
  if (idx < 0) return;
  workOrders.splice(idx, 1);
  cloudWrite("work_orders:delete", supabase.from("work_orders").delete().eq("id", id));
  // Remove the mirrored maintenance row only if it was never completed, so
  // completed-work-order history is preserved.
  const mIdx = maintenance.findIndex(m => m.sourceWorkOrderId === id && m.status !== "complete" && !m.dateCompleted);
  if (mIdx >= 0) {
    const m = maintenance[mIdx];
    maintenance.splice(mIdx, 1);
    cloudWrite("maintenance:delete", supabase.from("maintenance").delete().eq("id", m.id));
    syncVehicleOpenIssues(m.vehicleId);
  }
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
    maintenanceId: input.maintenanceId,
    paymentMethod: input.paymentMethod,
    referenceNumber: input.referenceNumber,
    payrollEmployee: input.payrollEmployee,
    payrollPeriodStart: input.payrollPeriodStart,
    payrollPeriodEnd: input.payrollPeriodEnd,
    payrollHours: input.payrollHours,
    payrollRate: input.payrollRate,
  };
  expenses.push(exp);
  const cloudReady = cloudWrite("expense:insert", supabase.from("expenses").insert(toExpense(exp))).catch((error) => {
    const idx = expenses.findIndex(e => e.id === exp.id);
    if (idx >= 0) { expenses.splice(idx, 1); emit(); }
    throw error;
  });
  logExpenseAudit(exp.id, "create", { after: toExpense(exp) });
  emit();
  return Object.assign(exp, { cloudReady });
}

export function updateExpense(id: string, patch: Partial<Expense>) {
  const e = expenses.find(x => x.id === id);
  if (!e) return;
  const before = toExpense(e);
  Object.assign(e, patch);
  cloudWrite("expense:update", supabase.from("expenses").update(toExpense(e)).eq("id", id));
  logExpenseAudit(id, "update", { before, after: toExpense(e) });
  emit();
}

export function deleteExpense(id: string) {
  const idx = expenses.findIndex(x => x.id === id);
  if (idx < 0) return;
  const before = toExpense(expenses[idx]);
  expenses.splice(idx, 1);
  cloudWrite("expense:delete", supabase.from("expenses").delete().eq("id", id));
  logExpenseAudit(id, "delete", { before });
  emit();
}

/** Best-effort audit trail write; never blocks the optimistic UI. */
function logExpenseAudit(expenseId: string, action: string, diff: unknown) {
  supabase.auth.getUser().then(({ data }) => {
    void supabase.from("expense_audit_log").insert({
      expense_id: expenseId,
      action,
      diff: diff as any,
      changed_by: data.user?.id ?? null,
    });
  }).catch(() => { /* audit is non-critical */ });
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
