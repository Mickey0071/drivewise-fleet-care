import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { payments, driverById, fmtMoney, fmtDate } from "@/lib/mock/data";
import { Send, CheckCircle2, Loader2 } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";
import { recordPayment, useStoreVersion } from "@/lib/mock/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      <RecordPaymentDialog payment={paying} onClose={() => setPaying(null)} />
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
