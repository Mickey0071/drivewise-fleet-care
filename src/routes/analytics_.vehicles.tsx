import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useStoreVersion } from "@/lib/mock/store";
import { fmtMoney } from "@/lib/mock/data";
import { computeVehicleAnalytics, periodFileTag, periodLabel, type VAPeriod } from "@/lib/vehicle-analytics";
import { exportVehicleAnalyticsPdf, exportVehicleAnalyticsXlsx } from "@/lib/vehicle-analytics-export";

export const Route = createFileRoute("/analytics_/vehicles")({
  head: () => ({
    meta: [
      { title: "Vehicle Analytics — Camauto Rentals" },
      { name: "description", content: "Per-vehicle days rented, utilization, revenue, expenses and net, ranked by performance." },
      { property: "og:title", content: "Vehicle Analytics — Camauto Rentals" },
      { property: "og:description", content: "Per-vehicle performance ranked by net profit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VehicleAnalyticsPage,
});

const TABS: { key: VAPeriod; label: string }[] = [
  { key: "lifetime", label: "Lifetime" }, { key: "year", label: "This Year" }, { key: "month", label: "This Month" },
];

function VehicleAnalyticsPage() {
  const version = useStoreVersion();
  const [period, setPeriod] = useState<VAPeriod>("lifetime");
  const [busy, setBusy] = useState<"x" | "p" | null>(null);
  const rows = useMemo(() => computeVehicleAnalytics(period), [period, version]);
  const totals = rows.reduce((t, r) => ({ d: t.d + r.daysRented, rev: t.rev + r.rev, exp: t.exp + r.exp, net: t.net + r.net }), { d: 0, rev: 0, exp: 0, net: 0 });
  const file = `CamautoRentals_VehicleAnalytics_${periodFileTag(period)}`;

  const run = async (k: "x" | "p") => {
    setBusy(k);
    try {
      if (k === "x") await exportVehicleAnalyticsXlsx(rows, periodLabel(period), `${file}.xlsx`);
      else await exportVehicleAnalyticsPdf(rows, periodLabel(period), `${file}.pdf`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Export failed"); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader
        title="Vehicle Analytics"
        subtitle={`Ranked by net profit · ${periodLabel(period)}`}
        action={
          <Button variant="outline" asChild>
            <Link to="/analytics/pnl-dashboard"><ArrowLeft className="mr-1 h-4 w-4" /> P&L Dashboard</Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border p-0.5">
          {TABS.map(t => (
            <Button key={t.key} size="sm" variant={period === t.key ? "default" : "ghost"} onClick={() => setPeriod(t.key)}>{t.label}</Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => run("x")} disabled={busy !== null || rows.length === 0}>
            {busy === "x" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-4 w-4" />} Export Excel
          </Button>
          <Button size="sm" variant="outline" onClick={() => run("p")} disabled={busy !== null || rows.length === 0}>
            {busy === "p" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />} Export PDF
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Vehicle Analytics</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Vehicle</th>
              <th className="py-2 text-right">Days Rented</th>
              <th className="py-2 text-right">Util %</th>
              <th className="py-2 text-right">Revenue</th>
              <th className="py-2 text-right">Expenses</th>
              <th className="py-2 text-right">Net</th>
            </tr></thead>
            <tbody>
              {rows.map((v, i) => (
                <tr key={v.id} className={`border-b ${i < 3 ? "bg-emerald-500/10" : v.net < 0 ? "bg-destructive/5 text-destructive" : ""}`}>
                  <td className="py-2">
                    {i < 3 && <span className="mr-2 inline-flex h-5 min-w-7 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold text-primary-foreground">#{i + 1}</span>}
                    {v.label}
                  </td>
                  <td className="py-2 text-right">{v.daysRented}</td>
                  <td className="py-2 text-right">{v.utilization.toFixed(0)}%</td>
                  <td className="py-2 text-right">{fmtMoney(v.rev)}</td>
                  <td className="py-2 text-right">{fmtMoney(v.exp)}</td>
                  <td className={`py-2 text-right font-medium ${v.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmtMoney(v.net)}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No vehicle activity in this period.</td></tr>
              ) : (
                <tr className="border-t-2 border-emerald-600 font-semibold">
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right">{totals.d}</td>
                  <td className="py-2" />
                  <td className="py-2 text-right">{fmtMoney(totals.rev)}</td>
                  <td className="py-2 text-right">{fmtMoney(totals.exp)}</td>
                  <td className={`py-2 text-right ${totals.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmtMoney(totals.net)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
