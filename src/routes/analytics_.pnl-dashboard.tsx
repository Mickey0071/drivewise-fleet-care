import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReportActions } from "@/components/app/ReportActions";
import { useStoreVersion } from "@/lib/mock/store";
import {
  payments, expenses, maintenance, rentals, vehicles, vehicleById, fmtMoney,
} from "@/lib/mock/data";
import { TrendingUp, TrendingDown, Trophy, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/analytics_/pnl-dashboard")({
  head: () => ({ meta: [{ title: "P&L Dashboard — Camauto Rentals" }] }),
  component: PnLDashboard,
});

type ViewMode = "week" | "month" | "year" | "custom";

// ---------- date helpers (all work in local YYYY-MM-DD) ----------
const DAY = 86_400_000;
function iso(d: Date) { return d.toISOString().slice(0, 10); }
function parse(s: string) { return new Date(s + "T00:00:00"); }
function addDays(s: string, n: number) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
function daysBetween(a: string, b: string) { return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY); }

function rangeFor(mode: ViewMode, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (mode === "week") {
    const day = now.getDay(); // 0=Sun
    const diffToMon = (day + 6) % 7;
    const mon = new Date(now); mon.setDate(now.getDate() - diffToMon);
    return { from: iso(mon), to: addDays(iso(mon), 6) };
  }
  if (mode === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: iso(from), to: iso(to) };
  }
  if (mode === "year") {
    return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  }
  return { from: customFrom, to: customTo };
}

function inRange(d: string | undefined, from: string, to: string): boolean {
  if (!d) return false;
  const day = d.slice(0, 10);
  return day >= from && day <= to;
}

function vLabel(id: string) {
  const v = vehicleById(id);
  if (!v) return id;
  return `${v.year} ${v.make} ${v.model}`.trim() || (v.plate ?? id);
}

/** Effective end of a rental for utilization (returned date, end date, or today, clamped). */
function rentalEnd(r: { endDate?: string; returnedAt?: string }): string {
  return (r.returnedAt?.slice(0, 10)) || r.endDate || iso(new Date());
}

/** Days a rental's [start,end] overlaps [from,to], inclusive, capped to the window. */
function overlapDays(start: string, end: string, from: string, to: string): number {
  const s = start > from ? start : from;
  const e = end < to ? end : to;
  if (e < s) return 0;
  return daysBetween(s, e) + 1;
}

