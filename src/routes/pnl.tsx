import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { payments, expenses, fmtMoney } from "@/lib/mock/data";
import { Download, TrendingUp, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/pnl")({
  head: () => ({ meta: [{ title: "P&L — Camauto Rentals" }] }),
  component: PnLPage,
});

function PnLPage() {
  const rentalRevenue = payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const lateFees = 145;
  const depositsKept = 300;
  const damageCharges = 220;
  const totalRevenue = rentalRevenue + lateFees + depositsKept + damageCharges;

  const byCat = expenses.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + e.amount; return acc;
  }, {});
  const totalExpenses = Object.values(byCat).reduce((a, b) => a + b, 0);
  const payroll = byCat.payroll ?? 0;
  const net = totalRevenue - totalExpenses;
  const margin = totalRevenue > 0 ? (net / totalRevenue) * 100 : 0;

  const prior = { revenue: 4820, expenses: 3960, net: 860 };

  return (
    <div>
      <PageHeader
        title="P&L Dashboard"
        subtitle="Month-to-date performance"
        action={
          <div className="flex gap-2">
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option>This month</option><option>This week</option><option>This quarter</option>
            </select>
            <Button variant="outline"><Download className="mr-2 h-4 w-4" />Export</Button>
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
          <CardHeader><CardTitle className="text-base">Revenue breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Bar label="Rentals" value={rentalRevenue} total={totalRevenue} tone="bg-success" />
            <Bar label="Late fees" value={lateFees} total={totalRevenue} tone="bg-warning" />
            <Bar label="Deposits kept" value={depositsKept} total={totalRevenue} tone="bg-primary" />
            <Bar label="Damage charges" value={damageCharges} total={totalRevenue} tone="bg-accent-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Expense breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(byCat).map(([cat, amt]) => (
              <Bar key={cat} label={cat} value={amt} total={totalExpenses} tone="bg-destructive/70" />
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Period comparison</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <Compare label="Revenue" cur={totalRevenue} prev={prior.revenue} />
            <Compare label="Expenses" cur={totalExpenses} prev={prior.expenses} invert />
            <Compare label="Net" cur={net} prev={prior.net} />
          </div>
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
function Compare({ label, cur, prev, invert = false }: { label: string; cur: number; prev: number; invert?: boolean }) {
  const delta = cur - prev;
  const pct = prev > 0 ? (delta / prev) * 100 : 0;
  const goodUp = !invert;
  const positive = (delta >= 0) === goodUp;
  const Icon = delta >= 0 ? TrendingUp : TrendingDown;
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-bold">{fmtMoney(cur)}</div>
      <div className={`mt-1 flex items-center gap-1 text-xs ${positive ? "text-success" : "text-destructive"}`}>
        <Icon className="h-3 w-3" />
        {pct >= 0 ? "+" : ""}{pct.toFixed(1)}% vs prior
      </div>
    </div>
  );
}
