import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ExpenseCategory {
  id: string;
  name: string;
  isDefault: boolean;
}

/** The canonical default category set (used as a fallback before load). */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Payroll", "Parts", "Labour", "Food / Meals", "Fuel", "Insurance",
  "Registration", "Office Supplies", "Marketing", "Tolls",
  "Cleaning Supplies", "Vehicle Purchase",
];

export function useExpenseCategories() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("expense_categories")
      .select("id, name, is_default")
      .order("name");
    if (!error && data) {
      setCategories(data.map((r) => ({ id: r.id, name: r.name, isDefault: !!r.is_default })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Insert a new category if it doesn't already exist; returns its name. */
  const ensureCategory = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return trimmed;
    const exists = categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (!exists) {
      const { data } = await supabase
        .from("expense_categories")
        .insert({ name: trimmed, is_default: false })
        .select("id, name, is_default")
        .maybeSingle();
      if (data) {
        setCategories((prev) =>
          [...prev, { id: data.id, name: data.name, isDefault: !!data.is_default }]
            .sort((a, b) => a.name.localeCompare(b.name)));
      }
    }
    return trimmed;
  }, [categories]);

  return { categories, loading, reload: load, ensureCategory };
}