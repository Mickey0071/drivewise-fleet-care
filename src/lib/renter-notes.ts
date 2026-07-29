// Local-storage backed store for admin-authored notes and incident/issue
// entries about a renter. Kept UI-side so we don't require a schema change.
import { useEffect, useState } from "react";

export type RenterNote = { id: string; at: string; text: string; author?: string };
export type RenterIssue = { id: string; at: string; text: string; author?: string };

type RenterData = { notes: RenterNote[]; issues: RenterIssue[] };

const KEY = "camauto:renter-notes:v1";
const listeners = new Set<() => void>();

function readAll(): Record<string, RenterData> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, RenterData>) : {};
  } catch {
    return {};
  }
}
function writeAll(data: Record<string, RenterData>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(data));
  listeners.forEach((l) => l());
}

export function getRenterData(driverId: string): RenterData {
  const all = readAll();
  return all[driverId] ?? { notes: [], issues: [] };
}

export function addRenterNote(driverId: string, text: string, author?: string) {
  const all = readAll();
  const bucket = all[driverId] ?? { notes: [], issues: [] };
  bucket.notes = [
    { id: crypto.randomUUID(), at: new Date().toISOString(), text, author },
    ...bucket.notes,
  ];
  all[driverId] = bucket;
  writeAll(all);
}

export function addRenterIssue(driverId: string, text: string, author?: string) {
  const all = readAll();
  const bucket = all[driverId] ?? { notes: [], issues: [] };
  bucket.issues = [
    { id: crypto.randomUUID(), at: new Date().toISOString(), text, author },
    ...bucket.issues,
  ];
  all[driverId] = bucket;
  writeAll(all);
}

export function useRenterData(driverId: string | null | undefined): RenterData {
  const [, setV] = useState(0);
  useEffect(() => {
    const fn = () => setV((v) => v + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return driverId ? getRenterData(driverId) : { notes: [], issues: [] };
}