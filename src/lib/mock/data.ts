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
  vendor: string; vehicleId?: string; staffId?: string; notes?: string;
}
export interface PayrollRun {
  id: string; periodStart: string; periodEnd: string; runDate: string;
  totalPayout: number; status: "draft" | "approved" | "paid";
  lines: { staffId: string; hours: number; vehicles: number; gross: number; net: number; status: "pending" | "sent" | "failed"; }[];
}

export const vehicles: Vehicle[] = [
  { id: "V-001", make: "Toyota", model: "Camry", year: 2022, vin: "4T1G11AK*****1234", plate: "GRN-241", mileage: 42180, status: "rented", riskTier: "A", dailyRate: 65, weeklyRate: 380, nextServiceDue: "2026-06-15" },
  { id: "V-002", make: "Honda", model: "Accord", year: 2021, vin: "1HGCV1F*****5678", plate: "GRN-118", mileage: 58420, status: "rented", riskTier: "A", dailyRate: 65, weeklyRate: 380, nextServiceDue: "2026-05-20" },
  { id: "V-003", make: "Hyundai", model: "Sonata", year: 2023, vin: "5NPEH4J*****9012", plate: "GRN-307", mileage: 19450, status: "available", riskTier: "A", dailyRate: 70, weeklyRate: 410, nextServiceDue: "2026-08-01" },
  { id: "V-004", make: "Kia", model: "K5", year: 2022, vin: "5XXG14J*****3456", plate: "GRN-422", mileage: 33200, status: "maintenance", riskTier: "B", dailyRate: 60, weeklyRate: 360, nextServiceDue: "2026-05-15" },
  { id: "V-005", make: "Toyota", model: "Corolla", year: 2020, vin: "2T1BUR*****7890", plate: "GRN-555", mileage: 71300, status: "rented", riskTier: "B", dailyRate: 55, weeklyRate: 340, nextServiceDue: "2026-05-10" },
  { id: "V-006", make: "Nissan", model: "Altima", year: 2021, vin: "1N4BL4*****2345", plate: "GRN-619", mileage: 49880, status: "impound", riskTier: "C", dailyRate: 55, weeklyRate: 340, nextServiceDue: "2026-07-12" },
  { id: "V-007", make: "Honda", model: "Civic", year: 2023, vin: "19XFC2*****6789", plate: "GRN-733", mileage: 12600, status: "available", riskTier: "A", dailyRate: 70, weeklyRate: 410 },
  { id: "V-008", make: "Toyota", model: "Camry", year: 2022, vin: "4T1G11AK*****0001", plate: "GRN-841", mileage: 38100, status: "rented", riskTier: "A", dailyRate: 65, weeklyRate: 380 },
];

export const drivers: Driver[] = [
  { id: "D-1001", fullName: "Marcus Reed", phone: "(404) 555-0142", email: "marcus@demo.com", licenseNumber: "GA-948271", licenseExpiry: "2027-03-12", insuranceOnFile: true, rideshare: "Uber", status: "active", dateAdded: "2025-09-04" },
  { id: "D-1002", fullName: "Tasha Williams", phone: "(404) 555-0188", email: "tasha@demo.com", licenseNumber: "GA-712095", licenseExpiry: "2026-06-01", insuranceOnFile: true, rideshare: "Both", status: "active", dateAdded: "2025-08-14" },
  { id: "D-1003", fullName: "Jamal Carter", phone: "(404) 555-0220", email: "jamal@demo.com", licenseNumber: "GA-553400", licenseExpiry: "2025-12-08", insuranceOnFile: false, rideshare: "Lyft", status: "active", dateAdded: "2025-07-22" },
  { id: "D-1004", fullName: "Linda Park", phone: "(404) 555-0311", email: "linda@demo.com", licenseNumber: "GA-887622", licenseExpiry: "2028-01-19", insuranceOnFile: true, rideshare: "Uber", status: "suspended", dateAdded: "2025-05-30" },
  { id: "D-1005", fullName: "Devon Pierce", phone: "(404) 555-0455", email: "devon@demo.com", licenseNumber: "GA-220119", licenseExpiry: "2027-09-04", insuranceOnFile: true, rideshare: "Uber", status: "active", dateAdded: "2026-04-12" },
  { id: "D-1006", fullName: "Aisha Thompson", phone: "(404) 555-0512", email: "aisha@demo.com", licenseNumber: "GA-661280", licenseExpiry: "2026-11-23", insuranceOnFile: true, rideshare: "Both", status: "pending", dateAdded: "2026-05-09" },
];

