import { maintenance, rentals, vehicles, type Rental, type Maintenance } from "@/lib/mock/data";
import { summarizeOpenIssue } from "@/lib/maintenance-utils";

export type VehicleBlockKind = "repair" | "onrent" | "manual";

export interface VehicleBlock {
  kind: VehicleBlockKind;
  /** Short label, e.g. "Repair: Transmission" or "On Rent". */
  label: string;
  from: Date;
  /** null = indefinite (no end / no return date). */
  to: Date | null;
}

function parseDay(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Does a rental currently block the vehicle (not returned, active/pending)? */
function rentalIsBlocking(r: Rental): boolean {
  if (r.returnedAt) return false;
  const rs = r.reservationStatus ?? "active";
  return rs === "active" || rs === "pending";
}

function rentalBlockEnd(r: Rental): Date | null {
  const status = r.reservationStatus ?? "active";
  if (status === "active") return null;
  return parseDay(r.endDate ?? null);
}

/** Estimated end of an open repair: parsed "Estimated return" → nextServiceDue → null. */
function repairEnd(m: Maintenance): Date | null {
  const summary = summarizeOpenIssue(m);
  return parseDay(summary.estimatedReturn) ?? parseDay(m.nextServiceDue) ?? null;
}

/** All active blocks (maintenance repairs + on-rent windows) for a vehicle. */
export function getVehicleBlocks(vehicleId: string): VehicleBlock[] {
  const blocks: VehicleBlock[] = [];
  const vehicle = vehicles.find(v => v.id === vehicleId);

  if (vehicle && ["maintenance", "impound", "inspection"].includes(vehicle.status)) {
    blocks.push({
      kind: "manual",
      label: `Unavailable: ${vehicle.status === "inspection" ? "Inspection" : vehicle.status === "impound" ? "Impound" : "Maintenance"}`,
      from: startOfDay(new Date()),
      to: null,
    });
  }

  // Open maintenance issues (repair tickets) — hard block.
  for (const m of maintenance) {
    if (m.vehicleId !== vehicleId) continue;
    if (m.dateCompleted) continue; // only OPEN issues block
    const from = parseDay(m.createdAt) ?? parseDay(m.nextServiceDue) ?? startOfDay(new Date());
    const summary = summarizeOpenIssue(m);
    blocks.push({
      kind: "repair",
      label: `Repair: ${summary.issue}`,
      from: startOfDay(from),
      to: repairEnd(m),
    });
  }

  // On-rent windows — hard block.
  for (const r of rentals) {
    if (r.vehicleId !== vehicleId) continue;
    if (!rentalIsBlocking(r)) continue;
    const from = parseDay(r.startDate);
    if (!from) continue;
    blocks.push({
      kind: "onrent",
      label: "On Rent",
      from: startOfDay(from),
      to: rentalBlockEnd(r),
    });
  }

  return blocks;
}

/** Is `date` inside any block? */
export function dateIsBlocked(blocks: VehicleBlock[], date: Date): VehicleBlock | null {
  const d = startOfDay(date).getTime();
  for (const b of blocks) {
    const from = b.from.getTime();
    const to = b.to ? b.to.getTime() : Infinity;
    if (d >= from && d <= to) return b;
  }
  return null;
}

/** Does the selected [start, end] window overlap any block? Returns the block. */
export function rangeOverlapsBlocks(
  blocks: VehicleBlock[],
  start: Date,
  end: Date | null,
): VehicleBlock | null {
  const s = startOfDay(start).getTime();
  const e = end ? startOfDay(end).getTime() : s;
  for (const b of blocks) {
    const from = b.from.getTime();
    const to = b.to ? b.to.getTime() : Infinity;
    if (s <= to && e >= from) return b;
  }
  return null;
}

export function fmtBlockRange(b: VehicleBlock): string {
  const f = b.from.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const t = b.to
    ? b.to.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "indefinite";
  return `${f} – ${t}`;
}
