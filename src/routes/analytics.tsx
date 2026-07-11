import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStoreVersion } from "@/lib/mock/store";
import { vehicles, maintenance, vehicleById, fmtMoney } from "@/lib/mock/data";
import { activeVehicles } from "@/lib/mock/store";
import type { Maintenance } from "@/lib/mock/data";
import { listPendingApprovals } from "@/lib/repair-actions.functions";

export const Route = createFileRoute("/analytics")({
  head: () => ({ meta: [{ title: "Repair Analytics — Camauto Rentals" }] }),
  component: AnalyticsHub,
});

const RATE_KEY = "fleet_default_daily_rate";
const DEFAULT_RATE = 40;

function vLabel(id: string) {
  const v = vehicleById(id);
  if (!v) return id;
  return `${v.year} ${v.make} ${v.model}`.trim() || (v.plate ?? id);
}

/** Days a repair has spent in the shop (whole days, min 0). */
function daysInShop(m: Maintenance, now: number): number {
  const created = m.createdAt ? new Date(m.createdAt).getTime() : NaN;
  if (isNaN(created)) return 0;
  const end = m.completionDate || m.dateCompleted
    ? new Date((m.completionDate ?? m.dateCompleted) as string).getTime()
    : now;
  return Math.max(0, Math.round((end - created) / 86_400_000));
}

/** Actual repair cost: parts+labor, fall back to cost when both are 0. */
function repairCostOf(m: Maintenance): number {
  const parts = m.partsCost ?? 0;
  const labor = m.laborCost ?? 0;
  if (parts === 0 && labor === 0) return m.cost ?? 0;
  return parts + labor;
}

