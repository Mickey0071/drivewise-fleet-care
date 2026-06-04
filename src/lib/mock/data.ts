export type VehicleStatus = "available" | "rented" | "inspection" | "maintenance" | "impound";
export type DriverStatus = "active" | "suspended" | "pending";
export type PayStatus = "current" | "late" | "defaulted";
export type PaymentStatus = "paid" | "late" | "missed";
export type ViolationStatus = "pending" | "paid" | "contested";

export interface Vehicle {
  id: string; make: string; model: string; year: number; vin: string;
  plate: string; mileage: number; status: VehicleStatus;
  riskTier: "A" | "B" | "C"; dailyRate: number; weeklyRate: number; notes?: string;
  nextServiceDue?: string;
  imageUrl?: string;
  color?: string;
  transmission?: "Automatic" | "Manual" | "CVT" | "Other";
  fuelType?: "Gas" | "Hybrid" | "Diesel" | "Electric";
  seats?: number;
  fuelLevelPickup?: "Full" | "3/4" | "1/2" | "1/4" | "Empty";
  ezPassTag?: string;
  registrationExpiry?: string;
  insuranceExpiry?: string;
  hasOpenIssues?: boolean;
  maintenanceSettings?: MaintenanceSettings;
}

export interface OilChangeSetting {
  mode: "miles" | "months";
  interval: number;
  lastMileage?: number;
  lastDate?: string;
}
export interface CustomMaintenanceAlert {
  id: string;
  label: string;
  lastDate?: string;
  intervalDays: number;
}
export type ScheduledTaskKey =
  | "oil"
  | "battery"
  | "alternator"
  | "transmission"
  | "safety"
  | "overall";
