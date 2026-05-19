import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { payments, driverById, vehicleById, rentals, fmtMoney, fmtDate } from "@/lib/mock/data";
import { Send, CheckCircle2, Loader2, Search, AlertTriangle, Clock, Calendar as CalendarIcon } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";
import { recordPayment, useStoreVersion, getOrCreateDuePaymentForRental, calcCurrentPeriodEnd } from "@/lib/mock/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { Payment } from "@/lib/mock/data";
import { sendPaymentLink } from "@/lib/payment-link.functions";
import { getStripeEnvironment } from "@/lib/stripe";

export const Route = createFileRoute("/payments")({
  head: () => ({ meta: [{ title: "Payments — Camauto Rentals" }] }),
  component: PaymentsPage,
});

function PaymentsPage() {
  useStoreVersion();
  const [paying, setPaying] = useState<Payment | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  async function sendLink(p: Payment) {
    const d = driverById(p.driverId);
    if (!d?.phone) {
      toast.error("No phone on file for this renter");
      return;
    }
    setSendingId(p.id);
    try {
      await sendPaymentLink({
        data: {
          phone: d.phone,
          name: d.fullName,
          amountCents: Math.round(p.amount * 100),
          description: `Rental payment ${p.id} due ${fmtDate(p.dueDate)}`,
          environment: getStripeEnvironment(),
          rentalId: p.rentalId,
          paymentId: p.id,
        },
      });
      toast.success("Payment link sent", { description: `Texted to ${d.fullName} (${d.phone})` });
    } catch (e) {
      toast.error("Failed to send link", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSendingId(null);
    }
  }

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
      <Tabs defaultValue="fees-due" className="space-y-4">
        <TabsList>
          <TabsTrigger value="fees-due">Rental Fees Due</TabsTrigger>
          <TabsTrigger value="history">Payment History</TabsTrigger>
        </TabsList>

        <TabsContent value="fees-due">
          <RentalFeesDueTab onRecord={setPaying} />
        </TabsContent>

        <TabsContent value="history">
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
                        <>
                          <Button variant="ghost" size="sm" disabled={sendingId === p.id} onClick={() => sendLink(p)}>
                            {sendingId === p.id
                              ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              : <Send className="mr-1 h-3.5 w-3.5" />}
                            Send Pay Link
                          </Button>
                          <Button size="sm" onClick={() => setPaying(p)}>
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Record
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RecordPaymentDialog payment={paying} onClose={() => setPaying(null)} />
    </div>
  );
}

type FeeFilter = "all" | "overdue" | "today" | "upcoming";

