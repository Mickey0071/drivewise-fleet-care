import type { FinancialExpenseItem } from "@/lib/vehicle-financials";

// Display-only grouping: merges the Parts / Labor lines of one repair into a
// single row. Amounts are copied, never recomputed, so every total equals the
// sum of the underlying line items.
export interface GroupedExpenseRow {
  key: string;
  name: string;
  date: string;
  vendor?: string;
  category: string;
  source: FinancialExpenseItem["source"];
  parts: number | null;
  labor: number | null;
  /** Other/remainder amount not split into parts or labor. */
  other: number;
  total: number;
  isRepair: boolean;
  items: FinancialExpenseItem[];
}

export function groupExpenseItems(items: FinancialExpenseItem[]): GroupedExpenseRow[] {
  const map = new Map<string, GroupedExpenseRow>();
  const order: string[] = [];
  for (const it of items) {
    const key = it.groupId ? `g:${it.groupId}` : `i:${it.source}:${it.id}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        name: it.repairName || it.description,
        date: it.date,
        vendor: it.vendor,
        category: it.category,
        source: it.source,
        parts: null,
        labor: null,
        other: 0,
        total: 0,
        isRepair: !!it.groupId || it.source !== "manual",
        items: [],
      };
      map.set(key, g);
      order.push(key);
    }
    g.items.push(it);
    g.total += it.amount;
    const cat = (it.category || "").toLowerCase();
    if (cat === "parts") g.parts = (g.parts ?? 0) + it.amount;
    else if (cat === "labor") g.labor = (g.labor ?? 0) + it.amount;
    else g.other += it.amount;
    if (cat === "labor" && it.vendor) g.vendor = it.vendor;
    if (!g.vendor && it.vendor) g.vendor = it.vendor;
  }
  return order.map((k) => map.get(k)!);
}

export function groupedTotals(rows: GroupedExpenseRow[]) {
  return {
    repairs: rows.filter((r) => r.isRepair).length,
    count: rows.length,
    parts: rows.reduce((s, r) => s + (r.parts ?? 0), 0),
    labor: rows.reduce((s, r) => s + (r.labor ?? 0), 0),
    grand: rows.reduce((s, r) => s + r.total, 0),
  };
}