export interface ScheduledTask {
  enabled: boolean;
  /** Interval in miles (optional). */
  miles?: number;
  /** Interval in months (optional). */
  months?: number;
  /** Date the task was last performed (YYYY-MM-DD). */
  lastDone?: string;
}
export interface MaintenanceSettings {
  oilChange?: OilChangeSetting;
  inspectionExpiry?: string;
  batteryLastDone?: string;
  alternatorLastDone?: string;
  customAlerts?: CustomMaintenanceAlert[];
  scheduledTasks?: Partial<Record<ScheduledTaskKey, ScheduledTask>>;
}
export interface Driver {
  id: string; fullName: string; phone: string; email: string;
  licenseNumber: string; licenseExpiry: string; insuranceOnFile: boolean;
  rideshare: "Uber" | "Lyft" | "Both"; status: DriverStatus; dateAdded: string;
  dateOfBirth?: string;
  address?: string;
  // Split name fields
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  // License extras
  dlState?: string;
  // Address parts
  streetAddress?: string;
  aptUnit?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  // Alternate contact
  altContactName?: string;
  altContactPhone?: string;
  // Block from renting
  blocked?: boolean;
  blockReason?: string;
  blockedAt?: string;
  // Card on file
  stripeCustomerId?: string;
  stripePaymentMethodId?: string;
  cardLast4?: string;
  cardBrand?: string;
  cardExpMonth?: number;
  cardExpYear?: number;
  cardSavedAt?: string;
}
export interface Rental {
  id: string; vehicleId: string; driverId: string; startDate: string;
  endDate?: string; weeklyRate: number; depositPaid: number;
  paymentStatus: PayStatus; notes?: string;
  billingPeriod?: "daily" | "weekly" | "monthly";
  rate?: number;
  // New billing-fee fields (separate from legacy rate / billingPeriod)
  billingCadence?: "daily" | "weekly";
  rateAmount?: number;
  autoRenew?: boolean;
  currentPeriodEnd?: string;
  skipDailyMinimum?: boolean;
  signatureDataUrl?: string;
  signedAt?: string;
  signedBy?: string;
  agreementVersion?: string;
  reservationStatus?: "pending" | "active" | "completed" | "returned";
  pendingCreatedAt?: string;
  paymentReceived?: boolean;
  activatedAt?: string;
  extensions?: RentalExtension[];
  licenseImageUrl?: string;
  selfieImageUrl?: string;
  clientSignatureUrl?: string;
  clientSignedAt?: string;
  paymentLinkAutoSentAt?: string;
  agreementPdfUrl?: string;
  agreementPdfGeneratedAt?: string;
  receiptPdfUrl?: string;
  receiptPdfGeneratedAt?: string;
  staffReviewStatus?: "pending" | "reviewed" | "approved";
  returnedAt?: string;
  portalLinkSends?: { at: string; phone: string | null; email: string | null }[];
}
export interface RentalExtension {
  id: string;
  extendedAt: string;
  previousEndDate?: string;
  newEndDate: string;
  periods: number;
  periodLabel: "day" | "week" | "month";
  additionalAmount: number;
  paymentId?: string;
  signatureDataUrl?: string;
  signedBy?: string;
  agreementVersion?: string;
}
export interface Payment {
  id: string; rentalId: string; driverId: string; amount: number;
  dueDate: string; paidDate?: string;
  method?: "cash" | "Zelle" | "card" | "Stripe"; status: PaymentStatus;
}
export interface RepairType {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  createdAt: string;
}
export interface ServiceType {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  createdAt: string;
}
export interface Maintenance {
  id: string; vehicleId: string; serviceType: string; cost: number;
  vendor: string; dateCompleted: string; mileageAtService: number;
  nextServiceDue: string; notes?: string; completedBy?: string;
  sourceInspectionId?: string;
  createdAt?: string;
  // ---- Repair kanban fields (null for plain maintenance / service-log rows) ----
  status?: RepairStatus;
  issueDescription?: string;
  /** What the customer reported about the issue (reported stage). */
  customerNotes?: string;
  /** Diagnosis notes added by an admin before moving to an open repair. */
  diagnosisNotes?: string;
  /** True when this repair started life as a reported issue. */
  createdFromIssue?: boolean;
  solutions?: RepairSolution[];
  selectedSolution?: RepairSolution;
  downPayment?: number;
  amountPaid?: number;
  balance?: number;
  completionDate?: string;
  /** Actual parts cost entered at completion. */
  partsCost?: number;
  /** Actual labor cost entered at completion. */
  laborCost?: number;
  /** Work notes from the mechanic/admin who completed the repair. */
  mechanicNotes?: string;
  /** When true, an open repair blocks the vehicle from new bookings. Default false. */
  isRentalBlocking?: boolean;
  // ---- Runner repair request / approval workflow ----
  runnerId?: string;
  repairRequestNotes?: string;
  approvalStatus?: "pending" | "approved" | "rejected";
  approvalDate?: string;
  approvedBy?: string;
  /** Where the issue originated: "manual_report" or "inspection_fail". */
  source?: string;
  /** Inspection that triggered this issue, when source = "inspection_fail". */
  inspectionId?: string;
}
export type RepairStatus = "reported" | "open" | "pending_deposit" | "in_progress" | "complete";
export interface RepairSolution {
  name: string;
  partsCost: number;
  laborCost: number;
  totalCost: number;
}
export interface Inspection {
  id: string; vehicleId: string; rentalId: string;
  type: "check-in" | "check-out"; date: string; mileage: number;
  fuelLevel: number | string; damageNoted: boolean; completedBy: string;
  inspectorName?: string;
  jobType?: string;
  checklistItems?: Record<string, "pass" | "fail" | "na">;
  readyToRent?: boolean;
  submittedAt?: string;
  notes?: string;
  createdAt?: string;
}
export interface Violation {
  id: string; vehicleId: string; driverId?: string;
  type: "PPA" | "ticket" | "impound"; amount: number;
  dateIssued: string; status: ViolationStatus; notes?: string;
}
export interface Staff {
  id: string; fullName: string; role: string; phone: string; email: string;
  payType: "hourly" | "salary" | "per-vehicle"; payRate: number;
  stripeConnected: boolean; status: "active" | "inactive";
}
export type WorkOrderPriority = "high" | "medium" | "low";
export type WorkOrderStatus = "pending" | "in_progress" | "completed";
export interface WorkOrder {
  id: string;
  vehicleId: string;
  serviceType: string;
  scheduledDate: string;
  estimatedCost: number;
  description: string;
  assignedTo?: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  completedDate?: string;
  actualCost?: number;
  partsUsed?: string;
  completionNotes?: string;
  mechanicSignature?: string;
  mechanicSignedAt?: string;
  reviewedBy?: string;
  adminSignature?: string;
  adminSignedAt?: string;
  signedDocUrl?: string;
  createdAt?: string;
  fieldToken?: string;
  fieldSubmittedAt?: string;
}
export interface Expense {
  id: string; category: string; amount: number; date: string;
  vendor?: string; vehicleId?: string; staffId?: string; notes?: string;
  receiptUrl?: string;
}
export interface PayrollRun {
  id: string; periodStart: string; periodEnd: string; runDate: string;
  totalPayout: number; status: "draft" | "approved" | "paid";
  lines: { staffId: string; hours: number; vehicles: number; gross: number; net: number; status: "pending" | "sent" | "failed"; }[];
}
export interface VehiclePhoto {
  id: string; vehicleId: string; url: string; caption?: string;
  sortOrder: number; createdAt: string;
}
export type InsuranceEntryType = "premium" | "claim";
export type InsuranceClaimType = "Collision" | "Comprehensive" | "Liability" | "Total Loss" | "Other";
export type InsuranceClaimStatus = "open" | "closed";
export interface InsuranceEntry {
  id: string;
  vehicleId?: string;
  type: InsuranceEntryType;
  claimType?: InsuranceClaimType;
  date: string;
  amount: number;
  description: string;
  notes?: string;
  policyNumber?: string;
  claimNumber?: string;
  status: InsuranceClaimStatus;
  createdAt: string;
  company?: string;
  renterName?: string;
  renterPhone?: string;
}
export interface InsuranceChecklistItem {
  id: string; entryId: string; label: string; done: boolean; sortOrder: number;
  notes?: string;
  amount?: number;
  requiresAmount: boolean;
  requiresDocument: boolean;
  documentUrl?: string;
  documentName?: string;
}

export const repairTypes: RepairType[] = [];
export const serviceTypes: ServiceType[] = [];

export const vehicles: Vehicle[] = [];
export const drivers: Driver[] = [];
export const rentals: Rental[] = [];
export const payments: Payment[] = [];
export const maintenance: Maintenance[] = [];
export const inspections: Inspection[] = [];
export const violations: Violation[] = [];
export const vehiclePhotos: VehiclePhoto[] = [];
export const insuranceEntries: InsuranceEntry[] = [];
export const insuranceChecklist: InsuranceChecklistItem[] = [];

export const staff: Staff[] = [];

export const workOrders: WorkOrder[] = [];

export const expenses: Expense[] = [];

export const payrollRuns: PayrollRun[] = [];

export function vehicleById(id: string) { return vehicles.find(v => v.id === id); }
export function driverById(id: string) { return drivers.find(d => d.id === id); }
export function staffById(id: string) { return staff.find(s => s.id === id); }
export function rentalById(id: string) { return rentals.find(r => r.id === id); }

export const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
export const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
