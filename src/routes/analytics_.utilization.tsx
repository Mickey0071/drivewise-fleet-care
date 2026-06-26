import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useStoreVersion } from "@/lib/mock/store";
import { rentals, vehicles, vehicleById, type Rental } from "@/lib/mock/data";
import { Car, Activity, Clock } from "lucide-react";

export const Route = createFileRoute("/analytics_/utilization")({
  head: () => ({ meta: [{ title: "Utilization — Analytics — Camauto Rentals" }] }),
  component: Page,
});

// ---------- date helpers (local YYYY-MM-DD) ----------
const DAY = 86_400_000;
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parse(s: string) { return new Date(s.slice(0, 10) + "T00:00:00"); }
function addDays(s: string, n: number) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
function daysBetween(a: string, b: string) { return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY); }

const today = iso(new Date());

/** A rental that never actually put a car on the road (cancelled). */
function isVoid(r: Rental): boolean {
  return (r.reservationStatus ?? "active") === "cancelled";
}

/** Last day a rental occupied its vehicle (returned date, end date, or today for ongoing). */
function occupancyEnd(r: Rental): string {
  if (r.returnedAt) return r.returnedAt.slice(0, 10);
  if (r.endDate) {
    // ongoing/active rentals with a past end date are still out until returned
    const status = r.reservationStatus ?? "active";
    if (status === "active" || status === "pending") return today;
    return r.endDate.slice(0, 10);
  }
  return today;
}

/** Does this rental occupy its vehicle on calendar day D (inclusive)? */
function coversDay(r: Rental, d: string): boolean {
  if (isVoid(r)) return false;
  const start = r.startDate?.slice(0, 10);
  if (!start) return false;
  return start <= d && d <= occupancyEnd(r);
}

type Period = 7 | 30 | 90 | 0; // 0 = all time

