import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type NavLayout = {
  navOrder: string[]; // item_keys (urls) in the user's chosen order
  shortcuts: string[]; // item_keys (urls) pinned to the top, in order
};

const EMPTY: NavLayout = { navOrder: [], shortcuts: [] };

const EVENT = "nav-layout:change";

/**
 * Per-user sidebar arrangement (flat item order + starred shortcuts) stored in
 * `user_nav_layout`. Each user only ever sees/edits their own rows via RLS.
 */
export function useNavLayout() {
  const { user } = useAuth();
  const [layout, setLayout] = useState<NavLayout>({ ...EMPTY });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setLayout({ ...EMPTY });
      setLoaded(true);
      return;
    }
    const { data, error } = await supabase
      .from("user_nav_layout")
      .select("item_key, position, sort_order")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true });
    if (error) {
      setLayout({ ...EMPTY });
      setLoaded(true);
      return;
    }
    const navOrder: string[] = [];
    const shortcuts: string[] = [];
    for (const r of data ?? []) {
      if (r.position === "shortcut") shortcuts.push(r.item_key);
      else navOrder.push(r.item_key);
    }
    setLayout({ navOrder, shortcuts });
    setLoaded(true);
  }, [user]);

  useEffect(() => {
    load();
    const onChange = () => load();
    if (typeof window !== "undefined") {
      window.addEventListener(EVENT, onChange);
      return () => window.removeEventListener(EVENT, onChange);
    }
  }, [load]);

  const replaceSection = useCallback(
    async (position: "nav" | "shortcut", orderedKeys: string[]) => {
      // Optimistic
      setLayout((prev) => ({
        ...prev,
        ...(position === "nav" ? { navOrder: orderedKeys } : { shortcuts: orderedKeys }),
      }));
      if (!user) return;
      await supabase
        .from("user_nav_layout")
        .delete()
        .eq("user_id", user.id)
        .eq("position", position);
      if (orderedKeys.length > 0) {
        await supabase.from("user_nav_layout").insert(
          orderedKeys.map((item_key, idx) => ({
            user_id: user.id,
            item_key,
            position,
            is_starred_shortcut: position === "shortcut",
            sort_order: idx,
          })),
        );
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(EVENT));
      }
    },
    [user],
  );

  const setNavOrder = useCallback(
    (orderedKeys: string[]) => replaceSection("nav", orderedKeys),
    [replaceSection],
  );

  const setShortcuts = useCallback(
    (orderedKeys: string[]) => replaceSection("shortcut", orderedKeys),
    [replaceSection],
  );

  const toggleStar = useCallback(
    async (itemKey: string) => {
      const cur = layout.shortcuts;
      const next = cur.includes(itemKey)
        ? cur.filter((k) => k !== itemKey)
        : [...cur, itemKey];
      await setShortcuts(next);
    },
    [layout.shortcuts, setShortcuts],
  );

  const isStarred = useCallback(
    (itemKey: string) => layout.shortcuts.includes(itemKey),
    [layout.shortcuts],
  );

  const reset = useCallback(async () => {
    setLayout({ ...EMPTY });
    if (!user) return;
    await supabase.from("user_nav_layout").delete().eq("user_id", user.id);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(EVENT));
    }
  }, [user]);

  return {
    layout,
    loaded,
    setNavOrder,
    setShortcuts,
    toggleStar,
    isStarred,
    reset,
  };
}

/**
 * Reorder `items` (identified by `keyOf`) by the given saved key order. Any
 * items not in the saved order are appended at the end in their original
 * position — so newly added navigation items surface automatically.
 */
export function applyOrder<T>(
  items: T[],
  keyOf: (item: T) => string,
  order: string[] | undefined,
): T[] {
  if (!order || order.length === 0) return items;
  const orderIndex = new Map(order.map((k, i) => [k, i]));
  // Items known to the saved order, in saved-order sequence.
  const known = [...items]
    .filter(i => orderIndex.has(keyOf(i)))
    .sort((a, b) => orderIndex.get(keyOf(a))! - orderIndex.get(keyOf(b))!);
  // Items added since the user saved their order — reinsert at their
  // original default position so new nav entries don't get exiled to the bottom.
  const result = [...known];
  items.forEach((item, defaultIdx) => {
    if (orderIndex.has(keyOf(item))) return;
    // Find nearest earlier default sibling that is already placed.
    let insertAt = result.length;
    for (let i = 0; i < result.length; i++) {
      const siblingDefaultIdx = items.findIndex(x => keyOf(x) === keyOf(result[i]));
      if (siblingDefaultIdx > defaultIdx) { insertAt = i; break; }
    }
    result.splice(insertAt, 0, item);
  });
  return result;
}