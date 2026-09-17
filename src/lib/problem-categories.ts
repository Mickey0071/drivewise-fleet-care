// Repair "problem categories" used for analytics grouping.
// Starts from a default list but is NOT closed — admins can add their own
// categories from any dropdown, and any category already saved on a record
// is always shown so nothing is ever "limited to what's there".
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

const CUSTOM_KEY = "camauto.customProblemCategories";
export const PROBLEM_CATEGORIES_EVENT = "camauto:problem-categories-changed";

function norm(v: string): string {
  return v.trim().replace(/\s+/g, " ");
}

/** Admin-added custom categories, persisted in the browser. */
export function getCustomCategories(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Save a new custom category. Returns the cleaned name, or null if invalid/dup. */
export function addCustomCategory(name: string): string | null {
  const clean = norm(name);
  if (clean.length < 2 || clean.length > 60) return null;
  const existing = new Set(allCategories().map((c) => c.toLowerCase()));
  if (existing.has(clean.toLowerCase())) return clean; // already exists — treat as success
  const next = [...getCustomCategories(), clean];
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(PROBLEM_CATEGORIES_EVENT));
  } catch {}
  return clean;
}

/** Defaults + custom + any category already in use on records (deduped, stable order). */
export function allCategories(inUse: (string | null | undefined)[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...PROBLEM_CATEGORIES, ...getCustomCategories(), ...inUse]) {
    if (!raw) continue;
    const c = norm(raw);
    const key = c.toLowerCase();
    if (!c || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function isProblemCategory(v: unknown): v is string {
  return typeof v === "string" && allCategories().includes(v);
}
