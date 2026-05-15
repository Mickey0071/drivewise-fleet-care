export type VehicleStatus = "available" | "rented" | "maintenance" | "impound";
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
}
export interface Driver {
  id: string; fullName: string; phone: string; email: string;
  licenseNumber: string; licenseExpiry: string; insuranceOnFile: boolean;
  rideshare: "Uber" | "Lyft" | "Both"; status: DriverStatus; dateAdded: string;
}
export interface Rental {
  id: string; vehicleId: string; driverId: string; startDate: string;
  endDate?: string; weeklyRate: number; depositPaid: number;
  paymentStatus: PayStatus; notes?: string;
  billingPeriod?: "daily" | "weekly" | "monthly";
  rate?: number;
  signatureDataUrl?: string;
  signedAt?: string;
  signedBy?: string;
  agreementVersion?: string;
  reservationStatus?: "pending" | "active" | "completed";
  pendingCreatedAt?: string;
  paymentReceived?: boolean;
  extensions?: RentalExtension[];
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
export interface Maintenance {
  id: string; vehicleId: string; serviceType: string; cost: number;
  vendor: string; dateCompleted: string; mileageAtService: number;
  nextServiceDue: string; notes?: string;
}
export interface Inspection {
  id: string; vehicleId: string; rentalId: string;
  type: "check-in" | "check-out"; date: string; mileage: number;
  fuelLevel: number; damageNoted: boolean; completedBy: string;
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

export const vehicles: Vehicle[] = [];
export const drivers: Driver[] = [];
export const rentals: Rental[] = [];
export const payments: Payment[] = [];
export const maintenance: Maintenance[] = [];
export const inspections: Inspection[] = [];
export const violations: Violation[] = [];
export const vehiclePhotos: VehiclePhoto[] = [];

export const staff: Staff[] = [
  { id: "S-01", fullName: "Ray Mitchell", role: "Lot Manager", phone: "(404) 555-1010", email: "ray@camauto.com", payType: "salary", payRate: 1200, stripeConnected: true, status: "active" },
  { id: "S-02", fullName: "Mia Cortez", role: "Inspector", phone: "(404) 555-1011", email: "mia@camauto.com", payType: "hourly", payRate: 22, stripeConnected: true, status: "active" },
  { id: "S-03", fullName: "Jordan Blake", role: "Detailer", phone: "(404) 555-1012", email: "jordan@camauto.com", payType: "per-vehicle", payRate: 35, stripeConnected: false, status: "active" },
  { id: "S-04", fullName: "Sam Park", role: "Mechanic", phone: "(404) 555-1013", email: "sam@camauto.com", payType: "hourly", payRate: 28, stripeConnected: true, status: "active" },
];

export const expenses: Expense[] = [];

export const payrollRuns: PayrollRun[] = [];

export function vehicleById(id: string) { return vehicles.find(v => v.id === id); }
export function driverById(id: string) { return drivers.find(d => d.id === id); }
export function staffById(id: string) { return staff.find(s => s.id === id); }
export function rentalById(id: string) { return rentals.find(r => r.id === id); }

export const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
export const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
