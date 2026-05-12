import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { payments, driverById, fmtMoney, fmtDate } from "@/lib/mock/data";
import { Bell } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";

export const Route = createFileRoute("/payments")({
  head: () => ({ meta: [{ title: "Payments — Camauto Rentals" }] }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const totals = {
    paid: payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0),
    late: payments.filter(p => p.status === "late").reduce((s, p) => s + p.amount, 0),
    missed: payments.filter(p => p.status === "missed").reduce((s, p) => s + p.amount, 0),
  };
  const sorted = [...payments].sort((a, b) => b.dueDate.localeCompare(a.dueDate));

  return (
    <div>
      <PageHeader
        title="Payment Tracker"
        subtitle="Log and chase weekly rental payments"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ReportActions csv={{
              filename: "payments.csv",
              headers: ["ID", "Driver", "Rental", "Amount", "Due", "Paid", "Method", "Status"],
              rows: sorted.map(p => [p.id, driverById(p.driverId)?.fullName ?? p.driverId, p.rentalId, p.amount, p.dueDate, p.paidDate ?? "", p.method ?? "", p.status]),
            }} />
            <Button>+ Log Payment</Button>
          </div>
        }
      />
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Total label="Collected" value={totals.paid} tone="text-success" />
        <Total label="Late" value={totals.late} tone="text-warning-foreground" />
        <Total label="Missed" value={totals.missed} tone="text-destructive" />
      </div>
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {sorted.map(p => {
            const d = driverById(p.driverId);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{d?.fullName ?? p.driverId}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.id} · Due {fmtDate(p.dueDate)}
                    {p.paidDate && ` · Paid ${fmtDate(p.paidDate)} via ${p.method}`}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{fmtMoney(p.amount)}</span>
                  <StatusBadge status={p.status} />
                  {p.status !== "paid" && (
                    <Button variant="ghost" size="sm"><Bell className="mr-1 h-3.5 w-3.5" />Remind</Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{fmtMoney(value)}</div>
    </CardContent></Card>
  );
}