function AnalyticsHub() {
  useStoreVersion();

  // --- Daily rate: per-vehicle dailyRate (or weeklyRate/7), else fleet default ---
  const [fleetRate, setFleetRate] = useState<number>(DEFAULT_RATE);
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(RATE_KEY) : null;
    if (saved && !isNaN(Number(saved))) setFleetRate(Number(saved));
  }, []);
  function updateFleetRate(v: string) {
    const n = Number(v);
    setFleetRate(isNaN(n) ? 0 : n);
    if (typeof window !== "undefined") window.localStorage.setItem(RATE_KEY, v);
  }
  function dailyRateFor(vehicleId: string): number {
    const v = vehicleById(vehicleId);
    if (v) {
      if (v.dailyRate && v.dailyRate > 0) return v.dailyRate;
      if (v.weeklyRate && v.weeklyRate > 0) return v.weeklyRate / 7;
    }
    return fleetRate;
  }
  const anyVehicleRate = vehicles.some(v => (v.dailyRate && v.dailyRate > 0) || (v.weeklyRate && v.weeklyRate > 0));
  const rateCaption = anyVehicleRate
    ? `Using each vehicle's own daily rate (weekly ÷ 7 where only a weekly rate exists); falling back to the fleet default of ${fmtMoney(fleetRate)}/day.`
    : `No per-vehicle rate found — using the fleet default of ${fmtMoney(fleetRate)}/day for all vehicles.`;

  // --- Pending approvals (same source as PendingApprovalsCard) ---
  const pendingFn = useServerFn(listPendingApprovals);
  const { data: pendingData } = useQuery({
    queryKey: ["pending-repair-approvals"],
    queryFn: () => pendingFn(),
    refetchInterval: 5 * 60 * 1000,
  });
  const awaitingApproval = (pendingData?.pending ?? []).length;

  const monthKey = new Date().toISOString().slice(0, 7);
  const now = Date.now();

  const data = useMemo(() => {
    // Match the kanban: repairs are status-tracked, non-pending/rejected.
    const repairs = maintenance.filter(
      m => !!m.status && m.approvalStatus !== "pending" && m.approvalStatus !== "rejected",
    );
    const completed = repairs.filter(m => m.status === "complete");
    const completedThisMonth = completed.filter(
      m => (m.completionDate ?? m.dateCompleted ?? "").slice(0, 7) === monthKey,
    );
    const openRepairs = repairs.filter(m => m.status !== "complete");

    // Section 1 metrics
    const repairSpend = completedThisMonth.reduce((s, m) => s + repairCostOf(m), 0);

    // Blocking repairs this month (completed this month OR currently open)
    const blockingThisMonth = [
      ...completedThisMonth.filter(m => m.isRentalBlocking),
      ...openRepairs.filter(m => m.isRentalBlocking),
    ];
    const rentalLost = blockingThisMonth.reduce(
      (s, m) => s + daysInShop(m, now) * dailyRateFor(m.vehicleId), 0,
    );

    const carsDownNow = new Set(
      openRepairs.filter(m => m.isRentalBlocking).map(m => m.vehicleId),
    ).size;

    const avgDaysInShop = completedThisMonth.length
      ? completedThisMonth.reduce((s, m) => s + daysInShop(m, now), 0) / completedThisMonth.length
      : 0;

    const totalFleetImpact = repairSpend + rentalLost;

    // Section 2 — repair cost by vehicle (this month)
    const costByVehicle = new Map<string, number>();
    for (const m of completedThisMonth) {
      costByVehicle.set(m.vehicleId, (costByVehicle.get(m.vehicleId) ?? 0) + repairCostOf(m));
    }
    const costBars = [...costByVehicle.entries()]
      .map(([id, amount]) => ({ id, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    // Section 3 — rental income lost by vehicle
    const lostByVehicle = new Map<string, { days: number; amount: number }>();
    for (const m of blockingThisMonth) {
      const d = daysInShop(m, now);
      const prev = lostByVehicle.get(m.vehicleId) ?? { days: 0, amount: 0 };
      lostByVehicle.set(m.vehicleId, {
        days: prev.days + d,
        amount: prev.amount + d * dailyRateFor(m.vehicleId),
      });
    }
    const lostBars = [...lostByVehicle.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    // Section 4 — parts vs labour (this month)
    let partsTotal = 0, laborTotal = 0;
    for (const m of completedThisMonth) {
      partsTotal += m.partsCost ?? 0;
      laborTotal += m.laborCost ?? 0;
    }

    // Section 5 — top problems by category (this month, skip null)
    const catCounts = new Map<string, number>();
    for (const m of completedThisMonth) {
      const c = (m.problemCategory ?? "").trim();
      if (!c) continue;
      catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
    }
    const catBars = [...catCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    // Section 6 — pipeline (same filters as kanban)
    const pipeline = {
      reported: maintenance.filter(m => m.status === "reported").length,
      diagnosing: maintenance.filter(m => m.status === "diagnosing").length,
      pendingComplete: maintenance.filter(m => m.status === "pending_complete").length,
      completeThisMonth: completedThisMonth.length,
    };

    return {
      repairSpend, rentalLost, carsDownNow, avgDaysInShop, totalFleetImpact,
      costBars, lostBars, partsTotal, laborTotal, catBars, pipeline,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, fleetRate]);

  const metrics = [
    { label: "Repair spend (this month)", value: fmtMoney(Math.round(data.repairSpend)) },
    { label: "Rental income lost", value: fmtMoney(Math.round(data.rentalLost)) },
    { label: "Cars down now", value: String(data.carsDownNow) },
    { label: "Avg days in shop", value: `${Math.round(data.avgDaysInShop)} d` },
    { label: "Awaiting approval", value: String(awaitingApproval) },
    { label: "Total fleet impact", value: fmtMoney(Math.round(data.totalFleetImpact)) },
  ];

  const maxCost = Math.max(1, ...data.costBars.map(b => b.amount));
  const maxLost = Math.max(1, ...data.lostBars.map(b => b.amount));
  const maxCat = Math.max(1, ...data.catBars.map(b => b.count));
  const splitTotal = data.partsTotal + data.laborTotal;
  const partsPct = splitTotal > 0 ? (data.partsTotal / splitTotal) * 100 : 0;
  const laborPct = splitTotal > 0 ? (data.laborTotal / splitTotal) * 100 : 0;

  return (
    <div>
      <PageHeader
        title="Repair Analytics"
        subtitle={`Current month · ${vehicles.length} vehicles`}
        action={
          <div className="flex items-center gap-2">
            <Label htmlFor="fleetRate" className="whitespace-nowrap text-sm text-muted-foreground">
              Fleet default daily rate
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="fleetRate"
                type="number"
                value={fleetRate}
                onChange={(e) => updateFleetRate(e.target.value)}
                className="w-[110px] pl-6"
              />
            </div>
          </div>
        }
      />

      <p className="mb-4 text-xs text-muted-foreground">{rateCaption}</p>

      {/* SECTION 1 — metric cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{m.label}</p>
              <p className="mt-1 text-3xl font-bold tracking-tight">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* SECTION 2 — repair cost by vehicle */}
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Repair cost by vehicle (this month)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.costBars.length === 0 ? <Empty /> : data.costBars.map((b) => (
            <BarRow key={b.id} label={vLabel(b.id)} pct={(b.amount / maxCost) * 100} value={fmtMoney(Math.round(b.amount))} />
          ))}
        </CardContent>
      </Card>

      {/* SECTION 3 — rental income lost by vehicle */}
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Rental income lost by vehicle (this month)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.lostBars.length === 0 ? <Empty /> : data.lostBars.map((b) => (
            <BarRow
              key={b.id}
              label={`${vLabel(b.id)} · ${b.days}d`}
              pct={(b.amount / maxLost) * 100}
              value={fmtMoney(Math.round(b.amount))}
              color="bg-amber-500"
            />
          ))}
        </CardContent>
      </Card>

      {/* SECTION 4 — parts vs labour */}
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Parts vs labour (this month)</CardTitle></CardHeader>
        <CardContent>
          {splitTotal === 0 ? <Empty /> : (
            <>
              <div className="flex h-8 w-full overflow-hidden rounded-md">
                <div className="flex items-center justify-center bg-sky-500 text-xs font-medium text-white" style={{ width: `${partsPct}%` }}>
                  {partsPct >= 12 ? `${Math.round(partsPct)}%` : ""}
                </div>
                <div className="flex items-center justify-center bg-violet-500 text-xs font-medium text-white" style={{ width: `${laborPct}%` }}>
                  {laborPct >= 12 ? `${Math.round(laborPct)}%` : ""}
                </div>
              </div>
              <div className="mt-3 flex justify-between text-sm">
                <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-sky-500" />Parts {fmtMoney(Math.round(data.partsTotal))} ({Math.round(partsPct)}%)</span>
                <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-violet-500" />Labour {fmtMoney(Math.round(data.laborTotal))} ({Math.round(laborPct)}%)</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* SECTION 5 — top problems */}
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Top problems by category (this month)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.catBars.length === 0 ? <Empty /> : data.catBars.map((b) => (
            <BarRow key={b.label} label={b.label} pct={(b.count / maxCat) * 100} value={String(b.count)} color="bg-rose-500" />
          ))}
        </CardContent>
      </Card>

      {/* SECTION 6 — pipeline */}
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Pipeline now</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Chip label="Reported" count={data.pipeline.reported} className="bg-yellow-500/15 text-yellow-600" />
          <Chip label="Diagnosing" count={data.pipeline.diagnosing} className="bg-blue-500/15 text-blue-600" />
          <Chip label="Pending complete" count={data.pipeline.pendingComplete} className="bg-green-600/15 text-green-600" />
          <Chip label="Complete (this month)" count={data.pipeline.completeThisMonth} className="bg-muted text-foreground" />
          <Chip label="Awaiting approval" count={awaitingApproval} className="bg-amber-500/15 text-amber-600" />
        </CardContent>
      </Card>

      {/* Legacy detail reports */}
      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Link to="/analytics/profitability" className="text-primary hover:underline">Profitability →</Link>
        <Link to="/analytics/costs" className="text-primary hover:underline">Cost breakdown →</Link>
        <Link to="/analytics/utilization" className="text-primary hover:underline">Utilization →</Link>
        <Link to="/analytics/failures" className="text-primary hover:underline">Failure patterns →</Link>
        <Link to="/analytics/breakeven" className="text-primary hover:underline">Break-even →</Link>
      </div>
    </div>
  );
}

function BarRow({ label, pct, value, color = "bg-primary" }: { label: string; pct: number; value: string; color?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="truncate pr-2">{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}

function Chip({ label, count, className }: { label: string; count: number; className: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${className}`}>
      <span>{label}</span>
      <span className="font-bold">{count}</span>
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground">No data this month.</p>;
}