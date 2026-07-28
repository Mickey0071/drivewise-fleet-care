// ---------------------------------------------------------------------------
// Per-vehicle "Other Income" — manually recorded revenue that does not flow
// through Stripe or the rental payments engine (insurance claims, cash sales,
// referral bonuses, sublease income, etc.).
//
// Persisted to localStorage so it survives reloads without needing a schema
// change. Categories are user-defined; a starter set is seeded on first run.
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "camauto.otherIncome.v1";
const CATEGORIES_KEY = "camauto.otherIncomeCategories.v1";

export interface OtherIncomeEntry {
  id: string;
  vehicleId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  category: string;
  source?: string; // payer / policy # / renter name
  notes?: string;
  createdAt: string;
}

const DEFAULT_CATEGORIES = [
  "Insurance Claim",
  "Cash Rental",
  "Referral / Bonus",
  "Sublease",
  "Sale of Parts",
  "Refund Received",
  "Other",
];

let entries: OtherIncomeEntry[] = load();
let categories: string[] = loadCategories();

function load(): OtherIncomeEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OtherIncomeEntry[]) : [];
  } catch { return []; }
}
function loadCategories(): string[] {
  if (typeof window === "undefined") return DEFAULT_CATEGORIES.slice();
  try {
    const raw = window.localStorage.getItem(CATEGORIES_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : null;
    if (arr && Array.isArray(arr) && arr.length) return arr;
  } catch {}
  return DEFAULT_CATEGORIES.slice();
}
function persist() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
}
function persistCategories() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories)); } catch {}
}

const listeners = new Set<() => void>();
let version = 0;
function emit() { version++; listeners.forEach(l => l()); }

export function useOtherIncomeVersion(): number {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => version,
    () => version,
  );
}

export function listOtherIncome(vehicleId?: string): OtherIncomeEntry[] {
  const rows = vehicleId ? entries.filter(e => e.vehicleId === vehicleId) : entries.slice();
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export function addOtherIncome(input: Omit<OtherIncomeEntry, "id" | "createdAt">): OtherIncomeEntry {
  const row: OtherIncomeEntry = {
    ...input,
    id: `oi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  entries.push(row);
  persist();
  emit();
  return row;
}

export function deleteOtherIncome(id: string) {
  const before = entries.length;
  entries = entries.filter(e => e.id !== id);
  if (entries.length !== before) { persist(); emit(); }
}

export function listIncomeCategories(): string[] {
  return categories.slice();
}

export function addIncomeCategory(name: string): string[] {
  const clean = name.trim();
  if (!clean) return categories.slice();
  if (!categories.some(c => c.toLowerCase() === clean.toLowerCase())) {
    categories = [...categories, clean];
    persistCategories();
    emit();
  }
  return categories.slice();
}