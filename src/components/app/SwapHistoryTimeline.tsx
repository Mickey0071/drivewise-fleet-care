import { ArrowRight, Repeat, User } from "lucide-react";
import type { Rental } from "@/lib/mock/data";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDay(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function SwapHistoryTimeline({ rental }: { rental: Rental }) {
  const swapsAsc = [...(rental.swapHistory ?? [])].sort((a, b) =>
    a.swappedAt.localeCompare(b.swappedAt),
  );
  if (swapsAsc.length === 0) return null;
  const swaps = [...swapsAsc].reverse();

  // Every vehicle assigned to this reservation over its life, each with the
  // date range it was on the reservation:
  //   Vehicle A (rental start → first swap) → Vehicle B (swap1 → swap2) → …
  //   → current vehicle (last swap → reservation end / active).
  const ended = rental.returnedAt ?? rental.endDate ?? null;
  const segments: { label: string; from: string; to: string | null; current: boolean }[] = [];
  segments.push({
    label: swapsAsc[0].oldVehicleLabel ?? swapsAsc[0].oldVehicleId,
    from: rental.startDate,
    to: swapsAsc[0].swappedAt,
    current: false,
  });
  swapsAsc.forEach((s, i) => {
    const next = swapsAsc[i + 1];
    segments.push({
      label: s.newVehicleLabel ?? s.newVehicleId,
      from: s.swappedAt,
      to: next ? next.swappedAt : ended,
      current: !next,
    });
  });

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <Repeat className="h-3.5 w-3.5" /> Vehicles on this reservation ({segments.length})
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {segments.map((seg, i) => (
          <span key={`${seg.label}-${i}`} className="flex items-center gap-1.5">
            <span
              className={
                seg.current
                  ? "rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-foreground"
                  : "rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
              }
            >
              <span className="font-medium">{seg.label}</span>
              <span className="ml-1 opacity-80">
                ({fmtDay(seg.from)} – {seg.current ? (seg.to ? fmtDay(seg.to) : "current") : fmtDay(seg.to)})
              </span>
              {seg.current && <span className="ml-1 font-semibold text-primary">· active</span>}
            </span>
            {i < segments.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
          </span>
        ))}
      </div>
      <ol className="relative space-y-4 border-l border-border pl-4">
        {swaps.map((s) => (
          <li key={s.id} className="relative">
            <span className="absolute -left-[21px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 border-primary bg-background" />
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
              <span className="text-muted-foreground line-through">
                {s.oldVehicleLabel ?? s.oldVehicleId}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{s.newVehicleLabel ?? s.newVehicleId}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {fmtDateTime(s.swappedAt)}
            </div>
            {s.swappedBy && (
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" /> {s.swappedBy}
              </div>
            )}
            {s.reason && (
              <div className="mt-1 text-xs">
                <span className="text-muted-foreground">Reason: </span>
                {s.reason}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}