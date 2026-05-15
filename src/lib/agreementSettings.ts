import { useSyncExternalStore } from "react";

export interface AgreementSettings {
  company: {
    legalName: string;
    dba: string;
    address: string;
    phone: string;
    website: string;
  };
  fees: {
    dailyLateFee: string;
    mileageCapPerWeek: string;
    excessMileageRate: string;
    fuelFeePerGallon: string;
    cleaningFeeRange: string;
    tollAdminFee: string;
    repossessionGraceDays: string;
  };
  conditionRows: string[];
  clauses: { title: string; body: string }[];
  agreementVersion: string;
}

export const DEFAULT_SETTINGS: AgreementSettings = {
  company: {
    legalName: "CAM Auto LLC",
    dba: "Camauto Rentals",
    address: "416 Sicklerville Rd, Sicklerville, NJ 08081",
    phone: "(866) 625-5550",
    website: "camautorentals.com",
  },
  fees: {
    dailyLateFee: "$25",
    mileageCapPerWeek: "—",
    excessMileageRate: "$0.15",
    fuelFeePerGallon: "$6.00",
    cleaningFeeRange: "$75–$250",
    tollAdminFee: "$35",
    repossessionGraceDays: "3",
  },
  conditionRows: [
    "Front Bumper",
    "Rear Bumper",
    "Driver Side",
    "Passenger Side",
    "Roof / Hood",
    "Interior / Windshield",
    "Tires / Wheels",
  ],
  clauses: [
    { title: "Authorized Use", body: "The vehicle is rented solely for lawful personal transportation use by the named Renter. Renter shall not permit any unauthorized driver to operate the vehicle. Use of the vehicle for any illegal purpose, off-road driving, racing, towing, or transporting hazardous materials is strictly prohibited. Any unauthorized use voids all protections under this Agreement." },
    { title: "Payment & Late Fees", body: "Rental payments are due weekly on the same day of the week as the Rental Start Date. Payments not received by 11:59 PM on the due date are subject to a daily late fee as stated above. {{COMPANY}} reserves the right to terminate this Agreement and repossess the vehicle if payment is more than {{GRACE_DAYS}} days past due without prior arrangement." },
    { title: "Mileage", body: "Renter agrees to the weekly mileage cap stated above, if applicable. Excess mileage will be charged at {{EXCESS_MILEAGE}} per mile over the cap and deducted from the security deposit or invoiced separately at the end of the rental term." },
    { title: "Insurance & Liability", body: "{{COMPANY}} maintains commercial auto insurance on all fleet vehicles. Renter is responsible for any deductible, damage, theft, or loss not covered by the commercial policy. Renter is solely liable for any traffic violations, parking citations, tolls, and fines incurred during the rental period. Renter agrees to indemnify and hold harmless {{COMPANY}} from all third-party claims arising from Renter's use of the vehicle." },
    { title: "Tolls & Philadelphia PPA Citations", body: "Any toll violations, Philadelphia Parking Authority (PPA) citations, or other parking/traffic penalties incurred during the rental period are the sole financial responsibility of the Renter. {{COMPANY}} will furnish Renter information to relevant authorities upon request pursuant to applicable law. All fines, penalties, and administrative fees incurred by {{COMPANY}} as a result of Renter's violations will be charged back to Renter in full, plus a {{TOLL_ADMIN}} administrative processing fee per incident." },
    { title: "Fuel", body: "Vehicle is provided at the fuel level noted above. Renter must return the vehicle at the same fuel level or a fueling fee of {{FUEL_FEE}} per gallon for any deficiency will be charged." },
    { title: "Vehicle Return & Condition", body: "Renter must return the vehicle on or before the agreed return date in the same condition as received, ordinary wear excepted. Damage discovered upon return not noted at pickup is Renter's responsibility. Interior cleaning fees of {{CLEANING_FEE}} will apply if the vehicle is returned excessively soiled." },
    { title: "Repossession", body: "{{COMPANY}} reserves the right to repossess the vehicle without prior notice if: (a) payment is more than {{GRACE_DAYS}} days past due; (b) the vehicle is used in violation of this Agreement; (c) Renter provides false information; (d) the vehicle is determined to be at risk of damage, theft, or misuse; or (e) Renter's conduct poses a legal or financial risk to {{COMPANY}}." },
    { title: "GPS & Tracking", body: "Renter acknowledges that the vehicle may be equipped with a GPS tracking device. {{COMPANY}} reserves the right to monitor vehicle location at any time during the rental period for fleet management, theft prevention, and repossession purposes. This is not a condition subject to negotiation." },
    { title: "Graves Amendment — Lessor Liability Exemption (49 U.S.C. § 30106)", body: "{{COMPANY}} ({{LEGAL_NAME}}) is engaged in the trade or business of renting and leasing motor vehicles. Pursuant to the Graves Amendment, 49 U.S.C. § 30106, {{COMPANY}} shall not be liable under any state or local law or regulation for any harm to persons or property that arises out of the use, operation, or possession of a rented vehicle during the rental period, provided that {{COMPANY}} is not independently negligent or engaged in criminal wrongdoing. Renter expressly acknowledges and agrees that: (a) {{COMPANY}} bears no vicarious, imputed, or statutory liability for any accident, injury, property damage, or loss caused by the Renter or any authorized or unauthorized operator of the vehicle; (b) all liability for damages arising from Renter's operation of the vehicle rests solely with the Renter; and (c) Renter shall indemnify, defend, and hold harmless {{COMPANY}}, its members, agents, and employees from and against any and all claims, suits, judgments, costs, and attorney's fees arising out of or related to Renter's use of the vehicle. This section applies to claims brought under any theory of liability, including but not limited to negligence, negligent entrustment, respondeat superior, or vicarious liability." },
    { title: "Governing Law & Disputes", body: "This Agreement shall be governed by the laws of the State of New Jersey. Any dispute arising under this Agreement shall be resolved in the courts of Camden County, New Jersey. In any action to enforce this Agreement, the prevailing party shall be entitled to recover reasonable attorney's fees and costs." },
    { title: "Entire Agreement", body: "This Agreement constitutes the entire understanding between the parties. No verbal representations shall be binding. Any modification must be in writing and signed by both parties. If any provision is found unenforceable, the remaining provisions remain in full effect." },
  ],
  agreementVersion: "camauto-2026-05",
};

