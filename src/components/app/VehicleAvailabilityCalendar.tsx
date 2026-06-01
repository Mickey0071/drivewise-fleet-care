import { useMemo } from "react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import {
  getVehicleBlocks,
  dateIsBlocked,
  rangeOverlapsBlocks,
  fmtBlockRange,
  type VehicleBlock,
} from "@/lib/vehicle-blocks";
import { AlertTriangle, Wrench, Car } from "lucide-react";
import { cn } from "@/lib/utils";

function toDate(s: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? undefined : d;
}
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface Props {
  vehicleId: string;
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
}

export function VehicleAvailabilityCalendar({ vehicleId, startDate, endDate, onChange }: Props) {
  const blocks = useMemo(() => getVehicleBlocks(vehicleId), [vehicleId]);

  const repairMatcher = (d: Date) => {
    const hit = dateIsBlocked(blocks, d);
    return hit?.kind === "repair";
  };
  const onRentMatcher = (d: Date) => {
    const hit = dateIsBlocked(blocks, d);
    return hit?.kind === "onrent";
  };
  const disabledMatcher = (d: Date) => !!dateIsBlocked(blocks, d);

  const selected: DateRange | undefined = useMemo(() => {
    const from = toDate(startDate);
    if (!from) return undefined;
    return { from, to: toDate(endDate) };
  }, [startDate, endDate]);

  const overlap: VehicleBlock | null = useMemo(() => {
    const from = toDate(startDate);
    if (!from) return null;
    return rangeOverlapsBlocks(blocks, from, toDate(endDate) ?? null);
  }, [blocks, startDate, endDate]);

  function handleSelect(range: DateRange | undefined) {
    if (!range?.from) {
      onChange("", "");
      return;
    }
    onChange(toISO(range.from), range.to ? toISO(range.to) : "");
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3">
        <Calendar
          mode="range"
          selected={selected}
          onSelect={handleSelect}
          disabled={disabledMatcher}
          excludeDisabled
          modifiers={{ repair: repairMatcher, onrent: onRentMatcher }}
          modifiersClassNames={{
            repair: "bg-destructive/20 text-destructive line-through",
            onrent: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
          }}
          className="pointer-events-auto"
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border bg-card" /> Available
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-blue-500/40" /> On Rent (blocked)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-destructive/40" /> In Repair (blocked)
          </span>
        </div>
      </div>

      {blocks.length > 0 && (
        <div className="space-y-1.5">
          {blocks.map((b, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
                b.kind === "repair"
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-300",
              )}
            >
              {b.kind === "repair" ? <Wrench className="h-3.5 w-3.5" /> : <Car className="h-3.5 w-3.5" />}
              <span className="font-medium">{b.label}</span>
              <span className="opacity-80">
                {fmtBlockRange(b)}
                {b.to === null && " — until returned"}
              </span>
            </div>
          ))}
        </div>
      )}

      {overlap && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/60 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Vehicle unavailable {fmtBlockRange(overlap)}. Blocked for{" "}
            {overlap.kind === "repair" ? "Repair" : "On Rent"}. Pick different dates.
          </span>
        </div>
      )}
    </div>
  );
}
