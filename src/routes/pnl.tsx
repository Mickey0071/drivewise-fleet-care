import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { payments, expenses, payrollRuns, staffById, vehicles, vehicleById, driverById, rentals, violations, fmtMoney, fmtDate } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import { maintenance } from "@/lib/mock/data";
import { isServiceLogRecord, isIssueRecord } from "@/lib/maintenance-utils";
import { Users, CreditCard, Banknote, TrendingUp, TrendingDown, Trophy, AlertTriangle } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";
import { downloadPnLExcel } from "@/lib/pnl-excel";
import { FileSpreadsheet } from "lucide-react";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/pnl")({
  head: () => ({ meta: [{ title: "P&L — Camauto Rentals" }] }),
  component: PnLPage,
});

type PayChannel = "all" | "stripe" | "cash";

function channelOf(method?: string): "stripe" | "cash" {
  const m = (method ?? "").toLowerCase();
  if (m === "stripe" || m === "card") return "stripe";
  return "cash"; // cash, zelle, unspecified
}

function ymKey(d: string) { return d.slice(0, 7); }
function ymLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function startOfYear() { return `${new Date().getFullYear()}-01-01`; }

function PnLPage() {
  useStoreVersion();
  const [channel, setChannel] = useState<PayChannel>("all");
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");

  const data = useMemo(() => {
    const paid = payments.filter(p => p.status === "paid");
    const inRange = (d?: string) => {
      if (!d) return false;
      if (rangeFrom && d < rangeFrom) return false;
      if (rangeTo && d > rangeTo) return false;
      return true;
    };
    const matchesChannel = (m?: string) => channel === "all" || channelOf(m) === channel;

    // Extension payment ids (so we don't double-count with rental income)
    const extensionPaymentIds = new Set<string>();
    rentals.forEach(r => r.extensions?.forEach(e => { if (e.paymentId) extensionPaymentIds.add(e.paymentId); }));

    const filteredPaid = paid.filter(p => matchesChannel(p.method) && inRange(p.paidDate ?? p.dueDate));

    const stripeTotal = paid.filter(p => channelOf(p.method) === "stripe" && inRange(p.paidDate ?? p.dueDate)).reduce((s, p) => s + p.amount, 0);
    const cashTotal = paid.filter(p => channelOf(p.method) === "cash" && inRange(p.paidDate ?? p.dueDate)).reduce((s, p) => s + p.amount, 0);

    // Income monthly buckets
    const incomeByMonth: Record<string, { rental: number; extensions: number; violations: number }> = {};
    const ensureI = (k: string) => (incomeByMonth[k] ??= { rental: 0, extensions: 0, violations: 0 });

    filteredPaid.forEach(p => {
      const k = ymKey(p.paidDate ?? p.dueDate);
      const bucket = ensureI(k);
      if (extensionPaymentIds.has(p.id)) bucket.extensions += p.amount;
      else bucket.rental += p.amount;
    });
    // Extensions without an explicit payment record
    rentals.forEach(r => r.extensions?.forEach(e => {
      if (e.paymentId) return;
      if (!inRange(e.extendedAt?.slice(0, 10))) return;
      ensureI(ymKey(e.extendedAt)).extensions += e.additionalAmount;
    }));
    // Violations (paid)
    const paidViolations = violations.filter(v => v.status === "paid" && inRange(v.dateIssued));
    paidViolations.forEach(v => { ensureI(ymKey(v.dateIssued)).violations += v.amount; });

    // Expenses monthly buckets
    const expByMonth: Record<string, { maintenance: number; payroll: number; other: number }> = {};
    const ensureE = (k: string) => (expByMonth[k] ??= { maintenance: 0, payroll: 0, other: 0 });
    expenses.forEach(e => {
      if (!inRange(e.date)) return;
      const b = ensureE(ymKey(e.date));
      const c = e.category.toLowerCase();
      if (c.includes("maint")) b.maintenance += e.amount;
      else if (c.includes("payroll")) b.payroll += e.amount;
      else b.other += e.amount;
    });
    // Maintenance table (separate source for service records)
    // Avoid double-counting: only add maintenance records that aren't already in expenses
    // (kept off by default — expenses is the canonical ledger)

    const incomeRows = Object.entries(incomeByMonth)
      .map(([k, v]) => ({ ym: k, ...v, total: v.rental + v.extensions + v.violations }))
      .sort((a, b) => b.ym.localeCompare(a.ym));
    const expenseRows = Object.entries(expByMonth)
      .map(([k, v]) => ({ ym: k, ...v, total: v.maintenance + v.payroll + v.other }))
      .sort((a, b) => b.ym.localeCompare(a.ym));

    const totalRevenue = incomeRows.reduce((s, r) => s + r.total, 0);
    const totalExpenses = expenseRows.reduce((s, r) => s + r.total, 0);

    // Weekly averages (income)
    const sumPaidSince = (sinceISO: string) =>
      paid.filter(p => matchesChannel(p.method) && (p.paidDate ?? p.dueDate) >= sinceISO).reduce((s, p) => s + p.amount, 0);
    const sumExpensesSince = (sinceISO: string) =>
      expenses.filter(e => e.date >= sinceISO).reduce((s, e) => s + e.amount, 0);

    const last7Income = sumPaidSince(daysAgo(7));
    const last28Income = sumPaidSince(daysAgo(28));
    const ytdIncome = sumPaidSince(startOfYear());
    const last7Expense = sumExpensesSince(daysAgo(7));
    const last28Expense = sumExpensesSince(daysAgo(28));

    // Combined trend by month (for the chart)
    const allMonths = Array.from(new Set([...incomeRows.map(r => r.ym), ...expenseRows.map(r => r.ym)])).sort();
    const trend = allMonths.map(ym => ({
      ym,
      income: incomeByMonth[ym] ? incomeByMonth[ym].rental + incomeByMonth[ym].extensions + incomeByMonth[ym].violations : 0,
      expense: expByMonth[ym] ? expByMonth[ym].maintenance + expByMonth[ym].payroll + expByMonth[ym].other : 0,
    })).map(r => ({ ...r, net: r.income - r.expense }));

    return {
      stripeTotal, cashTotal, totalRevenue, totalExpenses,
      incomeRows, expenseRows, trend,
      last7Income, last28Income, ytdIncome,
      last7Expense, last28Expense,
    };
  }, [channel, rangeFrom, rangeTo]);

  const rentalRevenue = data.incomeRows.reduce((s, r) => s + r.rental, 0);
  const totalRevenue = data.totalRevenue;

  const byCat = expenses.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + e.amount; return acc;
  }, {});
  const totalExpenses = data.totalExpenses || Object.values(byCat).reduce((a, b) => a + b, 0);
  const payroll = byCat.payroll ?? 0;
  const net = totalRevenue - totalExpenses;
  const margin = totalRevenue > 0 ? (net / totalRevenue) * 100 : 0;
  const trendMax = Math.max(1, ...data.trend.map(t => Math.max(t.income, t.expense)));

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
        subtitle="Income, expenses, and net — across Stripe and cash channels"
        action={
          <div className="flex gap-2">
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={channel}
              onChange={(e) => setChannel(e.target.value as PayChannel)}
            >
              <option value="all">All payment types</option>
              <option value="stripe">Stripe only</option>
              <option value="cash">Cash / Zelle only</option>
            </select>
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              aria-label="From date"
            />
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              aria-label="To date"
            />
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
                paymentsDetail: payments
                  .filter(p => p.status === "paid")
                  .sort((a, b) => (b.paidDate ?? b.dueDate).localeCompare(a.paidDate ?? a.dueDate))
                  .map(p => {
                    const r = rentals.find(x => x.id === p.rentalId);
                    const v = r ? vehicleById(r.vehicleId) : undefined;
                    const d = driverById(p.driverId);
                    return {
                      id: p.id,
                      paidDate: p.paidDate ?? "",
                      dueDate: p.dueDate,
                      rentalId: p.rentalId,
                      driver: d?.fullName ?? p.driverId,
                      vehicle: v ? `${v.year} ${v.make} ${v.model}` : "",
                      plate: v?.plate ?? "",
                      method: p.method ?? "",
                      status: p.status,
                      amount: p.amount,
                    };
                  }),
                expensesDetail: [...expenses]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map(e => {
                    const v = e.vehicleId ? vehicleById(e.vehicleId) : undefined;
                    return {
                      id: e.id,
                      date: e.date,
                      category: e.category,
                      vendor: e.vendor ?? "",
                      vehicle: v ? `${v.year} ${v.make} ${v.model}` : "",
                      plate: v?.plate ?? "",
                      notes: e.notes ?? "",
                      receiptUrl: e.receiptUrl ?? "",
                      amount: e.amount,
                    };
                  }),
                vehicleDetail: perVehicle.map(r => ({
                  vehicleId: r.vehicle.id,
                  vehicle: `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}`,
                  plate: r.vehicle.plate,
                  vin: r.vehicle.vin,
                  revenue: r.revenue,
                  expenses: r.expense,
                  net: r.profit,
                  roiPct: r.roi,
                })),
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

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase text-muted-foreground">Stripe income</div>
              <CreditCard className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-1 text-2xl font-bold">{fmtMoney(data.stripeTotal)}</div>
            <div className="text-xs text-muted-foreground">Card &amp; Stripe-charged payments</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase text-muted-foreground">Cash / Zelle income</div>
              <Banknote className="h-4 w-4 text-success" />
            </div>
            <div className="mt-1 text-2xl font-bold">{fmtMoney(data.cashTotal)}</div>
            <div className="text-xs text-muted-foreground">Recorded cash &amp; Zelle</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Channel split</div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${(data.stripeTotal + data.cashTotal) > 0 ? (data.stripeTotal / (data.stripeTotal + data.cashTotal)) * 100 : 0}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>Stripe {data.stripeTotal + data.cashTotal > 0 ? Math.round((data.stripeTotal / (data.stripeTotal + data.cashTotal)) * 100) : 0}%</span>
              <span>Cash {data.stripeTotal + data.cashTotal > 0 ? Math.round((data.cashTotal / (data.stripeTotal + data.cashTotal)) * 100) : 0}%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Avg label="Income · last 7d" value={data.last7Income} weeks={1} tone="text-success" />
        <Avg label="Income · last 28d" value={data.last28Income} weeks={4} tone="text-success" />
        <Avg label="Income · YTD" value={data.ytdIncome} weeks={Math.max(1, Math.ceil((Date.now() - new Date(startOfYear()).getTime()) / (7 * 86400000)))} tone="text-success" />
        <Avg label="Expenses · last 7d" value={data.last7Expense} weeks={1} tone="text-destructive" />
        <Avg label="Expenses · last 28d" value={data.last28Expense} weeks={4} tone="text-destructive" />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-primary" /> Income vs expenses trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.trend.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity in the selected range.</p>
          ) : (
            <div className="space-y-3">
              {data.trend.map(row => (
                <div key={row.ym}>
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{ymLabel(row.ym)}</span>
                    <span className="text-muted-foreground">
                      <span className="text-success">{fmtMoney(row.income)}</span>
                      {" · "}
                      <span className="text-destructive">{fmtMoney(row.expense)}</span>
                      {" · "}
                      <span className={row.net >= 0 ? "text-success" : "text-destructive"}>
                        {row.net >= 0 ? "+" : ""}{fmtMoney(row.net)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 flex h-3 w-full gap-px overflow-hidden rounded">
                    <div className="h-full bg-success/70" style={{ width: `${(row.income / trendMax) * 50}%` }} />
                    <div className="h-full bg-destructive/70" style={{ width: `${(row.expense / trendMax) * 50}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-success" /> Monthly income
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.incomeRows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No income in range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Month</th>
                      <th className="px-4 py-2 text-right">Rental</th>
                      <th className="px-4 py-2 text-right">Extensions</th>
                      <th className="px-4 py-2 text-right">Violations</th>
                      <th className="px-4 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.incomeRows.map(r => (
                      <tr key={r.ym}>
                        <td className="px-4 py-2 font-medium">{ymLabel(r.ym)}</td>
                        <td className="px-4 py-2 text-right">{fmtMoney(r.rental)}</td>
                        <td className="px-4 py-2 text-right">{fmtMoney(r.extensions)}</td>
                        <td className="px-4 py-2 text-right">{fmtMoney(r.violations)}</td>
                        <td className="px-4 py-2 text-right font-semibold text-success">{fmtMoney(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-4 w-4 text-destructive" /> Monthly expenses
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.expenseRows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No expenses in range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Month</th>
                      <th className="px-4 py-2 text-right">Maintenance</th>
                      <th className="px-4 py-2 text-right">Payroll</th>
                      <th className="px-4 py-2 text-right">Other</th>
                      <th className="px-4 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.expenseRows.map(r => (
                      <tr key={r.ym}>
                        <td className="px-4 py-2 font-medium">{ymLabel(r.ym)}</td>
                        <td className="px-4 py-2 text-right">{fmtMoney(r.maintenance)}</td>
                        <td className="px-4 py-2 text-right">{fmtMoney(r.payroll)}</td>
                        <td className="px-4 py-2 text-right">{fmtMoney(r.other)}</td>
                        <td className="px-4 py-2 text-right font-semibold text-destructive">{fmtMoney(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Monthly net P&amp;L</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Month</th>
                  <th className="px-4 py-2 text-right">Income</th>
                  <th className="px-4 py-2 text-right">Expenses</th>
                  <th className="px-4 py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.trend.length === 0 ? (
                  <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No data in range.</td></tr>
                ) : [...data.trend].reverse().map(row => (
                  <tr key={row.ym}>
                    <td className="px-4 py-2 font-medium">{ymLabel(row.ym)}</td>
                    <td className="px-4 py-2 text-right text-success">{fmtMoney(row.income)}</td>
                    <td className="px-4 py-2 text-right text-destructive">{fmtMoney(row.expense)}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${row.net >= 0 ? "text-success" : "text-destructive"}`}>
                      {row.net >= 0 ? "+" : ""}{fmtMoney(row.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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

      <VehicleProfitability />

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
function Avg({ label, value, weeks, tone }: { label: string; value: number; weeks: number; tone: string }) {
  const perWeek = weeks > 0 ? value / weeks : 0;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className={`mt-1 text-xl font-bold ${tone}`}>{fmtMoney(value)}</div>
        <div className="text-xs text-muted-foreground">~{fmtMoney(perWeek)} / week</div>
      </CardContent>
    </Card>
  );
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

type ProfitFilter = "all" | "profitable" | "losing";
type PeriodFilter = "30" | "90" | "all";

function VehicleProfitability() {
  useStoreVersion();
  const [filter, setFilter] = useState<ProfitFilter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("all");

  const rows = useMemo(() => {
    const since = period === "all" ? null : (() => {
      const d = new Date();
      d.setDate(d.getDate() - Number(period));
      return d.toISOString().slice(0, 10);
    })();
    const inRange = (d?: string) => {
      if (!since) return true;
      if (!d) return false;
      return d.slice(0, 10) >= since;
    };

    return vehicles.map(v => {
      const rentalIds = new Set(rentals.filter(r => r.vehicleId === v.id).map(r => r.id));
      const revenue = payments
        .filter(p => p.status === "paid" && rentalIds.has(p.rentalId) && inRange(p.paidDate ?? p.dueDate))
        .reduce((s, p) => s + p.amount, 0);
      const vMx = maintenance.filter(m => m.vehicleId === v.id && inRange(m.dateCompleted));
      const maintCost = vMx.filter(isServiceLogRecord).reduce((s, m) => s + m.cost, 0);
      const repairCost = vMx.filter(m => isIssueRecord(m) && !!m.dateCompleted).reduce((s, m) => s + m.cost, 0);
      const profit = revenue - maintCost - repairCost;
      return { vehicle: v, revenue, maintCost, repairCost, profit };
    }).sort((a, b) => b.profit - a.profit);
  }, [filter, period]);

  const totals = rows.reduce(
    (acc, r) => {
      acc.revenue += r.revenue;
      acc.maint += r.maintCost;
      acc.repair += r.repairCost;
      acc.profit += r.profit;
      if (r.profit < 0) acc.losing += 1; else acc.profitable += 1;
      return acc;
    },
    { revenue: 0, maint: 0, repair: 0, profit: 0, profitable: 0, losing: 0 },
  );
  const avgProfit = rows.length > 0 ? totals.profit / rows.length : 0;

  const visible = rows.filter(r =>
    filter === "all" ? true : filter === "profitable" ? r.profit >= 0 : r.profit < 0,
  );

  const statusLabel = (profit: number, rank: number) => {
    if (profit < 0) return { text: "🔴 LOSING MONEY", cls: "text-destructive font-semibold" };
    if (rank === 0) return { text: "✓ Highly Profitable", cls: "text-success font-semibold" };
    return { text: "✓ Profitable", cls: "text-success" };
  };

  const losers = rows.filter(r => r.profit < 0);

  const fb = (key: ProfitFilter, label: string) => (
    <Button key={key} variant={filter === key ? "default" : "outline"} size="sm" onClick={() => setFilter(key)}>{label}</Button>
  );
  const pb = (key: PeriodFilter, label: string) => (
    <Button key={key} variant={period === key ? "default" : "outline"} size="sm" onClick={() => setPeriod(key)}>{label}</Button>
  );

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-primary" /> Vehicle Profitability
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">{fb("all", "All Vehicles")}{fb("profitable", "Profitable")}{fb("losing", "Losing Money")}</div>
          <div className="flex flex-wrap gap-1.5">{pb("30", "Last 30 days")}{pb("90", "Last 90 days")}{pb("all", "All Time")}</div>
        </div>

        {/* Fleet summary */}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Big label="Fleet revenue" value={totals.revenue} tone="text-success" />
          <Big label="Maintenance" value={-totals.maint} tone="text-destructive" />
          <Big label="Repairs" value={-totals.repair} tone="text-destructive" />
          <Big label="Fleet profit" value={totals.profit} tone={totals.profit >= 0 ? "text-success" : "text-destructive"} />
          <Big label="Avg / vehicle" value={avgProfit} tone={avgProfit >= 0 ? "text-foreground" : "text-destructive"} />
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Profitable / Losing</div>
            <div className="mt-1 text-2xl font-bold"><span className="text-success">{totals.profitable}</span> <span className="text-muted-foreground">/</span> <span className="text-destructive">{totals.losing}</span></div>
          </CardContent></Card>
        </div>

        {/* Ranking table */}
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No vehicles match this filter.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Vehicle</th>
                  <th className="px-4 py-2 text-right">Revenue</th>
                  <th className="px-4 py-2 text-right">Maintenance</th>
                  <th className="px-4 py-2 text-right">Repairs</th>
                  <th className="px-4 py-2 text-right">Net Profit</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map(r => {
                  const rank = rows.indexOf(r);
                  const st = statusLabel(r.profit, rank);
                  return (
                    <tr key={r.vehicle.id}>
                      <td className="px-4 py-2 font-semibold">{rank === 0 ? "🏆 1" : `#${rank + 1}`}</td>
                      <td className="px-4 py-2 font-medium">{r.vehicle.year} {r.vehicle.make} {r.vehicle.model}</td>
                      <td className="px-4 py-2 text-right text-success">{fmtMoney(r.revenue)}</td>
                      <td className="px-4 py-2 text-right text-destructive">-{fmtMoney(r.maintCost)}</td>
                      <td className="px-4 py-2 text-right text-destructive">-{fmtMoney(r.repairCost)}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${r.profit >= 0 ? "text-success" : "text-destructive"}`}>{fmtMoney(r.profit)}</td>
                      <td className={`px-4 py-2 text-xs ${st.cls}`}>{st.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Negative ROI alerts */}
        {losers.map(r => (
          <div key={r.vehicle.id} className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" /> NEGATIVE ROI — Consider selling this vehicle
            </div>
            <div className="mt-1 text-sm font-medium">{r.vehicle.year} {r.vehicle.make} {r.vehicle.model}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Revenue {fmtMoney(r.revenue)} · Costs {fmtMoney(r.maintCost + r.repairCost)} · Loss {fmtMoney(r.profit)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">This vehicle costs more than it makes. Consider selling.</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
