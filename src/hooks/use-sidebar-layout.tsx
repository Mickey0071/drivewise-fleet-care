import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type SidebarLayout = {
  groupOrder: string[];
  itemOrder: Record<string, string[]>;
  locked: boolean;
};

const EMPTY: SidebarLayout = { groupOrder: [], itemOrder: {}, locked: true };

function coerce(raw: unknown): SidebarLayout {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const r = raw as Record<string, unknown>;
  return {
    groupOrder: Array.isArray(r.groupOrder) ? (r.groupOrder as string[]) : [],
    itemOrder:
      r.itemOrder && typeof r.itemOrder === "object"
        ? (r.itemOrder as Record<string, string[]>)
        : {},
    locked: typeof r.locked === "boolean" ? r.locked : true,
  };
}

/**
 * Loads + persists the current user's sidebar arrangement (category order,
 * per-group link order, and locked state) in the backend so it follows the
 * user across devices.
 */
export function useSidebarLayout() {
  const { user } = useAuth();
  const [layout, setLayout] = useState<SidebarLayout>({ ...EMPTY });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) {
      setLayout({ ...EMPTY });
      setLoaded(true);
      return;
    }
    setLoaded(false);
    supabase
      .from("user_ui_prefs")
      .select("sidebar_layout")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setLayout(coerce(data?.sidebar_layout));
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const save = useCallback(
    async (next: SidebarLayout) => {
      setLayout(next);
      if (!user) return;
      await supabase
        .from("user_ui_prefs")
        .upsert(
          { user_id: user.id, sidebar_layout: next as unknown as never },
          { onConflict: "user_id" },
        );
    },
    [user],
  );

  return { layout, setLayout, save, loaded };
}

/** Order `keys` by a saved order, appending any new keys not yet saved. */
export function applyOrder<T>(
  items: T[],
  keyOf: (item: T) => string,
  order: string[] | undefined,
): T[] {
  if (!order || order.length === 0) return items;
  const index = new Map(order.map((k, i) => [k, i]));
  return [...items].sort((a, b) => {
    const ai = index.has(keyOf(a)) ? index.get(keyOf(a))! : Number.MAX_SAFE_INTEGER;
    const bi = index.has(keyOf(b)) ? index.get(keyOf(b))! : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}