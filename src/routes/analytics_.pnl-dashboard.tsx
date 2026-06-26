import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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

  const { from, to } = useMemo(() => rangeFor(mode, customFrom, customTo), [mode, customFrom, customTo]);

  const data = useMemo(() => {
    const periodDays = Math.max(1, daysBetween(from, to) + 1);

    // ---- Revenue: paid payments by paid date ----
    const paidPayments = payments.filter(p => p.status === "paid" && inRange(p.paidDate, from, to));
    const totalRevenue = paidPayments.reduce((s, p) => s + (p.amount || 0), 0);

    // ---- Expenses by date ----
    const periodExpenses = expenses.filter(e => inRange(e.date, from, to));
    const totalExpenses = periodExpenses.reduce((s, e) => s + (e.amount || 0), 0);

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
        .filter(e => e.vehicleId === v.id)
        .reduce((s, e) => s + (e.amount || 0), 0);
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
      return { id: v.id, label: vLabel(v.id), rev, exp, net: rev - exp, daysRented, utilization, bestMonth };
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
      perVehicle, activeVehicles, fleetUtilization, avgDaysRented, avgNetPerVehicle,
      categories, buckets, best: best as Bucket | null, worst: worst as Bucket | null,
      pyRevenue, pyExpenses, pyNet: pyRevenue - pyExpenses, hasPriorYear: pyRevenue > 0 || pyExpenses > 0,
    };
  }, [from, to, mode]);

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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total Revenue" value={fmtMoney(data.totalRevenue)} />
        <Kpi label="Total Expenses" value={fmtMoney(data.totalExpenses)} />
        <Kpi label="Net Profit" value={fmtMoney(data.net)} accent={data.net >= 0 ? "pos" : "neg"} />
        <Kpi label="Profit Margin" value={`${data.margin.toFixed(1)}%`} accent={data.margin >= 0 ? "pos" : "neg"} />
        <Kpi label="Fleet Utilization" value={`${data.fleetUtilization.toFixed(1)}%`} />
        <Kpi label="Avg Days / Vehicle" value={data.avgDaysRented.toFixed(1)} />
        <Kpi label="Avg Net / Vehicle" value={fmtMoney(data.avgNetPerVehicle)} accent={data.avgNetPerVehicle >= 0 ? "pos" : "neg"} />
        <Kpi label="Active Vehicles" value={`${data.activeVehicles.length} / ${vehicles.length}`} />
      </div>

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
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(var(--primary))" strokeWidth={2} />
                <Line type="monotone" dataKey="expenses" name="Expenses" stroke="hsl(var(--destructive))" strokeWidth={2} />
                <Line type="monotone" dataKey="net" name="Net" stroke="hsl(var(--chart-2, 142 71% 45%))" strokeWidth={2} />
              </LineChart>
            ) : (
              <BarChart data={data.buckets}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} /><YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
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

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "pos" | "neg" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 text-xl font-bold ${accent === "pos" ? "text-emerald-600" : accent === "neg" ? "text-destructive" : ""}`}>{value}</div>
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