function Page() {
  useStoreVersion();
  const [period, setPeriod] = useState<Period>(30);

  // ----- CURRENT UTILIZATION (live) -----
  const totalFleet = vehicles.length;
  const activeVehicleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rentals) if (coversDay(r, today)) ids.add(r.vehicleId);
    return ids;
  }, [rentals.length, vehicles.length]);
  const activeCount = activeVehicleIds.size;
  const currentPct = totalFleet > 0 ? Math.round((activeCount / totalFleet) * 100) : 0;

  // ----- selected period range -----
  const periodFrom = useMemo(() => {
    if (period === 0) {
      let earliest = today;
      for (const r of rentals) {
        if (isVoid(r)) continue;
        const s = r.startDate?.slice(0, 10);
        if (s && s < earliest) earliest = s;
      }
      return earliest;
    }
    return addDays(today, -(period - 1));
  }, [period, rentals.length]);
  const periodDays = daysBetween(periodFrom, today) + 1;

  // ----- HISTORICAL CHART: last 30 days utilization % per day -----
  const chartData = useMemo(() => {
    const out: { date: string; label: string; pct: number; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDays(today, -i);
      let count = 0;
      for (const r of rentals) if (coversDay(r, d)) count++;
      // count distinct vehicles
      const ids = new Set<string>();
      for (const r of rentals) if (coversDay(r, d)) ids.add(r.vehicleId);
      const dd = parse(d);
      out.push({
        date: d,
        label: `${dd.getMonth() + 1}/${dd.getDate()}`,
        count: ids.size,
        pct: totalFleet > 0 ? Math.round((ids.size / totalFleet) * 100) : 0,
      });
    }
    return out;
  }, [rentals.length, totalFleet]);

  // ----- PER-VEHICLE BREAKDOWN (selected period) -----
  const perVehicle = useMemo(() => {
    return vehicles.map((v) => {
      let daysRented = 0;
      for (let i = 0; i < periodDays; i++) {
        const d = addDays(periodFrom, i);
        if (d > today) break;
        if (rentals.some((r) => r.vehicleId === v.id && coversDay(r, d))) daysRented++;
      }
      const daysIdle = periodDays - daysRented;
      const pct = periodDays > 0 ? Math.round((daysRented / periodDays) * 100) : 0;
      return {
        id: v.id,
        label: `${v.year} ${v.make} ${v.model}`.trim() || v.plate || v.id,
        plate: v.plate,
        daysRented,
        daysIdle,
        pct,
      };
    }).sort((a, b) => b.pct - a.pct);
  }, [vehicles.length, rentals.length, periodFrom, periodDays]);

  // ----- IDLE RIGHT NOW -----
  const idleNow = useMemo(() => {
    return vehicles
      .filter((v) => !activeVehicleIds.has(v.id))
      .map((v) => {
        let lastEnd: string | null = null;
        for (const r of rentals) {
          if (r.vehicleId !== v.id || isVoid(r)) continue;
          const end = occupancyEnd(r);
          if (end < today && (!lastEnd || end > lastEnd)) lastEnd = end;
        }
        return {
          id: v.id,
          label: `${v.year} ${v.make} ${v.model}`.trim() || v.plate || v.id,
          plate: v.plate,
          daysSince: lastEnd ? daysBetween(lastEnd, today) : null,
        };
      })
      .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity) === 0 ? 0 : (b.daysSince ?? 99999) - (a.daysSince ?? 99999));
  }, [vehicles.length, rentals.length, activeVehicleIds]);

  const periodLabel = period === 0 ? "All time" : `Last ${period} days`;

  return (
    <div>
      <PageHeader title="📈 Utilization" subtitle="Fleet usage and idle vehicles" />

      {/* CURRENT UTILIZATION */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="sm:col-span-1">
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Activity className="mb-2 h-5 w-5 text-muted-foreground" />
            <div className="text-5xl font-bold tracking-tight text-foreground">{currentPct}%</div>
            <p className="mt-2 text-sm text-muted-foreground">
              {activeCount} of {totalFleet} vehicles on rent right now
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Car className="mb-2 h-5 w-5 text-emerald-500" />
            <div className="text-4xl font-bold text-foreground">{activeCount}</div>
            <p className="mt-2 text-sm text-muted-foreground">Active rentals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Clock className="mb-2 h-5 w-5 text-amber-500" />
            <div className="text-4xl font-bold text-foreground">{totalFleet - activeCount}</div>
            <p className="mt-2 text-sm text-muted-foreground">Idle vehicles</p>
          </CardContent>
        </Card>
      </div>

      {/* HISTORICAL CHART */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Daily utilization — last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <Tooltip
                formatter={(v: number, _n, p: any) => [`${v}% (${p.payload.count} cars)`, "Utilization"]}
                labelFormatter={(l) => `Day ${l}`}
              />
              <Bar dataKey="pct" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* TIME FILTERS */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Period:</span>
        {([7, 30, 90, 0] as Period[]).map((p) => (
          <Button
            key={p}
            size="sm"
            variant={period === p ? "default" : "outline"}
            onClick={() => setPeriod(p)}
          >
            {p === 0 ? "All time" : `Last ${p} days`}
          </Button>
        ))}
      </div>

      {/* PER-VEHICLE BREAKDOWN */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Per-vehicle utilization — {periodLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle</TableHead>
                <TableHead className="text-right">Days rented</TableHead>
                <TableHead className="text-right">Days idle</TableHead>
                <TableHead className="text-right">Utilization</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perVehicle.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{v.label}</div>
                    {v.plate && <div className="text-xs text-muted-foreground">{v.plate}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{v.daysRented}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{v.daysIdle}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={v.pct >= 70 ? "default" : v.pct >= 30 ? "secondary" : "outline"}>
                      {v.pct}%
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {perVehicle.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No vehicles.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* IDLE NOW */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Idle right now ({idleNow.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {idleNow.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every vehicle is on rent today. 🎉</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead className="text-right">Days since last rental</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {idleNow.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{v.label}</div>
                      {v.plate && <div className="text-xs text-muted-foreground">{v.plate}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.daysSince === null
                        ? <span className="text-muted-foreground">Never rented</span>
                        : `${v.daysSince} day${v.daysSince === 1 ? "" : "s"}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
