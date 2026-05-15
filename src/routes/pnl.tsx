import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { payments, expenses, payrollRuns, staffById, vehicles, vehicleById, rentals, fmtMoney, fmtDate } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import { Users } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";
import { downloadPnLExcel } from "@/lib/pnl-excel";
import { FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/pnl")({
  head: () => ({ meta: [{ title: "P&L — Camauto Rentals" }] }),
  component: PnLPage,
});

function PnLPage() {
  useStoreVersion();

  // Real revenue from paid payments (rental + extension charges flow through here)
  const rentalRevenue = payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const totalRevenue = rentalRevenue;

  const byCat = expenses.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + e.amount; return acc;
  }, {});
  const totalExpenses = Object.values(byCat).reduce((a, b) => a + b, 0);
  const payroll = byCat.payroll ?? 0;
  const net = totalRevenue - totalExpenses;
  const margin = totalRevenue > 0 ? (net / totalRevenue) * 100 : 0;

  // Per-vehicle P&L (revenue mapped via rental → driver_id → paid payments)
  const perVehicle = vehicles.map(v => {
    const vehicleRentals = rentals.filter(r => r.vehicleId === v.id);
    const rentalIds = new Set(vehicleRentals.map(r => r.id));
    const revenue = payments
      .filter(p => p.status === "paid" && rentalIds.has(p.rentalId))
      .reduce((s, p) => s + p.amount, 0);
    const expense = expenses.filter(e => e.vehicleId === v.id).reduce((s, e) => s + e.amount, 0);
    const profit = revenue - expense;
    const roi = expense > 0 ? (profit / expense) * 100 : null;
    return { vehicle: v, revenue, expense, profit, roi };
  }).sort((a, b) => b.profit - a.profit);

  return (
    <div>
      <PageHeader
        title="P&L Dashboard"
        subtitle="Live revenue from paid invoices · live expenses from your logger"
        action={
          <div className="flex gap-2">
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option>This month</option><option>This week</option><option>This quarter</option>
            </select>
            <Button
              variant="default"
              size="sm"
              onClick={() => downloadPnLExcel({
                periodLabel: `Month-to-date · ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
                revenue: [
                  { label: "Rentals", amount: rentalRevenue },
                ],
                expenses: Object.entries(byCat).map(([label, amount]) => ({ label, amount })),
                payroll: payrollRuns.flatMap(run => run.lines.map(l => {
                  const s = staffById(l.staffId);
                  return {
                    runId: run.id,
                    period: `${fmtDate(run.periodStart)} – ${fmtDate(run.periodEnd)}`,
                    staff: s?.fullName ?? l.staffId,
                    role: s?.role ?? "",
                    gross: l.gross,
                    net: l.net,
                    status: l.status,
                  };
                })),
                totals: { revenue: totalRevenue, expenses: totalExpenses, payroll, net, margin },
              })}
            >
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              Export Excel
            </Button>
            <ReportActions
              csvs={[
                {
                  filename: "pnl-summary.csv",
                  headers: ["Line", "Amount"],
                  rows: [
                    ["Rentals", rentalRevenue],
                    ["Total revenue", totalRevenue],
                    ["Total expenses", totalExpenses],
                    ["Payroll", payroll],
                    ["Net profit", net],
                  ],
                },
                {
                  filename: "pnl-expenses.csv",
                  headers: ["Category", "Amount"],
                  rows: Object.entries(byCat).map(([c, a]) => [c, a]),
                },
                {
                  filename: "pnl-per-vehicle.csv",
                  headers: ["Vehicle", "Plate", "Revenue", "Expenses", "Net", "ROI %"],
                  rows: perVehicle.map(r => [
                    `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}`,
                    r.vehicle.plate,
                    r.revenue,
                    r.expense,
                    r.profit,
                    r.roi == null ? "" : r.roi.toFixed(1),
                  ]),
                },
                {
                  filename: "pnl-payroll.csv",
                  headers: ["Run", "Period start", "Period end", "Staff", "Role", "Gross", "Net", "Status"],
                  rows: payrollRuns.flatMap(run => run.lines.map(l => {
                    const s = staffById(l.staffId);
                    return [run.id, run.periodStart, run.periodEnd, s?.fullName ?? l.staffId, s?.role ?? "", l.gross, l.net, l.status];
                  })),
                },
              ]}
            />
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Big label="Revenue" value={totalRevenue} tone="text-success" />
        <Big label="Expenses" value={totalExpenses} tone="text-destructive" />
        <Big label="Payroll" value={payroll} tone="text-foreground" />
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="p-4">
            <div className="text-xs uppercase opacity-80">Net profit</div>
            <div className="mt-1 text-2xl font-bold">{fmtMoney(net)}</div>
            <div className="mt-1 text-xs opacity-90">{margin.toFixed(1)}% margin</div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Bar label="Rentals (paid invoices)" value={rentalRevenue} total={totalRevenue || 1} tone="bg-success" />
            {totalRevenue === 0 && (
              <p className="text-xs text-muted-foreground">No paid invoices yet — revenue will populate as payments are marked paid.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Expense breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {totalExpenses === 0 && (
              <p className="text-xs text-muted-foreground">No expenses logged yet. Add some in the Expenses tab.</p>
            )}
            {Object.entries(byCat).map(([cat, amt]) => (
              <Bar key={cat} label={cat.replace("_", " ")} value={amt} total={totalExpenses} tone="bg-destructive/70" />
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Per-vehicle P&amp;L</CardTitle></CardHeader>
        <CardContent className="p-0">
          {perVehicle.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No vehicles in fleet yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Vehicle</th>
                    <th className="px-4 py-2">Plate</th>
                    <th className="px-4 py-2 text-right">Revenue</th>
                    <th className="px-4 py-2 text-right">Expenses</th>
                    <th className="px-4 py-2 text-right">Net</th>
                    <th className="px-4 py-2 text-right">ROI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {perVehicle.map(r => (
                    <tr key={r.vehicle.id}>
                      <td className="px-4 py-2 font-medium">{r.vehicle.year} {r.vehicle.make} {r.vehicle.model}</td>
                      <td className="px-4 py-2 text-muted-foreground">{r.vehicle.plate}</td>
                      <td className="px-4 py-2 text-right text-success">{fmtMoney(r.revenue)}</td>
                      <td className="px-4 py-2 text-right text-destructive">{fmtMoney(r.expense)}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${r.profit >= 0 ? "" : "text-destructive"}`}>
                        {fmtMoney(r.profit)}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                        {r.roi == null ? "—" : `${r.roi >= 0 ? "+" : ""}${r.roi.toFixed(0)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" /> Payroll breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {payrollRuns.map(run => {
            const totalGross = run.lines.reduce((s, l) => s + l.gross, 0);
            const totalNet = run.lines.reduce((s, l) => s + l.net, 0);
            return (
              <div key={run.id} className="rounded-md border border-border">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
                  <div>
                    <div className="text-sm font-semibold">{run.id} <span className="ml-2 text-xs font-normal capitalize text-muted-foreground">{run.status}</span></div>
                    <div className="text-xs text-muted-foreground">{fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Total payout</div>
                    <div className="text-lg font-bold">{fmtMoney(run.totalPayout)}</div>
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {run.lines.map((l, i) => {
                    const s = staffById(l.staffId);
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 px-4 py-2 text-sm">
                        <div className="col-span-5 font-medium">{s?.fullName ?? l.staffId}</div>
                        <div className="col-span-3 text-xs text-muted-foreground">{s?.role}</div>
                        <div className="col-span-2 text-right text-muted-foreground">{fmtMoney(l.gross)}</div>
                        <div className="col-span-2 text-right font-semibold">{fmtMoney(l.net)}</div>
                      </div>
                    );
                  })}
                  <div className="grid grid-cols-12 gap-2 bg-muted/30 px-4 py-2 text-xs">
                    <div className="col-span-8 text-muted-foreground">Gross / Net totals</div>
                    <div className="col-span-2 text-right">{fmtMoney(totalGross)}</div>
                    <div className="col-span-2 text-right font-semibold">{fmtMoney(totalNet)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Big({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <Card><CardContent className="p-4">
    <div className="text-xs uppercase text-muted-foreground">{label}</div>
    <div className={`mt-1 text-2xl font-bold ${tone}`}>{fmtMoney(value)}</div>
  </CardContent></Card>;
}
function Bar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="capitalize">{label}</span>
        <span className="font-medium">{fmtMoney(value)} <span className="text-xs text-muted-foreground">({pct.toFixed(0)}%)</span></span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
