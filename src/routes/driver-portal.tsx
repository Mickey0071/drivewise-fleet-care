import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { drivers, rentals, payments, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import type { Payment } from "@/lib/mock/data";
import { carImage } from "@/lib/mock/carImages";
import { Camera, IdCard, Truck, CheckCircle2, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { ReportActions } from "@/components/app/ReportActions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { recordPayment, getInspectionsForRental, useStoreVersion } from "@/lib/mock/store";

export const Route = createFileRoute("/driver-portal")({
  head: () => ({ meta: [{ title: "Driver Portal — Camauto Rentals" }] }),
  component: DriverPortalPage,
});

function DriverPortalPage() {
  useStoreVersion();
  // Drivers who actually have a rental
  const driversWithRental = drivers.filter(d => rentals.some(r => r.driverId === d.id));
  const [meId, setMeId] = useState(driversWithRental[0]?.id ?? drivers[0].id);
  const me = drivers.find(d => d.id === meId)!;
  const myRental = rentals.find(r => r.driverId === me.id);
  const v = myRental ? vehicleById(myRental.vehicleId) : null;
  const myPayments = payments.filter(p => p.driverId === me.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const next = myPayments.find(p => p.status !== "paid");
  const [paying, setPaying] = useState<Payment | null>(null);

  return (
    <div>
      <PageHeader
        title="Driver Portal"
        subtitle={`Hi, ${me.fullName.split(" ")[0]} 👋`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={meId} onValueChange={setMeId}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {driversWithRental.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ReportActions csv={{
              filename: `${me.fullName.replace(/\s+/g, "_")}-history.csv`,
              headers: ["Payment ID", "Amount", "Due", "Paid", "Method", "Status", "Vehicle", "Plate"],
              rows: myPayments.map(p => [p.id, p.amount, p.dueDate, p.paidDate ?? "", p.method ?? "", p.status, v ? `${v.year} ${v.make} ${v.model}` : "", v?.plate ?? ""]),
            }} />
          </div>
        }
      />

      {!myRental || !v ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No active rental on file.</CardContent></Card>
      ) : (
        <>
          <Card className="mb-6 overflow-hidden">
            <div className="relative aspect-[16/9] w-full bg-muted">
              <img src={carImage(v.model)} alt={v.model} className="h-full w-full object-cover" />
            </div>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Your rental</div>
                  <div className="font-semibold">{v.year} {v.make} {v.model}</div>
                  <div className="text-xs text-muted-foreground">Plate {v.plate} · Started {fmtDate(myRental.startDate)}</div>
                </div>
                <StatusBadge status={myRental.endDate ? "current" : "active"} />
              </div>
              <HandoffStatusForDriver rentalId={myRental.id} returned={!!myRental.endDate} />
            </CardContent>
          </Card>

          {next && (
            <Card className="mb-6 border-primary/40 bg-primary/5">
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Next payment</div>
                <div className="mt-1 flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold">{fmtMoney(next.amount)}</div>
                    <div className="text-xs text-muted-foreground">Due {fmtDate(next.dueDate)}</div>
                  </div>
                  <Button onClick={() => setPaying(next)}>Pay now</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="mb-6">
            <CardHeader><CardTitle className="text-base">Payment history</CardTitle></CardHeader>
            <CardContent className="divide-y divide-border p-0">
              {myPayments.length === 0 && <div className="p-4 text-sm text-muted-foreground">No payments yet.</div>}
              {myPayments.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <div className="font-medium">{fmtMoney(p.amount)}</div>
                    <div className="text-xs text-muted-foreground">Due {fmtDate(p.dueDate)}{p.paidDate && ` · paid ${fmtDate(p.paidDate)} via ${p.method}`}</div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Button variant="outline" className="h-auto justify-start gap-3 p-4" onClick={() => toast("Camera would open here")}>
          <Camera className="h-5 w-5 text-primary" />
          <div className="text-left">
            <div className="font-medium">Upload return photos</div>
            <div className="text-xs text-muted-foreground">For check-out inspection</div>
          </div>
        </Button>
        <Button variant="outline" className="h-auto justify-start gap-3 p-4" onClick={() => toast.success("Insurance card requested")}>
          <IdCard className="h-5 w-5 text-primary" />
          <div className="text-left">
            <div className="font-medium">Request insurance card</div>
            <div className="text-xs text-muted-foreground">Sent to your email</div>
          </div>
        </Button>
      </div>

      <PayDialog payment={paying} onClose={() => setPaying(null)} driverName={me.fullName} />
    </div>
  );
}

function HandoffStatusForDriver({ rentalId, returned }: { rentalId: string; returned: boolean }) {
  const insps = getInspectionsForRental(rentalId);
  const checkout = insps.find(i => i.type === "check-out");
  if (returned) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5" /> Vehicle returned — thanks!
      </div>
    );
  }
  if (checkout) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary">
        <Truck className="h-3.5 w-3.5" /> Picked up {fmtDate(checkout.date)} at {checkout.mileage.toLocaleString()} mi
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
      <ClipboardCheck className="h-3.5 w-3.5" /> Awaiting handoff — runner will deliver your vehicle
    </div>
  );
}

function PayDialog({ payment, onClose, driverName }: { payment: Payment | null; onClose: () => void; driverName: string }) {
  const [method, setMethod] = useState<NonNullable<Payment["method"]>>("card");
  function confirm() {
    if (!payment) return;
    recordPayment(payment.id, method);
    toast.success("Payment sent", { description: `${driverName} · ${fmtMoney(payment.amount)} via ${method}` });
    onClose();
  }
  return (
    <Dialog open={!!payment} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pay your rental</DialogTitle></DialogHeader>
        {payment && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="text-xs text-muted-foreground">Amount due</div>
              <div className="text-2xl font-bold">{fmtMoney(payment.amount)}</div>
              <div className="text-xs text-muted-foreground">Due {fmtDate(payment.dueDate)}</div>
            </div>
            <div>
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as NonNullable<Payment["method"]>)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="Stripe">Stripe</SelectItem>
                  <SelectItem value="Zelle">Zelle</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}><CheckCircle2 className="mr-1 h-4 w-4" /> Pay {payment ? fmtMoney(payment.amount) : ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