export const rentals: Rental[] = [
  { id: "R-501", vehicleId: "V-001", driverId: "D-1001", startDate: "2026-04-20", weeklyRate: 380, depositPaid: 300, paymentStatus: "current", reservationStatus: "active", paymentReceived: true },
  { id: "R-502", vehicleId: "V-002", driverId: "D-1002", startDate: "2026-03-15", weeklyRate: 380, depositPaid: 300, paymentStatus: "current", reservationStatus: "active", paymentReceived: true },
  { id: "R-503", vehicleId: "V-005", driverId: "D-1003", startDate: "2026-04-01", weeklyRate: 340, depositPaid: 250, paymentStatus: "late", reservationStatus: "active", paymentReceived: true },
  { id: "R-504", vehicleId: "V-008", driverId: "D-1005", startDate: "2026-04-25", weeklyRate: 380, depositPaid: 300, paymentStatus: "current", reservationStatus: "active", paymentReceived: true },
];

export const payments: Payment[] = [
  { id: "P-9001", rentalId: "R-501", driverId: "D-1001", amount: 380, dueDate: "2026-05-04", paidDate: "2026-05-04", method: "Stripe", status: "paid" },
  { id: "P-9002", rentalId: "R-501", driverId: "D-1001", amount: 380, dueDate: "2026-05-11", status: "late" },
  { id: "P-9003", rentalId: "R-502", driverId: "D-1002", amount: 380, dueDate: "2026-05-08", paidDate: "2026-05-07", method: "Zelle", status: "paid" },
  { id: "P-9004", rentalId: "R-502", driverId: "D-1002", amount: 380, dueDate: "2026-05-15", status: "paid" },
  { id: "P-9005", rentalId: "R-503", driverId: "D-1003", amount: 340, dueDate: "2026-05-01", status: "missed" },
  { id: "P-9006", rentalId: "R-503", driverId: "D-1003", amount: 340, dueDate: "2026-05-08", status: "missed" },
  { id: "P-9007", rentalId: "R-504", driverId: "D-1005", amount: 380, dueDate: "2026-05-09", paidDate: "2026-05-09", method: "card", status: "paid" },
  { id: "P-9008", rentalId: "R-504", driverId: "D-1005", amount: 380, dueDate: "2026-05-16", status: "late" },
];

export const maintenance: Maintenance[] = [
  { id: "M-301", vehicleId: "V-001", serviceType: "Oil change + tire rotation", cost: 85, vendor: "QuickLube ATL", dateCompleted: "2026-03-10", mileageAtService: 38000, nextServiceDue: "2026-06-15" },
  { id: "M-302", vehicleId: "V-004", serviceType: "Brake pads (front)", cost: 340, vendor: "Midas", dateCompleted: "2026-05-08", mileageAtService: 33100, nextServiceDue: "2026-11-01" },
  { id: "M-303", vehicleId: "V-005", serviceType: "Transmission service", cost: 480, vendor: "AAMCO", dateCompleted: "2026-04-22", mileageAtService: 70900, nextServiceDue: "2026-05-10" },
  { id: "M-304", vehicleId: "V-002", serviceType: "Oil change", cost: 65, vendor: "QuickLube ATL", dateCompleted: "2026-04-30", mileageAtService: 57800, nextServiceDue: "2026-05-20" },
];

export const inspections: Inspection[] = [
  { id: "I-401", vehicleId: "V-001", rentalId: "R-501", type: "check-in", date: "2026-04-20", mileage: 41100, fuelLevel: 100, damageNoted: false, completedBy: "Staff: Ray" },
  { id: "I-402", vehicleId: "V-002", rentalId: "R-502", type: "check-in", date: "2026-03-15", mileage: 56800, fuelLevel: 100, damageNoted: false, completedBy: "Staff: Ray" },
  { id: "I-403", vehicleId: "V-005", rentalId: "R-503", type: "check-in", date: "2026-04-01", mileage: 70200, fuelLevel: 75, damageNoted: true, completedBy: "Staff: Mia" },
];