function RentalFeesDueTab({ onRecord }: { onRecord: (p: Payment) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FeeFilter>("all");

  const today = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0); return t;
  }, []);
  const todayStr = today.toISOString().slice(0, 10);
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + 3);
  const horizonStr = horizon.toISOString().slice(0, 10);
  const weekHorizon = new Date(today); weekHorizon.setDate(weekHorizon.getDate() + 7);
  const weekHorizonStr = weekHorizon.toISOString().slice(0, 10);

  const rows = useMemo(() => {
    return rentals
      .filter(r => (r.reservationStatus ?? "active") === "active" && !r.endDate)
      .map(r => {
        const cadence = (r.billingCadence ?? (r.billingPeriod === "daily" ? "daily" : "weekly")) as "daily" | "weekly";
        const periodEnd = r.currentPeriodEnd ?? calcCurrentPeriodEnd(r.startDate, cadence);
        const amount = r.rateAmount ?? r.rate ?? r.weeklyRate ?? 0;
        const v = vehicleById(r.vehicleId);
        const d = driverById(r.driverId);
        const dueMs = new Date(periodEnd + "T00:00:00").getTime();
        const diffDays = Math.round((dueMs - today.getTime()) / 86_400_000);
        let status: "overdue" | "today" | "upcoming";
        if (periodEnd < todayStr) status = "overdue";
        else if (periodEnd === todayStr) status = "today";
        else status = "upcoming";
        return { rental: r, vehicle: v, driver: d, periodEnd, amount, cadence, diffDays, status };
      })
      .filter(row => {
        // Only overdue, today, or within next 3 days
        if (row.status === "upcoming" && row.periodEnd > horizonStr) return false;
        return true;
      })
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  }, [today, todayStr, horizonStr]);

  const filtered = rows.filter(row => {
    if (filter !== "all" && row.status !== filter) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${row.driver?.fullName ?? ""} ${row.vehicle?.plate ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const overdueRows = rows.filter(r => r.status === "overdue");
  const overdueCount = overdueRows.length;
  const overdueTotal = overdueRows.reduce((s, r) => s + r.amount, 0);
  // Total due in next 7 days (includes overdue + today + upcoming up to +7)
  const dueThisWeekTotal = rentals
    .filter(r => (r.reservationStatus ?? "active") === "active" && !r.endDate)
    .reduce((s, r) => {
      const cadence = (r.billingCadence ?? (r.billingPeriod === "daily" ? "daily" : "weekly")) as "daily" | "weekly";
      const periodEnd = r.currentPeriodEnd ?? calcCurrentPeriodEnd(r.startDate, cadence);
      const amount = r.rateAmount ?? r.rate ?? r.weeklyRate ?? 0;
      return periodEnd <= weekHorizonStr ? s + amount : s;
    }, 0);

  function handleRecord(rentalId: string) {
    const p = getOrCreateDuePaymentForRental(rentalId);
    if (!p) { toast.error("Could not create payment record"); return; }
    onRecord(p);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Overdue rentals"
          value={String(overdueCount)}
          tone="text-destructive"
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Total overdue"
          value={fmtMoney(overdueTotal)}
          tone="text-destructive"
        />
        <StatCard
          icon={<CalendarIcon className="h-4 w-4" />}
          label="Due this week"
          value={fmtMoney(dueThisWeekTotal)}
          tone="text-foreground"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by customer or plate"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as FeeFilter)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="overdue">Overdue only</SelectItem>
            <SelectItem value="today">Due today</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No active rentals match — nothing due in the next 3 days.
            </div>
          )}
          {filtered.map(row => (
            <div key={row.rental.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {row.driver ? (
                    <Link to="/drivers" className="font-medium hover:underline">
                      {row.driver.fullName}
                    </Link>
                  ) : (
                    <span className="font-medium">{row.rental.driverId}</span>
                  )}
                  <CadenceBadge cadence={row.cadence} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.vehicle ? `${row.vehicle.year} ${row.vehicle.make} ${row.vehicle.model} · ${row.vehicle.plate}` : row.rental.vehicleId}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-right">
                  <div className="font-semibold">{fmtMoney(row.amount)}</div>
                  <div className="text-xs text-muted-foreground">Due {fmtDate(row.periodEnd)}</div>
                </div>
                <FeeStatusBadge status={row.status} diffDays={row.diffDays} />
                <Button size="sm" onClick={() => handleRecord(row.rental.id)}>
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Record Payment
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
          {icon}{label}
        </div>
        <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function CadenceBadge({ cadence }: { cadence: "daily" | "weekly" }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {cadence}
    </span>
  );
}

function FeeStatusBadge({ status, diffDays }: { status: "overdue" | "today" | "upcoming"; diffDays: number }) {
  const cls =
    status === "overdue" ? "bg-destructive/15 text-destructive border-destructive/30"
    : status === "today" ? "bg-warning/20 text-warning-foreground border-warning/40"
    : "bg-success/15 text-success border-success/30";
  const label =
    status === "overdue" ? `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"} overdue`
    : status === "today" ? "Due today"
    : `In ${diffDays} day${diffDays === 1 ? "" : "s"}`;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <Clock className="h-3 w-3" />{label}
    </span>
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

function RecordPaymentDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const [method, setMethod] = useState<NonNullable<Payment["method"]>>("cash");
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const driver = payment ? driverById(payment.driverId) : null;
  function confirm() {
    if (!payment) return;
    recordPayment(payment.id, method, paidDate);
    toast.success("Payment recorded", { description: `${driver?.fullName} · ${fmtMoney(payment.amount)} via ${method}` });
    onClose();
  }
  return (
    <Dialog open={!!payment} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
        {payment && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{driver?.fullName}</div>
              <div className="text-xs text-muted-foreground">{payment.id} · Due {fmtDate(payment.dueDate)}</div>
              <div className="mt-1 text-lg font-bold">{fmtMoney(payment.amount)}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as NonNullable<Payment["method"]>)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="Zelle">Zelle</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="Stripe">Stripe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Paid date</Label>
                <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}><CheckCircle2 className="mr-1 h-4 w-4" /> Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
