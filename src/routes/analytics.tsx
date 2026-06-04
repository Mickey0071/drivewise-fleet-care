import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useStoreVersion } from "@/lib/mock/store";
import {
  vehicles, rentals, payments, maintenance, violations, vehicleById, fmtMoney,
} from "@/lib/mock/data";
import { isIssueRecord, isServiceLogRecord } from "@/lib/maintenance-utils";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/analytics")({
  head: () => ({ meta: [{ title: "Analytics Dashboard — Camauto Rentals" }] }),
  component: AnalyticsHub,
});

type RangeKey = "30" | "60" | "90" | "custom";

function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function vName(id: string) { const v = vehicleById(id); return v ? `${v.year} ${v.make} ${v.model}` : id; }
function pct(n: number) { return `${Math.round(n)}%`; }

function AnalyticsHub() {
  useStoreVersion();
  const [range, setRange] = useState<RangeKey>("90");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { from, to, windowDays } = useMemo(() => {
    if (range === "custom" && customFrom && customTo) {
      const f = customFrom, t = customTo;
      const d = Math.max(1, Math.round((new Date(t).getTime() - new Date(f).getTime()) / 86400000));
      return { from: f, to: t, windowDays: d };
    }
    const n = range === "custom" ? 90 : Number(range);
    return { from: daysAgo(n), to: new Date().toISOString().slice(0, 10), windowDays: n };
  }, [range, customFrom, customTo]);

  const inRange = (date?: string) => !!date && date.slice(0, 10) >= from && date.slice(0, 10) <= to;

  const stats = useMemo(() => {
    const rentalVehicle = new Map(rentals.map(r => [r.id, r.vehicleId]));

    // Revenue per vehicle (paid payments in range)
    const revByVehicle = new Map<string, number>();
    for (const p of payments) {
      if (p.status !== "paid" && !p.paidDate) continue;
      if (!inRange(p.paidDate ?? p.dueDate)) continue;
      const vid = rentalVehicle.get(p.rentalId);
      if (!vid) continue;
      revByVehicle.set(vid, (revByVehicle.get(vid) ?? 0) + p.amount);
    }

    // Costs
    let maintCost = 0, repairCost = 0, violationCost = 0;
    const costByVehicle = new Map<string, number>();
    let repairCount = 0;
    const repairsByVehicle = new Map<string, number>();
    const issueCounts = new Map<string, number>();
    for (const m of maintenance) {
      const completed = m.status === "complete" || isServiceLogRecord(m);
      if (!completed) continue;
      if (!inRange(m.completionDate ?? m.dateCompleted)) continue;
      const c = m.cost ?? 0;
      if (isIssueRecord(m)) {
        repairCost += c; repairCount += 1;
        repairsByVehicle.set(m.vehicleId, (repairsByVehicle.get(m.vehicleId) ?? 0) + 1);
        const issue = (m.serviceType || "Other").trim();
        issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
      } else {
        maintCost += c;
      }
      costByVehicle.set(m.vehicleId, (costByVehicle.get(m.vehicleId) ?? 0) + c);
    }
    for (const v of violations) {
      if (!inRange(v.dateIssued)) continue;
      violationCost += v.amount;
    }
    const totalCosts = maintCost + repairCost + violationCost;

    // Profitability per vehicle
    let totalNet = 0;
    const netByVehicle: { id: string; net: number }[] = [];
    for (const v of vehicles) {
      const net = (revByVehicle.get(v.id) ?? 0) - (costByVehicle.get(v.id) ?? 0);
      netByVehicle.push({ id: v.id, net });
      totalNet += net;
    }
    const sortedNet = [...netByVehicle].sort((a, b) => b.net - a.net);
    const best = sortedNet[0];
    const worst = sortedNet[sortedNet.length - 1];

    // Utilization per vehicle (rented days within window)
    const utilByVehicle = vehicles.map(v => {
      let rentedDays = 0;
      for (const r of rentals) {
        if (r.vehicleId !== v.id) continue;
        const s = (r.startDate || "").slice(0, 10);
        const e = (r.endDate || to).slice(0, 10);
        if (!s) continue;
        const os = s > from ? s : from;
        const oe = e < to ? e : to;
        if (os <= oe) rentedDays += Math.round((new Date(oe).getTime() - new Date(os).getTime()) / 86400000) + 1;
      }
      return { id: v.id, util: windowDays > 0 ? Math.min(100, (rentedDays / windowDays) * 100) : 0 };
    });
    const fleetAvgUtil = utilByVehicle.length ? utilByVehicle.reduce((s, u) => s + u.util, 0) / utilByVehicle.length : 0;
    const sortedUtil = [...utilByVehicle].sort((a, b) => b.util - a.util);
    const topUtil = sortedUtil[0];
    const bottomUtil = sortedUtil[sortedUtil.length - 1];

    // Failures
    const sortedRepairs = [...repairsByVehicle.entries()].sort((a, b) => b[1] - a[1]);
    const mostFailures = sortedRepairs[0];
    const sortedIssues = [...issueCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topIssue = sortedIssues[0];

    // Break-even (proxy: net profit sign, no purchase cost in dataset)
    const paidOff = netByVehicle.filter(n => n.net > 0).length;
    const closeToRoi = netByVehicle.filter(n => n.net <= 0 && n.net > -500).length;
    const losing = netByVehicle.filter(n => n.net <= -500).length;

    return {
      totalNet, best, worst,
      totalCosts, maintCost, repairCost, violationCost,
      fleetAvgUtil, topUtil, bottomUtil,
      repairCount, mostFailures, topIssue,
      paidOff, closeToRoi, losing,
    };
  }, [from, to, windowDays]);

  const cards = [
    {
      to: "/analytics/profitability", icon: "📊", title: "Profitability Scorecard",
      top: `Total Net Profit: ${fmtMoney(stats.totalNet)}`,
      sub: stats.best && stats.worst
        ? `Best: ${vName(stats.best.id)} ${fmtMoney(stats.best.net)} · Worst: ${vName(stats.worst.id)} ${fmtMoney(stats.worst.net)}`
        : "No vehicle data in range",
    },
    {
      to: "/analytics/costs", icon: "💰", title: "Cost Breakdown",
      top: `Total Costs: ${fmtMoney(stats.totalCosts)}`,
      sub: `Maintenance ${fmtMoney(stats.maintCost)} · Repairs ${fmtMoney(stats.repairCost)} · Violations ${fmtMoney(stats.violationCost)}`,
    },
    {
      to: "/analytics/utilization", icon: "📈", title: "Utilization",
      top: `Fleet Avg: ${pct(stats.fleetAvgUtil)}`,
      sub: stats.topUtil && stats.bottomUtil
        ? `Top: ${vName(stats.topUtil.id)} ${pct(stats.topUtil.util)} · Bottom: ${vName(stats.bottomUtil.id)} ${pct(stats.bottomUtil.util)}`
        : "No vehicle data",
    },
    {
      to: "/analytics/failures", icon: "⚠️", title: "Failure Patterns",
      top: `${stats.repairCount} total repairs`,
      sub: `Most failures: ${stats.mostFailures ? `${vName(stats.mostFailures[0])} (${stats.mostFailures[1]})` : "—"} · Top issue: ${stats.topIssue ? stats.topIssue[0] : "—"}`,
    },
    {
      to: "/analytics/breakeven", icon: "💼", title: "Break-Even Analysis",
      top: `${stats.paidOff}/${vehicles.length} vehicles profitable`,
      sub: `${stats.closeToRoi} close to ROI · ${stats.losing} losing long-term`,
    },
  ] as const;

  return (
    <div>
      <PageHeader
        title="Analytics Dashboard"
        subtitle={`Last ${range === "custom" ? "custom range" : `${range} days`} · ${vehicles.length} vehicles`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
            {range === "custom" && (
              <div className="flex items-center gap-2">
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-[150px]" />
                <span className="text-muted-foreground">→</span>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-[150px]" />
              </div>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className="block">
            <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/30">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="text-xl" aria-hidden>{c.icon}</span>
                  {c.title}
                </CardTitle>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tracking-tight">{c.top}</p>
                <p className="mt-1 text-sm text-muted-foreground">{c.sub}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}