export const violations: Violation[] = [
  { id: "VL-201", vehicleId: "V-006", driverId: "D-1004", type: "impound", amount: 450, dateIssued: "2026-04-18", status: "pending", notes: "Recovered from PPA lot" },
  { id: "VL-202", vehicleId: "V-005", driverId: "D-1003", type: "PPA", amount: 75, dateIssued: "2026-05-02", status: "pending" },
  { id: "VL-203", vehicleId: "V-001", driverId: "D-1001", type: "ticket", amount: 125, dateIssued: "2026-04-12", status: "paid" },
  { id: "VL-204", vehicleId: "V-008", driverId: "D-1005", type: "PPA", amount: 50, dateIssued: "2026-05-06", status: "contested" },
];

export const staff: Staff[] = [
  { id: "S-01", fullName: "Ray Mitchell", role: "Lot Manager", phone: "(404) 555-1010", email: "ray@camauto.com", payType: "salary", payRate: 1200, stripeConnected: true, status: "active" },
  { id: "S-02", fullName: "Mia Cortez", role: "Inspector", phone: "(404) 555-1011", email: "mia@camauto.com", payType: "hourly", payRate: 22, stripeConnected: true, status: "active" },
  { id: "S-03", fullName: "Jordan Blake", role: "Detailer", phone: "(404) 555-1012", email: "jordan@camauto.com", payType: "per-vehicle", payRate: 35, stripeConnected: false, status: "active" },
  { id: "S-04", fullName: "Sam Park", role: "Mechanic", phone: "(404) 555-1013", email: "sam@camauto.com", payType: "hourly", payRate: 28, stripeConnected: true, status: "active" },
];

export const expenses: Expense[] = [
  { id: "E-101", category: "maintenance", amount: 340, date: "2026-05-08", vendor: "Midas", vehicleId: "V-004" },
  { id: "E-102", category: "fuel", amount: 220, date: "2026-05-05", vendor: "Shell" },
  { id: "E-103", category: "insurance", amount: 1850, date: "2026-05-01", vendor: "Progressive Commercial" },
  { id: "E-104", category: "impound", amount: 450, date: "2026-04-18", vendor: "City of Atlanta", vehicleId: "V-006" },
  { id: "E-105", category: "registration", amount: 120, date: "2026-04-25", vendor: "GA DDS", vehicleId: "V-007" },
  { id: "E-106", category: "payroll", amount: 4280, date: "2026-04-30", vendor: "Stripe Payouts" },
  { id: "E-107", category: "misc", amount: 90, date: "2026-05-03", vendor: "Office supplies" },
];

export const payrollRuns: PayrollRun[] = [
  {
    id: "PR-22", periodStart: "2026-04-21", periodEnd: "2026-05-04", runDate: "2026-05-05",
    totalPayout: 4280, status: "paid",
    lines: [
      { staffId: "S-01", hours: 0, vehicles: 0, gross: 1200, net: 1200, status: "sent" },
      { staffId: "S-02", hours: 72, vehicles: 0, gross: 1584, net: 1584, status: "sent" },
      { staffId: "S-03", hours: 0, vehicles: 14, gross: 490, net: 490, status: "sent" },
      { staffId: "S-04", hours: 36, vehicles: 0, gross: 1008, net: 1006, status: "sent" },
    ],
  },
  {
    id: "PR-23", periodStart: "2026-05-05", periodEnd: "2026-05-18", runDate: "2026-05-12",
    totalPayout: 4115, status: "draft",
    lines: [
      { staffId: "S-01", hours: 0, vehicles: 0, gross: 1200, net: 1200, status: "pending" },
      { staffId: "S-02", hours: 68, vehicles: 0, gross: 1496, net: 1496, status: "pending" },
      { staffId: "S-03", hours: 0, vehicles: 12, gross: 420, net: 420, status: "pending" },
      { staffId: "S-04", hours: 36, vehicles: 0, gross: 1008, net: 999, status: "pending" },
    ],
  },
];

export function vehicleById(id: string) { return vehicles.find(v => v.id === id); }
export function driverById(id: string) { return drivers.find(d => d.id === id); }
export function staffById(id: string) { return staff.find(s => s.id === id); }
export function rentalById(id: string) { return rentals.find(r => r.id === id); }

export const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
export const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
