// Controlled list of repair "problem categories" used for analytics grouping.
// This is ADDITIVE to the free-text service_type / issue_description fields —
// the free text stays for specific detail, the category enables charting.
export const PROBLEM_CATEGORIES = [
  "Brakes & rotors",
  "Battery & charging",
  "Engine",
  "Transmission",
  "Cooling / overheating",
  "Suspension & steering",
  "Tires & wheels",
  "Electrical",
  "Body & glass",
  "Routine / scheduled",
  "Wear & tear",
  "Other",
] as const;

export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

export function isProblemCategory(v: unknown): v is ProblemCategory {
  return typeof v === "string" && (PROBLEM_CATEGORIES as readonly string[]).includes(v);
}