function PnLDashboard() {
  useStoreVersion();
  const [mode, setMode] = useState<ViewMode>("month");
  const [customFrom, setCustomFrom] = useState<string>(iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customTo, setCustomTo] = useState<string>(iso(new Date()));

  // Prior Period Adjustment — manual legacy figures, persisted in localStorage.
  const [legacyRevenue, setLegacyRevenue] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem("pnl_legacy_revenue") || 0) || 0;
  });
  const [legacyExpenses, setLegacyExpenses] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem("pnl_legacy_expenses") || 0) || 0;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("pnl_legacy_revenue", String(legacyRevenue));
  }, [legacyRevenue]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("pnl_legacy_expenses", String(legacyExpenses));
  }, [legacyExpenses]);

  // Editable repair-type titles — overrides keyed by the original repair type,
  // persisted in localStorage.
  const [typeTitles, setTypeTitles] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(window.localStorage.getItem("pnl_repair_type_titles") || "{}"); }
    catch { return {}; }
  });
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  function saveTypeTitle(originalType: string) {
    const next = { ...typeTitles };
    const trimmed = editingValue.trim();
    if (!trimmed || trimmed === originalType) delete next[originalType];
    else next[originalType] = trimmed;
    setTypeTitles(next);
    if (typeof window !== "undefined") window.localStorage.setItem("pnl_repair_type_titles", JSON.stringify(next));
    setEditingType(null);
  }

  const { from, to } = useMemo(() => rangeFor(mode, customFrom, customTo), [mode, customFrom, customTo]);

  const data = useMemo(() => {
    const periodDays = Math.max(1, daysBetween(from, to) + 1);

    // ---- Revenue: paid payments by paid date ----
    const paidPayments = payments.filter(p => p.status === "paid" && inRange(p.paidDate, from, to));
    const currentRevenue = paidPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const totalRevenue = currentRevenue + legacyRevenue;

    // ---- Expenses by date ----
    const periodExpenses = expenses.filter(e => inRange(e.date, from, to));
    // Operational expenses exclude rows auto-generated from a completed
    // maintenance record (those are counted via the maintenance table below)
    // to avoid double-counting.
    const operationalExpenses = periodExpenses.reduce(
      (s, e) => s + (e.maintenanceId ? 0 : (e.amount || 0)), 0);
    // Effective cost for a maintenance/repair row: prefer the explicit cost,
    // but fall back to parts + labor fields when cost was never rolled up
    // (repair rows often store partsCost/laborCost only).
    const maintCost = (m: typeof maintenance[number]) =>
      (m.cost || 0) > 0 ? (m.cost || 0) : ((m.partsCost || 0) + (m.laborCost || 0));
    // Completed maintenance / service-log costs in range.
    const maintenanceExpenses = maintenance
      .filter(m => !!m.dateCompleted && inRange(m.dateCompleted, from, to))
      .reduce((s, m) => s + maintCost(m), 0);
    // Pending (not-yet-completed) maintenance — shown as a warning, not counted.
    const pendingMaintenance = maintenance
      .filter(m => !m.dateCompleted)
      .reduce((s, m) => s + maintCost(m), 0);
    const totalExpenses = operationalExpenses + maintenanceExpenses + legacyExpenses;

    const net = totalRevenue - totalExpenses;
    const margin = totalRevenue > 0 ? (net / totalRevenue) * 100 : 0;

    // ---- rental -> vehicle lookup ----
    const rentalVehicle = new Map(rentals.map(r => [r.id, r.vehicleId]));

    // ---- Per vehicle ----
    const perVehicle = vehicles.map(v => {
      const rev = paidPayments
        .filter(p => rentalVehicle.get(p.rentalId) === v.id)
        .reduce((s, p) => s + (p.amount || 0), 0);
      const exp = periodExpenses
        .filter(e => e.vehicleId === v.id && !e.maintenanceId)
        .reduce((s, e) => s + (e.amount || 0), 0);
      // Add completed maintenance/repair costs for this vehicle using the same
      // parts+labor fallback as the fleet-wide total (and exclude the
      // auto-posted maintenance expense rows above to avoid double-counting).
      const maint = maintenance
        .filter(m => m.vehicleId === v.id && !!m.dateCompleted && inRange(m.dateCompleted, from, to))
        .reduce((s, m) => s + maintCost(m), 0);
      const vehExp = exp + maint;
      let daysRented = 0;
      let bestMonth = "";
      const monthDays: Record<string, number> = {};
      rentals.filter(r => r.vehicleId === v.id && r.startDate).forEach(r => {
        const rs = r.startDate.slice(0, 10);
        const re = rentalEnd(r);
        daysRented += overlapDays(rs, re, from, to);
        if (mode === "year") {
          // attribute overlap days to months for best-month detection
          let cur = rs > from ? rs : from;
          const lim = re < to ? re : to;
          while (cur <= lim) {
            const k = cur.slice(0, 7);
            monthDays[k] = (monthDays[k] || 0) + 1;
            cur = addDays(cur, 1);
          }
        }
      });
      if (mode === "year") {
        const entries = Object.entries(monthDays).sort((a, b) => b[1] - a[1]);
        if (entries[0]) {
          const [y, m] = entries[0][0].split("-").map(Number);
          bestMonth = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
        }
      }
      const utilization = Math.min(100, (daysRented / periodDays) * 100);
      return { id: v.id, label: vLabel(v.id), rev, exp: vehExp, net: rev - vehExp, daysRented, utilization, bestMonth };
    });

    const activeVehicles = perVehicle.filter(v => v.rev > 0 || v.daysRented > 0);
    const totalDaysRented = perVehicle.reduce((s, v) => s + v.daysRented, 0);
    const fleetUtilization = (totalDaysRented / (vehicles.length * periodDays)) * 100;
    const avgDaysRented = vehicles.length ? totalDaysRented / vehicles.length : 0;
    const avgNetPerVehicle = vehicles.length ? net / vehicles.length : 0;

    // ---- Expense category breakdown ----
    const catMap: Record<string, number> = {};
    periodExpenses.forEach(e => { catMap[e.category || "Uncategorized"] = (catMap[e.category || "Uncategorized"] || 0) + (e.amount || 0); });
    const categories = Object.entries(catMap).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

    // ---- Repair cost breakdown (completed repairs in range, from the maintenance table) ----
    const completedRepairs = maintenance.filter(
      m => !!m.dateCompleted && inRange(m.dateCompleted, from, to),
    );
    const repairTickets = completedRepairs
      .map(m => ({
        id: m.id,
        vehicle: vLabel(m.vehicleId),
        type: m.problemCategory || m.serviceType || "Repair",
        issue: m.issueDescription || m.selectedSolution?.name || m.serviceType || "Repair",
        cost: maintCost(m),
        date: (m.completionDate || m.dateCompleted || "").slice(0, 10),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const totalRepairCost = repairTickets.reduce((s, t) => s + t.cost, 0);
    // Roll-up: tally repeated repair types across all vehicles.
    const rollMap: Record<string, { total: number; vehicles: Map<string, number> }> = {};
    completedRepairs.forEach(m => {
      const key = m.problemCategory || m.serviceType || "Repair";
      if (!rollMap[key]) rollMap[key] = { total: 0, vehicles: new Map() };
      rollMap[key].total += maintCost(m);
      const label = vLabel(m.vehicleId);
      rollMap[key].vehicles.set(label, (rollMap[key].vehicles.get(label) || 0) + maintCost(m));
    });
    const repairRollup = Object.entries(rollMap)
      .map(([type, v]) => ({
        type,
        total: v.total,
        vehicleCount: v.vehicles.size,
        vehicles: Array.from(v.vehicles.entries())
          .map(([name, amount]) => ({ name, amount }))
          .sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.total - a.total);

    // ---- Time-series buckets ----
    type Bucket = { label: string; from: string; to: string; revenue: number; expenses: number; net: number };
    const buckets: Bucket[] = [];
    if (mode === "year") {
      const y = Number(from.slice(0, 4));
      for (let m = 0; m < 12; m++) {
        const bf = iso(new Date(y, m, 1));
        const bt = iso(new Date(y, m + 1, 0));
        buckets.push({ label: new Date(y, m, 1).toLocaleDateString("en-US", { month: "short" }), from: bf, to: bt, revenue: 0, expenses: 0, net: 0 });
      }
    } else if (mode === "week" || (mode === "custom" && periodDays <= 14)) {
      for (let i = 0; i < periodDays; i++) {
        const d = addDays(from, i);
        buckets.push({ label: parse(d).toLocaleDateString("en-US", { weekday: "short", day: "numeric" }), from: d, to: d, revenue: 0, expenses: 0, net: 0 });
      }
    } else {
      // month / longer custom -> weekly buckets
      let cur = from; let idx = 1;
      while (cur <= to) {
        const bt = addDays(cur, 6) < to ? addDays(cur, 6) : to;
        buckets.push({ label: `Wk ${idx}`, from: cur, to: bt, revenue: 0, expenses: 0, net: 0 });
        cur = addDays(bt, 1); idx++;
      }
    }
    paidPayments.forEach(p => {
      const b = buckets.find(b => inRange(p.paidDate, b.from, b.to));
      if (b) b.revenue += p.amount || 0;
    });
    periodExpenses.forEach(e => {
      const b = buckets.find(b => inRange(e.date, b.from, b.to));
      if (b) b.expenses += e.amount || 0;
    });
    buckets.forEach(b => { b.net = b.revenue - b.expenses; });

    // best / worst month (year view)
    let best: Bucket | null = null, worst: Bucket | null = null;
    if (mode === "year") {
      const withData = buckets.filter(b => b.revenue > 0 || b.expenses > 0);
      withData.forEach(b => {
        if (!best || b.net > best.net) best = b;
        if (!worst || b.net < worst.net) worst = b;
      });
    }

    // ---- Prior period (same length, 1 year earlier) for P&L comparison ----
    const pyFrom = `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`;
    const pyTo = `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`;
    const pyRevenue = payments.filter(p => p.status === "paid" && inRange(p.paidDate, pyFrom, pyTo)).reduce((s, p) => s + (p.amount || 0), 0);
    const pyExpenses = expenses.filter(e => inRange(e.date, pyFrom, pyTo)).reduce((s, e) => s + (e.amount || 0), 0);

    return {
      periodDays, totalRevenue, totalExpenses, net, margin,
      operationalExpenses, maintenanceExpenses, pendingMaintenance,
      perVehicle, activeVehicles, fleetUtilization, avgDaysRented, avgNetPerVehicle,
      categories, buckets, best: best as Bucket | null, worst: worst as Bucket | null,
      repairTickets, repairRollup, totalRepairCost,
      pyRevenue, pyExpenses, pyNet: pyRevenue - pyExpenses, hasPriorYear: pyRevenue > 0 || pyExpenses > 0,
    };
  }, [from, to, mode, legacyRevenue, legacyExpenses]);

  const csvRows = data.perVehicle
    .filter(v => v.rev > 0 || v.daysRented > 0)
    .map(v => [v.label, v.daysRented, `${v.utilization.toFixed(0)}%`, v.rev, v.exp, v.net, mode === "year" ? v.bestMonth : ""]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="P&L Dashboard"
        subtitle={`${from} → ${to}`}
        action={
          <ReportActions
            csv={{
              filename: `pnl-${mode}-${from}_${to}.csv`,
              headers: ["Vehicle", "Days Rented", "Utilization", "Revenue", "Expenses", "Net", "Best Month"],
              rows: csvRows,
            }}
          />
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        {(["week", "month", "year", "custom"] as ViewMode[]).map(m => (
          <Button key={m} variant={mode === m ? "default" : "outline"} size="sm" onClick={() => setMode(m)}>
            {m === "week" ? "This week" : m === "month" ? "This month" : m === "year" ? "This year" : "Custom"}
          </Button>
        ))}
        {mode === "custom" && (
          <div className="flex flex-wrap items-end gap-2">
            <div><Label className="text-xs">From</Label><Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-9" /></div>
            <div><Label className="text-xs">To</Label><Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-9" /></div>
          </div>
        )}
      </div>

      {/* KPI cards */}
      {/* Prior Period Adjustment */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Prior Period Adjustment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Manually add legacy figures from before this system. These are added on top of the
            current-period totals above and persist across reloads.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label className="text-xs">Legacy Revenue</Label>
              <Input
                type="number"
                step="0.01"
                value={legacyRevenue || ""}
                onChange={e => setLegacyRevenue(Number(e.target.value) || 0)}
                className="h-9 w-40"
                placeholder="0.00"
              />
            </div>
            <div>
              <Label className="text-xs">Legacy Expenses</Label>
              <Input
                type="number"
                step="0.01"
                value={legacyExpenses || ""}
                onChange={e => setLegacyExpenses(Number(e.target.value) || 0)}
                className="h-9 w-40"
                placeholder="0.00"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Adds {fmtMoney(legacyRevenue)} revenue and {fmtMoney(legacyExpenses)} expenses to the totals.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total Revenue" value={fmtMoney(data.totalRevenue)} />
        <Kpi
          label="Total Expenses"
          value={fmtMoney(data.totalExpenses)}
          sub={`Operational ${fmtMoney(data.operationalExpenses)} + Maintenance ${fmtMoney(data.maintenanceExpenses)} = Total ${fmtMoney(data.totalExpenses)}`}
        />
        <Kpi label="Net Profit" value={fmtMoney(data.net)} accent={data.net >= 0 ? "pos" : "neg"} />
        <Kpi label="Profit Margin" value={`${data.margin.toFixed(1)}%`} accent={data.margin >= 0 ? "pos" : "neg"} />
        <Kpi label="Fleet Utilization" value={`${data.fleetUtilization.toFixed(1)}%`} />
        <Kpi label="Avg Days / Vehicle" value={data.avgDaysRented.toFixed(1)} />
        <Kpi label="Avg Net / Vehicle" value={fmtMoney(data.avgNetPerVehicle)} accent={data.avgNetPerVehicle >= 0 ? "pos" : "neg"} />
        <Kpi label="Active Vehicles" value={`${data.activeVehicles.length} / ${vehicles.length}`} />
      </div>

      {data.pendingMaintenance > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {fmtMoney(data.pendingMaintenance)} in pending maintenance is not yet
            counted as an expense (will count once completed).
          </span>
        </div>
      )}

      {/* Trend chart */}
      <Card>
        <CardHeader><CardTitle className="text-base">
          {mode === "year" ? "Revenue, Expenses & Net by Month" : mode === "week" ? "Revenue & Expenses by Day" : "Revenue & Expenses"}
        </CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            {mode === "year" ? (
              <LineChart data={data.buckets}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} /><YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="net" name="Net" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            ) : (
              <BarChart data={data.buckets}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} /><YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Best / worst month (year view) */}
      {mode === "year" && (data.best || data.worst) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.best && (
            <Card><CardContent className="flex items-center gap-3 p-4">
              <Trophy className="h-8 w-8 text-emerald-500" />
              <div><div className="text-xs text-muted-foreground">Best Month</div>
                <div className="font-semibold">{data.best.label} · {fmtMoney(data.best.net)} net</div></div>
            </CardContent></Card>
          )}
          {data.worst && (
            <Card><CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <div><div className="text-xs text-muted-foreground">Worst Month</div>
                <div className="font-semibold">{data.worst.label} · {fmtMoney(data.worst.net)} net</div></div>
            </CardContent></Card>
          )}
        </div>
      )}

      {/* P&L statement w/ prior-year comparison */}
      <Card>
        <CardHeader><CardTitle className="text-base">P&L Statement</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Line</th><th className="py-2 text-right">This Period</th>
              <th className="py-2 text-right">Same Period Last Year</th><th className="py-2 text-right">Δ</th>
            </tr></thead>
            <tbody>
              <PnlRow label="Revenue" now={data.totalRevenue} prev={data.pyRevenue} has={data.hasPriorYear} />
              <PnlRow label="Expenses" now={data.totalExpenses} prev={data.pyExpenses} has={data.hasPriorYear} negative />
              <PnlRow label="Net Profit" now={data.net} prev={data.pyNet} has={data.hasPriorYear} bold />
            </tbody>
          </table>
          {!data.hasPriorYear && <p className="mt-2 text-xs text-muted-foreground">No data for the same period last year.</p>}
        </CardContent>
      </Card>

      {/* Expense category breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-base">Expense Categories</CardTitle></CardHeader>
        <CardContent>
          {data.categories.length === 0 ? <p className="text-sm text-muted-foreground">No expenses in this period.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data.categories.map(c => (
                  <tr key={c.category} className="border-b last:border-0">
                    <td className="py-2">{c.category}</td>
                    <td className="py-2 text-right font-medium">{fmtMoney(c.amount)}</td>
                    <td className="py-2 text-right text-muted-foreground">{((c.amount / (data.totalExpenses || 1)) * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Repair cost breakdown (from maintenance table) */}
      <Card>
        <CardHeader><CardTitle className="text-base">Repair Cost Breakdown</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {data.repairTickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed repairs in this period.</p>
          ) : (
            <>
              {/* Roll-up by repair type across the fleet */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  By repair type (fleet-wide)
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">Repair type</th>
                    <th className="py-2 text-right">Total</th>
                    <th className="py-2 text-right">% of repairs</th>
                    <th className="py-2 text-right">Vehicles</th>
                  </tr></thead>
                  <tbody>
                    {data.repairRollup.map(r => (
                      <tr key={r.type} className="border-b last:border-0">
                        <td className="py-2">
                          {editingType === r.type ? (
                            <span className="flex items-center gap-1">
                              <Input
                                autoFocus
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveTypeTitle(r.type);
                                  if (e.key === "Escape") setEditingType(null);
                                }}
                                className="h-7 w-40 text-sm"
                              />
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => saveTypeTitle(r.type)}>Save</Button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="group inline-flex items-center gap-1 text-left hover:underline"
                              onClick={() => { setEditingType(r.type); setEditingValue(typeTitles[r.type] || r.type); }}
                              title="Click to rename"
                            >
                              {typeTitles[r.type] || r.type}
                              <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                            </button>
                          )}
                        </td>
                        <td className="py-2 text-right font-medium">{fmtMoney(r.total)}</td>
                        <td className="py-2 text-right text-muted-foreground">
                          {((r.total / (data.totalRepairCost || 1)) * 100).toFixed(0)}%
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {r.vehicles.map(v => (
                              <span
                                key={v.name}
                                className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
                              >
                                <span className="font-medium">{v.name}</span>
                                <span className="text-muted-foreground">{fmtMoney(v.amount)}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold">
                      <td className="py-2">Total repair spend</td>
                      <td className="py-2 text-right">{fmtMoney(data.totalRepairCost)}</td>
                      <td className="py-2 text-right text-muted-foreground">100%</td>
                      <td className="py-2" />
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Individual repair tickets */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Individual repair tickets
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left text-muted-foreground">
                      <th className="py-2">Vehicle</th>
                      <th className="py-2">Repair issue</th>
                      <th className="py-2 text-right">Cost</th>
                      <th className="py-2 text-right">Completed</th>
                    </tr></thead>
                    <tbody>
                      {data.repairTickets.map(t => (
                        <tr key={t.id} className="border-b last:border-0">
                          <td className="py-2">{t.vehicle}</td>
                          <td className="py-2">{t.issue}</td>
                          <td className="py-2 text-right font-medium">{fmtMoney(t.cost)}</td>
                          <td className="py-2 text-right text-muted-foreground">{t.date || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Per-vehicle breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-base">Per-Vehicle Breakdown</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Vehicle</th>
              <th className="py-2 text-right">Days Rented{mode === "week" ? " (wk)" : mode === "month" ? " (mo)" : mode === "year" ? " (yr)" : ""}</th>
              <th className="py-2 text-right">Util %</th>
              <th className="py-2 text-right">Revenue</th>
              <th className="py-2 text-right">Expenses</th>
              <th className="py-2 text-right">Net</th>
              {mode === "year" && <th className="py-2 text-right">Best Month</th>}
            </tr></thead>
            <tbody>
              {data.perVehicle.filter(v => v.rev > 0 || v.daysRented > 0 || v.exp > 0).map(v => (
                <tr key={v.id} className="border-b last:border-0">
                  <td className="py-2">{v.label}</td>
                  <td className="py-2 text-right">{v.daysRented}</td>
                  <td className="py-2 text-right">{v.utilization.toFixed(0)}%</td>
                  <td className="py-2 text-right">{fmtMoney(v.rev)}</td>
                  <td className="py-2 text-right">{fmtMoney(v.exp)}</td>
                  <td className={`py-2 text-right font-medium ${v.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmtMoney(v.net)}</td>
                  {mode === "year" && <td className="py-2 text-right">{v.bestMonth || "—"}</td>}
                </tr>
              ))}
              {data.perVehicle.every(v => v.rev === 0 && v.daysRented === 0 && v.exp === 0) && (
                <tr><td colSpan={mode === "year" ? 7 : 6} className="py-4 text-center text-muted-foreground">No vehicle activity in this period.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, accent, sub }: { label: string; value: string; accent?: "pos" | "neg"; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 text-xl font-bold ${accent === "pos" ? "text-emerald-600" : accent === "neg" ? "text-destructive" : ""}`}>{value}</div>
        {sub && <div className="mt-1 text-[11px] leading-tight text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function PnlRow({ label, now, prev, has, negative, bold }: { label: string; now: number; prev: number; has: boolean; negative?: boolean; bold?: boolean }) {
  const delta = now - prev;
  return (
    <tr className={`border-b last:border-0 ${bold ? "font-semibold" : ""}`}>
      <td className="py-2">{label}</td>
      <td className="py-2 text-right">{fmtMoney(now)}</td>
      <td className="py-2 text-right text-muted-foreground">{has ? fmtMoney(prev) : "—"}</td>
      <td className={`py-2 text-right ${!has ? "text-muted-foreground" : delta >= 0 ? "text-emerald-600" : "text-destructive"}`}>
        {has ? (
          <span className="inline-flex items-center gap-1 justify-end">
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {fmtMoney(Math.abs(delta))}
          </span>
        ) : "—"}
      </td>
    </tr>
  );
}