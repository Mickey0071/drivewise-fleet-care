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

export function SwapHistoryTimeline({ rental }: { rental: Rental }) {
  const swapsAsc = [...(rental.swapHistory ?? [])].sort((a, b) =>
    a.swappedAt.localeCompare(b.swappedAt),
  );
  if (swapsAsc.length === 0) return null;
  const swaps = [...swapsAsc].reverse();

  // Full ordered chain of every vehicle on this reservation:
  // original (first swap's old) → each subsequent new vehicle. Last = current.
  const chain: string[] = [
    swapsAsc[0].oldVehicleLabel ?? swapsAsc[0].oldVehicleId,
    ...swapsAsc.map((s) => s.newVehicleLabel ?? s.newVehicleId),
  ];

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <Repeat className="h-3.5 w-3.5" /> Swap history ({swaps.length})
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {chain.map((label, i) => {
          const isCurrent = i === chain.length - 1;
          return (
            <span key={`${label}-${i}`} className="flex items-center gap-1.5">
              <span
                className={
                  isCurrent
                    ? "rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-foreground"
                    : "rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                }
              >
                {label}
                {isCurrent && " · current"}
              </span>
              {!isCurrent && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
            </span>
          );
        })}
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