const KEY = "camauto.agreementSettings.v1";
const listeners = new Set<() => void>();
let cache: AgreementSettings = load();

function load(): AgreementSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed,
      company: { ...DEFAULT_SETTINGS.company, ...(parsed.company ?? {}) },
      fees: { ...DEFAULT_SETTINGS.fees, ...(parsed.fees ?? {}) },
      conditionRows: Array.isArray(parsed.conditionRows) && parsed.conditionRows.length ? parsed.conditionRows : DEFAULT_SETTINGS.conditionRows,
      clauses: Array.isArray(parsed.clauses) && parsed.clauses.length ? parsed.clauses : DEFAULT_SETTINGS.clauses,
    };
  } catch { return DEFAULT_SETTINGS; }
}

export function getAgreementSettings(): AgreementSettings { return cache; }

export function setAgreementSettings(next: AgreementSettings) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  listeners.forEach(l => l());
}

export function resetAgreementSettings() {
  setAgreementSettings(DEFAULT_SETTINGS);
}

export function useAgreementSettings(): AgreementSettings {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => cache,
    () => DEFAULT_SETTINGS,
  );
}

export function renderClauseBody(body: string, s: AgreementSettings): string {
  return body
    .replaceAll("{{COMPANY}}", s.company.dba)
    .replaceAll("{{LEGAL_NAME}}", `${s.company.legalName} d/b/a ${s.company.dba}`)
    .replaceAll("{{GRACE_DAYS}}", s.fees.repossessionGraceDays)
    .replaceAll("{{EXCESS_MILEAGE}}", s.fees.excessMileageRate)
    .replaceAll("{{TOLL_ADMIN}}", s.fees.tollAdminFee)
    .replaceAll("{{FUEL_FEE}}", s.fees.fuelFeePerGallon)
    .replaceAll("{{CLEANING_FEE}}", s.fees.cleaningFeeRange);
}