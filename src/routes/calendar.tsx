import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { rentals, vehicles, driverById, fmtDate } from "@/lib/mock/data";
import { useStoreVersion, pendingExpiresAt } from "@/lib/mock/store";
import { getVehicleBlocks } from "@/lib/vehicle-blocks";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/calendar")({
  head: () => ({ meta: [{ title: "Calendar — Camauto Rentals" }] }),
  component: CalendarPage,
});

const DAYS = 21;
const DAY_MS = 86_400_000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function CalendarPage() {
  useStoreVersion();
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const days = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => new Date(anchor.getTime() + i * DAY_MS)),
    [anchor],
  );
  const rangeStart = anchor.getTime();
  const rangeEnd = rangeStart + DAYS * DAY_MS;

  function shift(deltaDays: number) {
    setAnchor(startOfDay(new Date(anchor.getTime() + deltaDays * DAY_MS)));
  }

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Vehicle availability — on-rent in blue, pending holds in amber, repairs/manual blocks in red"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => shift(-7)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>Today</Button>
            <Button variant="outline" size="sm" onClick={() => shift(7)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-primary/80" /> On Rent</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-amber-500/40" /> Pending hold</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-destructive/70" /> In Repair / manual block</span>
      </div>
      <Card className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="flex border-b">
            <div className="w-[220px] shrink-0 p-2 text-xs font-medium text-muted-foreground">Vehicle</div>
            <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${DAYS}, minmax(38px, 1fr))` }}>
              {days.map(d => {
                const isToday = d.getTime() === startOfDay(new Date()).getTime();
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div
                    key={d.toISOString()}
                    className={`p-1 text-center text-[10px] border-l ${isToday ? "bg-primary/10 font-bold text-primary" : isWeekend ? "bg-muted/40 text-muted-foreground" : "text-muted-foreground"}`}
                  >
                    <div>{d.toLocaleDateString("en-US", { weekday: "short" })[0]}</div>
                    <div>{d.getDate()}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {vehicles.map(v => {
            const vRentals = rentals.filter(r => r.vehicleId === v.id);
            const vehicleBlocks = getVehicleBlocks(v.id);
            const hasRenderedRentalBlock = vRentals.some(r => r.reservationStatus !== "returned" && !r.returnedAt);
            return (
              <div key={v.id} className={`flex border-b last:border-b-0 hover:bg-muted/20 ${!isVehicleVisibleAsAvailable(v) ? "bg-muted/20" : ""}`}>
                <div className="w-[220px] shrink-0 p-2 text-sm">
                  <div className="font-medium truncate">{v.year} {v.make} {v.model}</div>
                  <div className="text-xs text-muted-foreground">{v.plate}</div>
                </div>
                <div className="relative flex-1 min-h-[52px]">
                  <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${DAYS}, minmax(38px, 1fr))` }}>
                    {days.map((d, i) => (
                      <div key={i} className="border-l h-full min-h-[52px]" />
                    ))}
                  </div>
                  {vehicleBlocks
                    .filter(b => b.kind !== "onrent" || !hasRenderedRentalBlock)
                    .map((b, bi) => {
                      const bs = b.from.getTime();
                      const be = (b.to ? b.to.getTime() : rangeEnd) + DAY_MS;
                      if (be <= rangeStart || bs >= rangeEnd) return null;
                      const startIdx = Math.max(0, Math.floor((bs - rangeStart) / DAY_MS));
                      const endIdx = Math.min(DAYS, Math.ceil((be - rangeStart) / DAY_MS));
                      const span = Math.max(1, endIdx - startIdx);
                      return (
                        <div
                          key={`block-${bi}`}
                          className={`absolute top-1 bottom-1 rounded px-2 text-xs flex items-center overflow-hidden ${b.kind === "onrent" ? "bg-primary/80 text-primary-foreground border border-primary" : "bg-destructive/80 text-destructive-foreground border border-destructive"}`}
                          style={{
                            left: `calc(${(startIdx / DAYS) * 100}% + 2px)`,
                            width: `calc(${(span / DAYS) * 100}% - 4px)`,
                          }}
                          title={`${b.label}${b.to === null ? b.kind === "onrent" ? " — blocked until returned" : " — until repair complete" : ""}`}
                        >
                          <span className="truncate">{b.kind === "onrent" ? "🚙" : b.kind === "repair" ? "🔧" : "⛔"} {b.label}{b.kind === "onrent" && b.to === null ? " — until returned" : ""}</span>
                        </div>
                      );
                    })}
                  {vRentals.map(r => {
                    // Returned rentals free up the vehicle — don't block the calendar.
                    if (r.reservationStatus === "returned" || r.returnedAt) return null;
                    const rs = new Date(r.startDate).getTime();
                    const isPending = r.reservationStatus === "pending";
                    const exp = pendingExpiresAt(r);
                    // Active/on-rent means the car is physically out. Keep it
                    // blocked indefinitely until returned, even if an expected
                    // end date exists.
                    const openEnded = !isPending;
                    const re = r.endDate
                      ? (isPending ? new Date(r.endDate).getTime() + DAY_MS : rangeEnd)
                      : isPending && exp
                        ? exp
                        : rangeEnd;
                    if (re <= rangeStart || rs >= rangeEnd) return null;
                    const startIdx = Math.max(0, Math.floor((rs - rangeStart) / DAY_MS));
                    const endIdx = Math.min(DAYS, Math.ceil((re - rangeStart) / DAY_MS));
                    const span = Math.max(1, endIdx - startIdx);
                    const d = driverById(r.driverId);
                    return (
                      <Link
                        to="/rentals"
                        key={r.id}
                        className={`absolute top-1 bottom-1 rounded px-2 text-xs flex items-center overflow-hidden hover:opacity-80 ${
                          isPending
                            ? "bg-amber-500/25 text-amber-900 dark:text-amber-200 border border-amber-500/40"
                            : "bg-primary/80 text-primary-foreground border border-primary"
                        }`}
                        style={{
                          left: `calc(${(startIdx / DAYS) * 100}% + 2px)`,
                          width: `calc(${(span / DAYS) * 100}% - 4px)`,
                        }}
                        title={`${d?.fullName ?? r.driverId} · ${fmtDate(r.startDate)}${r.endDate ? ` → ${fmtDate(r.endDate)}` : ""}${isPending ? " · PENDING HOLD" : " · ON RENT — blocked until returned"}`}
                      >
                        <span className="truncate">
                          {isPending ? "⏳ " : ""}{openEnded ? "🚙 " : ""}{d?.fullName ?? r.driverId}
                          {openEnded ? " · ON RENT — until returned" : ""}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function isVehicleVisibleAsAvailable(v: { status: string; hasOpenIssues?: boolean }) {
  return v.status === "available" && !v.hasOpenIssues;
}