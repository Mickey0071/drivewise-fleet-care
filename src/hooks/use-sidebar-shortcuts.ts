import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

export type Shortcut = { url: string; title: string; iconKey: string };

const EVENT = "sidebar-shortcuts:change";

function keyFor(userId: string | null | undefined) {
  return `sidebar-shortcuts:v1:${userId ?? "anon"}`;
}

function read(userId: string | null | undefined): Shortcut[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Shortcut[]).filter(s => s && typeof s.url === "string") : [];
  } catch { return []; }
}

function write(userId: string | null | undefined, list: Shortcut[]) {
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* ignore */ }
}

export function useSidebarShortcuts() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(() => read(uid));

  useEffect(() => {
    setShortcuts(read(uid));
    const onChange = () => setShortcuts(read(uid));
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [uid]);

  const isPinned = useCallback((url: string) => shortcuts.some(s => s.url === url), [shortcuts]);

  const togglePin = useCallback((item: Shortcut) => {
    const cur = read(uid);
    const exists = cur.some(s => s.url === item.url);
    const next = exists ? cur.filter(s => s.url !== item.url) : [...cur, item];
    write(uid, next);
  }, [uid]);

  const remove = useCallback((url: string) => {
    write(uid, read(uid).filter(s => s.url !== url));
  }, [uid]);

  const reorder = useCallback((orderedUrls: string[]) => {
    const cur = read(uid);
    const byUrl = new Map(cur.map(s => [s.url, s]));
    const next = orderedUrls.map(u => byUrl.get(u)).filter(Boolean) as Shortcut[];
    // Append any not in the ordered list (shouldn't happen, but safe)
    for (const s of cur) if (!orderedUrls.includes(s.url)) next.push(s);
    write(uid, next);
  }, [uid]);

  return { shortcuts, isPinned, togglePin, remove, reorder };
}