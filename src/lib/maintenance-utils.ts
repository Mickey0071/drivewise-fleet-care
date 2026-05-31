import type { Maintenance } from "@/lib/mock/data";

// Issue tickets (repairs) are created via AddIssueDialog, which writes an
// "Issue opened" marker as the first notes line. Everything else is treated
// as routine service-log maintenance (logged via LogServiceDialog).
export function isIssueRecord(m: Maintenance): boolean {
  if (!m.dateCompleted) return true; // open tickets are always issues
  const notes = m.notes ?? "";
  return notes.includes("Issue opened") || notes.includes("Resolved ");
}

export function isServiceLogRecord(m: Maintenance): boolean {
  return !!m.dateCompleted && !isIssueRecord(m);
}

// Most recent completed routine service for a vehicle.
export function lastServiceFor(list: Maintenance[], vehicleId: string): Maintenance | undefined {
  return list
    .filter((m) => m.vehicleId === vehicleId && isServiceLogRecord(m))
    .sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""))[0];
}