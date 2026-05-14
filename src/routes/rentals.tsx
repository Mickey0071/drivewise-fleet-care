import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { rentals, vehicleById, driverById, payments, fmtMoney, fmtDate } from "@/lib/mock/data";
import { useStoreVersion, updateRental, markReturned, getInspectionsForRental, addInspection, extendRental, computeExtensionCharge, prunePendingReservations, pendingExpiresAt, cancelReservation, captureSignature, markReservationPaid } from "@/lib/mock/store";
import { ReportActions } from "@/components/app/ReportActions";
import { NewReservationDialog } from "@/components/app/NewReservationDialog";
import { useEffect, useState } from "react";
import { Car, Truck, ClipboardCheck, CheckCircle2, CalendarPlus, FileSignature, Clock, DollarSign, X as XIcon, Receipt, MessageSquare, Printer, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SignaturePad } from "@/components/app/SignaturePad";
import { StripeRentalCheckout } from "@/components/StripeEmbeddedCheckout";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { sendRentalSms } from "@/lib/rental-sms.functions";
import { sendSigningLink } from "@/lib/sign.functions";
import { toast } from "sonner";
import type { Rental } from "@/lib/mock/data";

export const Route = createFileRoute("/rentals")({
  head: () => ({ meta: [{ title: "Reservations — Camauto Rentals" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    paid: typeof search.paid === "string" ? search.paid : undefined,
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: RentalsPage,
});

const AGREEMENT_VERSION = "v1.0";

function RentalsPage() {
  const navigate = Route.useNavigate();
  const { paid } = Route.useSearch();
  const { user } = useAuth();
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<Rental | null>(null);
  const [delivering, setDelivering] = useState<Rental | null>(null);
  const [returning, setReturning] = useState<Rental | null>(null);
  const [extending, setExtending] = useState<Rental | null>(null);
  const [viewingAgreement, setViewingAgreement] = useState<Rental | null>(null);
  const [signing, setSigning] = useState<Rental | null>(null);
  const [charging, setCharging] = useState<Rental | null>(null);
  const [receipt, setReceipt] = useState<Rental | null>(null);
  const sendSmsFn = useServerFn(sendRentalSms);
  const sendSignLinkFn = useServerFn(sendSigningLink);
  useStoreVersion();
  // Prune any pending reservations whose 24h hold has expired,
  // and warn once when a hold drops below 2 hours remaining.
  useEffect(() => {
    const warned = new Set<string>();
    function tick() {
      prunePendingReservations();
      const now = Date.now();
      for (const r of rentals) {
        if (r.reservationStatus !== "pending") continue;
        const exp = pendingExpiresAt(r);
        if (!exp) continue;
        const remaining = exp - now;
        if (remaining > 0 && remaining < 2 * 3_600_000 && !warned.has(r.id)) {
          warned.add(r.id);
          const d = driverById(r.driverId);
          const v = vehicleById(r.vehicleId);
          const mins = Math.max(1, Math.floor(remaining / 60_000));
          toast.warning(`Hold expiring in ${mins}m`, {
            description: `${v?.year} ${v?.make} ${v?.model} · ${d?.fullName ?? r.driverId}`,
          });
        }
      }
    }
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  // After Stripe redirect: mark reservation paid and clear query params
  useEffect(() => {
    if (!paid) return;
    const activated = markReservationPaid(paid);
    toast.success(activated ? "Payment received — reservation activated" : "Payment received");
    navigate({ to: "/rentals", search: {}, replace: true });
  }, [paid, navigate]);

  const pending = rentals.filter(r => r.reservationStatus === "pending");
  const active = rentals.filter(r => (r.reservationStatus ?? "active") === "active" && !r.endDate);
  const completed = rentals.filter(r => !!r.endDate);

  function renderCard(r: Rental) {
    const v = vehicleById(r.vehicleId);
    const d = driverById(r.driverId);
    const sched = payments.filter(p => p.rentalId === r.id);
    const next = sched.find(p => p.status !== "paid");
    const isPending = r.reservationStatus === "pending";
    return (
      <Card key={r.id} className="overflow-hidden">
        <div className="flex flex-col md:flex-row">
          <div className="relative w-full md:w-72 lg:w-80 shrink-0 bg-muted">
            <div className="aspect-[4/3] md:aspect-auto md:h-full flex items-center justify-center text-muted-foreground/40">
              <Car className="h-16 w-16" />
            </div>
          </div>
          <div className="flex-1 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-xl md:text-2xl leading-tight truncate">
                  {v?.year} {v?.make} {v?.model}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Plate {v?.plate} · VIN {v?.vin}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  {isPending ? "Reserved for" : "Rented to"} <span className="text-foreground font-medium">{d?.fullName}</span>
                </p>
              </div>
              {isPending ? <PendingHoldBadge rental={r} /> : <StatusBadge status={r.paymentStatus} />}
            </div>
            {isPending ? <PendingChecklist rental={r} /> : <HandoffStatus rental={r} />}
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Stat label="Started" value={fmtDate(r.startDate)} />
              <Stat
                label={r.billingPeriod === "daily" ? "Daily" : r.billingPeriod === "monthly" ? "Monthly" : "Weekly"}
                value={fmtMoney(r.rate ?? r.weeklyRate)}
              />
              <Stat label="Deposit" value={fmtMoney(r.depositPaid)} />
            </div>
            {!isPending && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="text-xs uppercase text-muted-foreground">Next payment</div>
                {next ? (
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-medium">{fmtMoney(next.amount)} due {fmtDate(next.dueDate)}</span>
                    <StatusBadge status={next.status} />
                  </div>
                ) : <div className="mt-1 text-sm text-muted-foreground">All paid</div>}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {isPending ? (
                <>
                  <Button size="sm" onClick={() => setSigning(r)} variant={r.signatureDataUrl ? "outline" : "default"}>
                    <FileSignature className="mr-1 h-4 w-4" />
                    {r.signatureDataUrl ? "Re-capture signature" : "Capture signature"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        const res = await sendSignLinkFn({
                          data: { rentalId: r.id, origin: window.location.origin },
                        });
                        toast.success("Signing link sent via SMS", { description: res.link });
                      } catch (e) {
                        toast.error("Could not send link", {
                          description: e instanceof Error ? e.message : String(e),
                        });
                      }
                    }}
                  >
                    <Send className="mr-1 h-4 w-4" /> Send sign link to renter
                  </Button>
                  <Button
                    size="sm"
                    variant={r.paymentReceived ? "outline" : "default"}
                    onClick={() => setCharging(r)}
                    disabled={r.paymentReceived}
                  >
                    <DollarSign className="mr-1 h-4 w-4" />
                    {r.paymentReceived ? "Payment received ✓" : "Charge with Stripe"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const phone = d?.phone;
                      if (!phone) { toast.error("No phone on file for renter"); return; }
                      const v2 = vehicleById(r.vehicleId);
                      const need = [];
                      if (!r.signatureDataUrl) need.push("sign your rental agreement");
                      if (!r.paymentReceived) need.push("complete the first payment");
                      const action = need.length ? need.join(" and ") : "confirm your reservation";
                      const msg = `Rentalprise Auto: Your ${v2?.year ?? ""} ${v2?.make ?? ""} ${v2?.model ?? ""} is on hold until ${new Date(pendingExpiresAt(r) ?? Date.now()).toLocaleString()}. Please come in to ${action}.`;
                      try {
                        await sendSmsFn({ data: { phone, message: msg, name: d?.fullName } });
                        toast.success("SMS sent to renter");
                      } catch (e) {
                        toast.error("SMS failed", { description: e instanceof Error ? e.message : String(e) });
                      }
                    }}
                  >
                    <MessageSquare className="mr-1 h-4 w-4" /> Notify renter
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      cancelReservation(r.id);
                      toast.success("Reservation cancelled");
                    }}
                  >
                    <XIcon className="mr-1 h-4 w-4" /> Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                  {!r.endDate && getInspectionsForRental(r.id).every(i => i.type !== "check-out") && (
                    <Button size="sm" onClick={() => setDelivering(r)}>
                      <Truck className="mr-1 h-4 w-4" /> Deliver vehicle
                    </Button>
                  )}
                  {!r.endDate && getInspectionsForRental(r.id).some(i => i.type === "check-out") && (
                    <Button variant="outline" size="sm" onClick={() => setReturning(r)}>
                      <ClipboardCheck className="mr-1 h-4 w-4" /> Process return
                    </Button>
                  )}
                  {!r.endDate && (
                    <Button variant="outline" size="sm" onClick={() => setExtending(r)}>
                      <CalendarPlus className="mr-1 h-4 w-4" /> Extend rental
                    </Button>
                  )}
                  {r.signatureDataUrl && (
                    <Button variant="ghost" size="sm" onClick={() => setViewingAgreement(r)}>
                      <FileSignature className="mr-1 h-4 w-4" /> View agreement
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setReceipt(r)}>
                    <Receipt className="mr-1 h-4 w-4" /> Receipt
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle={`${active.length} active · ${pending.length} pending · ${completed.length} completed`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ReportActions csv={{
              filename: "rentals.csv",
              headers: ["ID", "Driver", "Vehicle", "Plate", "Started", "Ended", "Weekly", "Deposit", "Status", "Reservation"],
              rows: rentals.map(r => {
                const v = vehicleById(r.vehicleId);
                return [r.id, driverById(r.driverId)?.fullName ?? r.driverId, v ? `${v.year} ${v.make} ${v.model}` : r.vehicleId, v?.plate ?? "", r.startDate, r.endDate ?? "", r.weeklyRate, r.depositPaid, r.paymentStatus, r.reservationStatus ?? "active"];
              }),
            }} />
            <Button onClick={() => setNewOpen(true)}>+ New Reservation</Button>
          </div>
        }
      />
      <Tabs defaultValue={pending.length > 0 ? "pending" : "active"} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="pending">
            Pending {pending.length > 0 && <span className="ml-1 rounded-full bg-amber-500/20 px-2 text-xs text-amber-700 dark:text-amber-400">{pending.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="completed">Completed ({completed.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="flex flex-col gap-3 mt-0">
          {active.length === 0 ? <EmptyState label="No active rentals." /> : active.map(renderCard)}
        </TabsContent>
        <TabsContent value="pending" className="flex flex-col gap-3 mt-0">
          {pending.length === 0 ? (
            <EmptyState label="No pending reservations. New reservations are held here for 24h until signature + payment." />
          ) : pending.map(renderCard)}
        </TabsContent>
        <TabsContent value="completed" className="flex flex-col gap-3 mt-0">
          {completed.length === 0 ? <EmptyState label="No completed rentals yet." /> : completed.map(renderCard)}
        </TabsContent>
      </Tabs>
      <NewReservationDialog open={newOpen} onOpenChange={setNewOpen} />
      <EditRentalDialog rental={editing} onClose={() => setEditing(null)} />
      <DeliveryDialog rental={delivering} onClose={() => setDelivering(null)} />
      <ReturnDialog rental={returning} onClose={() => setReturning(null)} />
      <ExtendRentalDialog rental={extending} onClose={() => setExtending(null)} />
      <AgreementDialog rental={viewingAgreement} onClose={() => setViewingAgreement(null)} />
      <CaptureSignatureDialog rental={signing} onClose={() => setSigning(null)} />
      <ChargeRentalDialog
        rental={charging}
        onClose={() => setCharging(null)}
        userEmail={user?.email}
        userId={user?.id}
      />
      <ReceiptDialog rental={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{label}</div>;
}

function ChargeRentalDialog({
  rental, onClose, userEmail, userId,
}: { rental: Rental | null; onClose: () => void; userEmail?: string; userId?: string }) {
  const open = !!rental;
  if (!rental) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent />
      </Dialog>
    );
  }
  const v = vehicleById(rental.vehicleId);
  const d = driverById(rental.driverId);
  const period = rental.billingPeriod ?? "weekly";
  const periodLabel = period === "daily" ? "day" : period === "monthly" ? "month" : "week";
  const amount = rental.rate ?? rental.weeklyRate;
  const amountInCents = Math.round(amount * 100);
  const returnUrl = `${window.location.origin}/rentals?paid=${rental.id}&session_id={CHECKOUT_SESSION_ID}`;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Charge first {periodLabel} — {fmtMoney(amount)}</DialogTitle>
        </DialogHeader>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div><span className="text-muted-foreground">Vehicle:</span> {v?.year} {v?.make} {v?.model}</div>
          <div><span className="text-muted-foreground">Renter:</span> {d?.fullName} · {d?.email}</div>
          <div><span className="text-muted-foreground">Reservation:</span> {rental.id}</div>
        </div>
        <StripeRentalCheckout
          kind="deposit"
          amountInCents={amountInCents}
          rentalId={rental.id}
          customerEmail={d?.email || userEmail}
          customerName={d?.fullName}
          userId={userId}
          returnUrl={returnUrl}
        />
      </DialogContent>
    </Dialog>
  );
}

function PendingHoldBadge({ rental }: { rental: Rental }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const exp = pendingExpiresAt(rental);
  if (!exp) return null;
  const remaining = exp - now;
  const hrs = Math.max(0, Math.floor(remaining / 3_600_000));
  const mins = Math.max(0, Math.floor((remaining % 3_600_000) / 60_000));
  const expired = remaining <= 0;
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${expired ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
      <Clock className="h-3.5 w-3.5" />
      {expired ? "Hold expired" : `Hold ${hrs}h ${mins}m left`}
    </div>
  );
}

function PendingChecklist({ rental }: { rental: Rental }) {
  const signed = !!rental.signatureDataUrl;
  const paid = !!rental.paymentReceived;
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1.5 text-xs">
      <div className="font-medium text-amber-700 dark:text-amber-400">Pending — vehicle held off the calendar</div>
      <div className="flex items-center gap-2">
        {signed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
        <span className={signed ? "text-foreground" : "text-muted-foreground"}>Rental agreement signed</span>
      </div>
      <div className="flex items-center gap-2">
        {paid ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
        <span className={paid ? "text-foreground" : "text-muted-foreground"}>First payment received</span>
      </div>
    </div>
  );
}

function CaptureSignatureDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const [sig, setSig] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (rental) { setSig(rental.signatureDataUrl ?? null); setAccepted(false); }
  }, [rental]);
  function confirm() {
    if (!rental || !d) return;
    if (!accepted) { toast.error("Client must accept the agreement"); return; }
    if (!sig) { toast.error("Signature required"); return; }
    const activated = captureSignature(rental.id, sig, d.fullName, AGREEMENT_VERSION);
    toast.success(activated ? "Reservation activated" : "Signature captured");
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Capture rental agreement signature</DialogTitle>
        </DialogHeader>
        {rental && v && d && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Renter: {d.fullName}</div>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="font-semibold text-foreground">RENTALPRISE AUTO — VEHICLE RENTAL AGREEMENT {AGREEMENT_VERSION}</p>
              <p className="mt-2">Renter agrees to pay the contracted rate and a refundable deposit, and is responsible for damage, citations, tolls, impound fees, and parking violations during the rental term. Vehicle must be returned in the same condition as delivered. Failure to return or pay may result in repossession. Governed by the laws of the State of Georgia.</p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
              <span>I, <span className="font-medium">{d.fullName}</span>, have read and agree to the terms.</span>
            </label>
            <div>
              <Label className="mb-1 block">Signature</Label>
              <SignaturePad value={sig ?? undefined} onChange={setSig} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}><FileSignature className="mr-1 h-4 w-4" /> Save signature</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}

function HandoffStatus({ rental }: { rental: Rental }) {
  const insps = getInspectionsForRental(rental.id);
  const checkout = insps.find(i => i.type === "check-out");
  if (rental.endDate) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5" /> Returned {fmtDate(rental.endDate)}
      </div>
    );
  }
  if (checkout) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary">
        <Truck className="h-3.5 w-3.5" /> Out with driver — delivered {fmtDate(checkout.date)} at {checkout.mileage.toLocaleString()} mi
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
      <ClipboardCheck className="h-3.5 w-3.5" /> Awaiting handoff — log delivery to give the driver the keys
    </div>
  );
}

function DeliveryDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const [mileage, setMileage] = useState(0);
  const [fuelLevel, setFuelLevel] = useState(100);
  const [damageNoted, setDamageNoted] = useState(false);
  const [completedBy, setCompletedBy] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (rental && v) {
      setMileage(v.mileage);
      setFuelLevel(100);
      setDamageNoted(false);
      setCompletedBy("");
      setNotes("");
    }
  }, [rental, v]);
  function confirm() {
    if (!rental || !v) return;
    if (!completedBy.trim()) {
      toast.error("Who is delivering the vehicle?");
      return;
    }
    addInspection({
      vehicleId: v.id,
      rentalId: rental.id,
      type: "check-out",
      date: new Date().toISOString().slice(0, 10),
      mileage: Number(mileage) || v.mileage,
      fuelLevel: Number(fuelLevel),
      damageNoted,
      completedBy: completedBy.trim(),
    });
    if (notes.trim()) {
      updateRental(rental.id, { notes: [rental.notes, `Delivery: ${notes.trim()}`].filter(Boolean).join(" · ") });
    }
    toast.success("Vehicle delivered", { description: `${v.year} ${v.make} ${v.model} → ${d?.fullName}` });
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deliver vehicle</DialogTitle>
        </DialogHeader>
        {rental && v && d && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Handing off to {d.fullName} · {d.phone}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="dl-mi">Odometer (mi)</Label>
                <Input id="dl-mi" type="number" value={mileage} onChange={e => setMileage(Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="dl-fuel">Fuel level (%)</Label>
                <Input id="dl-fuel" type="number" min={0} max={100} value={fuelLevel} onChange={e => setFuelLevel(Number(e.target.value))} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="dl-by">Delivered by</Label>
                <Input id="dl-by" value={completedBy} onChange={e => setCompletedBy(e.target.value)} placeholder="Staff name" />
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <input id="dl-dmg" type="checkbox" checked={damageNoted} onChange={e => setDamageNoted(e.target.checked)} className="h-4 w-4" />
                <Label htmlFor="dl-dmg" className="!mt-0">Pre-existing damage noted</Label>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="dl-notes">Delivery notes</Label>
                <Textarea id="dl-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Pickup location, fuel/cleanliness, walk-around notes…" />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}><Truck className="mr-1 h-4 w-4" /> Confirm delivery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const checkout = rental ? getInspectionsForRental(rental.id).find(i => i.type === "check-out") : undefined;
  const [mileage, setMileage] = useState(0);
  const [fuelLevel, setFuelLevel] = useState(100);
  const [damageNoted, setDamageNoted] = useState(false);
  const [completedBy, setCompletedBy] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (rental && v) {
      setMileage(v.mileage);
      setFuelLevel(100);
      setDamageNoted(false);
      setCompletedBy("");
      setNotes("");
    }
  }, [rental, v]);
  function confirm() {
    if (!rental || !v) return;
    if (!completedBy.trim()) { toast.error("Who received the vehicle?"); return; }
    if (mileage < (checkout?.mileage ?? 0)) { toast.error("Return mileage can't be less than delivery mileage"); return; }
    addInspection({
      vehicleId: v.id,
      rentalId: rental.id,
      type: "check-in",
      date: new Date().toISOString().slice(0, 10),
      mileage: Number(mileage) || v.mileage,
      fuelLevel: Number(fuelLevel),
      damageNoted,
      completedBy: completedBy.trim(),
    });
    if (notes.trim()) {
      updateRental(rental.id, { notes: [rental.notes, `Return: ${notes.trim()}`].filter(Boolean).join(" · ") });
    }
    markReturned(rental.id);
    const drove = checkout ? mileage - checkout.mileage : 0;
    toast.success("Vehicle returned", {
      description: `${v.year} ${v.make} ${v.model}${drove > 0 ? ` · ${drove.toLocaleString()} mi driven` : ""}`,
    });
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Process return</DialogTitle></DialogHeader>
        {rental && v && d && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Returned by {d.fullName} · {d.phone}</div>
              {checkout && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Delivered {fmtDate(checkout.date)} at {checkout.mileage.toLocaleString()} mi · fuel {checkout.fuelLevel}%
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rt-mi">Return odometer (mi)</Label>
                <Input id="rt-mi" type="number" value={mileage} onChange={e => setMileage(Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="rt-fuel">Fuel level (%)</Label>
                <Input id="rt-fuel" type="number" min={0} max={100} value={fuelLevel} onChange={e => setFuelLevel(Number(e.target.value))} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="rt-by">Received by</Label>
                <Input id="rt-by" value={completedBy} onChange={e => setCompletedBy(e.target.value)} placeholder="Staff name" />
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <input id="rt-dmg" type="checkbox" checked={damageNoted} onChange={e => setDamageNoted(e.target.checked)} className="h-4 w-4" />
                <Label htmlFor="rt-dmg" className="!mt-0">New damage observed</Label>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="rt-notes">Return notes</Label>
                <Textarea id="rt-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Cleanliness, missing items, damage details…" />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}><CheckCircle2 className="mr-1 h-4 w-4" /> Confirm return</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditRentalDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const [weeklyRate, setWeeklyRate] = useState(0);
  const [depositPaid, setDepositPaid] = useState(0);
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (rental) {
      setWeeklyRate(rental.weeklyRate);
      setDepositPaid(rental.depositPaid);
      setEndDate(rental.endDate ?? "");
      setNotes(rental.notes ?? "");
    }
  }, [rental]);
  function save() {
    if (!rental) return;
    updateRental(rental.id, { weeklyRate, depositPaid, endDate: endDate || undefined, notes: notes || undefined });
    toast.success("Reservation updated");
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit reservation</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Weekly rate</Label><Input type="number" value={weeklyRate} onChange={e => setWeeklyRate(Number(e.target.value))} /></div>
          <div><Label>Deposit</Label><Input type="number" value={depositPaid} onChange={e => setDepositPaid(Number(e.target.value))} /></div>
          <div className="sm:col-span-2"><Label>End date</Label><Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Notes</Label><Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtendRentalDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const [newEndDate, setNewEndDate] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (rental) {
      const base = rental.endDate ? new Date(rental.endDate) : new Date();
      base.setDate(base.getDate() + 7);
      setNewEndDate(base.toISOString().slice(0, 10));
      setSig(null);
      setAccepted(false);
    }
  }, [rental]);
  const charge = rental && newEndDate ? computeExtensionCharge(rental, newEndDate) : null;
  function confirm() {
    if (!rental || !newEndDate || !d) return;
    if (rental.endDate && newEndDate <= rental.endDate) {
      toast.error("New end date must be after the current end date");
      return;
    }
    if (!accepted) { toast.error("Renter must accept the extension addendum"); return; }
    if (!sig) { toast.error("Signature required for the addendum"); return; }
    const ext = extendRental(rental.id, newEndDate, {
      signatureDataUrl: sig,
      signedBy: d.fullName,
      agreementVersion: AGREEMENT_VERSION,
    });
    toast.success("Rental extended", {
      description: `${v?.year} ${v?.make} ${v?.model} → ${fmtDate(newEndDate)}${ext && ext.additionalAmount > 0 ? ` · ${fmtMoney(ext.additionalAmount)} added to receipt` : ""}`,
    });
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Extend rental</DialogTitle></DialogHeader>
        {rental && v && d && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Renter: {d.fullName}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Current end date: {rental.endDate ? fmtDate(rental.endDate) : "open-ended"}
              </div>
            </div>
            <div>
              <Label htmlFor="ext-end">New end date</Label>
              <Input id="ext-end" type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)} />
            </div>
            {charge && charge.additionalAmount > 0 && (
              <div className="rounded-md border bg-card p-3 text-sm">
                <div className="text-xs uppercase text-muted-foreground">Extension charge (added to receipt)</div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span>{charge.periods} additional {charge.periodLabel}{charge.periods === 1 ? "" : "s"} × {fmtMoney(rental.rate ?? rental.weeklyRate)}</span>
                  <span className="text-lg font-bold">{fmtMoney(charge.additionalAmount)}</span>
                </div>
              </div>
            )}
            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <div className="font-semibold text-foreground">EXTENSION ADDENDUM TO RENTAL AGREEMENT {AGREEMENT_VERSION}</div>
              <p className="mt-2">
                This addendum extends the rental of <span className="font-medium text-foreground">{v.year} {v.make} {v.model} (Plate {v.plate})</span> by{" "}
                <span className="font-medium text-foreground">{charge?.periods ?? 0} {charge?.periodLabel}{(charge?.periods ?? 0) === 1 ? "" : "s"}</span>
                {rental.endDate ? <> from {fmtDate(rental.endDate)}</> : null} through{" "}
                <span className="font-medium text-foreground">{newEndDate ? fmtDate(newEndDate) : "—"}</span>.
                Renter agrees to pay an additional <span className="font-medium text-foreground">{fmtMoney(charge?.additionalAmount ?? 0)}</span> at the contracted rate of {fmtMoney(rental.rate ?? rental.weeklyRate)}/{(rental.billingPeriod ?? "weekly").replace("ly", "")}. All other terms of the original agreement remain in full force.
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
              <span>I, <span className="font-medium">{d.fullName}</span>, agree to the extension and the additional charge above.</span>
            </label>
            <div>
              <Label className="mb-1 block">Renter signature (addendum)</Label>
              <SignaturePad value={sig ?? undefined} onChange={setSig} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm}><CalendarPlus className="mr-1 h-4 w-4" /> Confirm extension</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgreementDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Signed rental agreement</DialogTitle>
        </DialogHeader>
        {rental && v && d && (
          <div className="space-y-3 text-sm max-h-[70vh] overflow-y-auto pr-1">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Renter: {d.fullName}</div>
              <div className="text-xs text-muted-foreground">
                Started {fmtDate(rental.startDate)}{rental.endDate ? ` · Ends ${fmtDate(rental.endDate)}` : ""}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Signature {rental.agreementVersion ? `· ${rental.agreementVersion}` : ""}
              </div>
              {rental.signatureDataUrl ? (
                <img src={rental.signatureDataUrl} alt="Signature" className="w-full rounded border bg-white object-contain p-2" />
              ) : (
                <div className="rounded border border-dashed p-6 text-center text-xs text-muted-foreground">No signature on file</div>
              )}
              {rental.signedAt && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Signed by {rental.signedBy ?? d.fullName} on {new Date(rental.signedAt).toLocaleString()}
                </div>
              )}
            </div>
            {rental.extensions && rental.extensions.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs uppercase text-muted-foreground">Extension addenda</div>
                {rental.extensions.map((ext, i) => (
                  <div key={ext.id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">Addendum #{i + 1}</div>
                        <div className="text-xs text-muted-foreground">
                          {ext.previousEndDate ? `${fmtDate(ext.previousEndDate)} → ` : ""}{fmtDate(ext.newEndDate)} · +{ext.periods} {ext.periodLabel}{ext.periods === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold">{fmtMoney(ext.additionalAmount)}</div>
                        <div className="text-xs text-muted-foreground">added to receipt</div>
                      </div>
                    </div>
                    {ext.signatureDataUrl && (
                      <img src={ext.signatureDataUrl} alt="Addendum signature" className="mt-2 h-16 w-full rounded border bg-white object-contain p-1" />
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">
                      Signed by {ext.signedBy ?? d.fullName} on {new Date(ext.extendedAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({ rental, onClose }: { rental: Rental | null; onClose: () => void }) {
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const d = rental ? driverById(rental.driverId) : null;
  const sched = rental ? payments.filter(p => p.rentalId === rental.id) : [];
  const baseTotal = rental ? (rental.depositPaid ?? 0) + sched.reduce((s, p) => s + p.amount, 0) : 0;
  const extTotal = rental?.extensions?.reduce((s, e) => s + e.additionalAmount, 0) ?? 0;
  const grandTotal = baseTotal + extTotal;
  const paidTotal = sched.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0) + (rental?.paymentReceived ? 0 : 0);
  const balance = grandTotal - paidTotal - (rental?.depositPaid ?? 0);

  function printReceipt() {
    const win = window.open("", "_blank", "width=720,height=900");
    if (!win || !rental || !v || !d) return;
    const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const lines: string[] = [];
    lines.push(`<tr><td>${fmtDate(rental.startDate)}</td><td>Security deposit</td><td style="text-align:right">${fmt(rental.depositPaid)}</td><td>—</td></tr>`);
    sched.forEach(p => {
      lines.push(`<tr><td>${fmtDate(p.dueDate)}</td><td>Rental payment (${p.status})</td><td style="text-align:right">${fmt(p.amount)}</td><td>${p.method ?? "—"}</td></tr>`);
    });
    rental.extensions?.forEach((e, i) => {
      lines.push(`<tr><td>${new Date(e.extendedAt).toLocaleDateString()}</td><td>Extension addendum #${i + 1} (+${e.periods} ${e.periodLabel}${e.periods === 1 ? "" : "s"})</td><td style="text-align:right">${fmt(e.additionalAmount)}</td><td>—</td></tr>`);
    });
    win.document.write(`<!doctype html><html><head><title>Receipt ${rental.id}</title>
      <style>
        body{font-family:system-ui,sans-serif;max-width:680px;margin:24px auto;padding:0 16px;color:#111}
        h1{margin:0 0 4px;font-size:22px}
        .meta{color:#666;font-size:12px;margin-bottom:24px}
        .box{border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:16px;font-size:13px}
        table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
        th,td{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
        th{background:#f7f7f7;font-size:11px;text-transform:uppercase;color:#555}
        tfoot td{font-weight:600;border-top:2px solid #333;border-bottom:none;padding-top:10px}
        .totals{margin-top:16px;text-align:right;font-size:14px}
        .totals .grand{font-size:18px;font-weight:700;margin-top:6px}
        @media print { button{display:none} }
      </style></head><body>
      <h1>Rentalprise Auto — Receipt</h1>
      <div class="meta">Reservation ${rental.id} · Issued ${new Date().toLocaleString()}</div>
      <div class="box">
        <strong>${v.year} ${v.make} ${v.model}</strong> · Plate ${v.plate} · VIN ${v.vin}<br/>
        Renter: ${d.fullName} · ${d.phone} · ${d.email}<br/>
        Period: ${fmtDate(rental.startDate)}${rental.endDate ? ` → ${fmtDate(rental.endDate)}` : " (open)"}<br/>
        Rate: ${fmt(rental.rate ?? rental.weeklyRate)} / ${(rental.billingPeriod ?? "weekly").replace("ly", "")}
      </div>
      <table>
        <thead><tr><th>Date</th><th>Description</th><th style="text-align:right">Amount</th><th>Method</th></tr></thead>
        <tbody>${lines.join("")}</tbody>
      </table>
      <div class="totals">
        Subtotal (rental + deposit): ${fmt(baseTotal)}<br/>
        Extensions: ${fmt(extTotal)}<br/>
        <div class="grand">Total: ${fmt(grandTotal)}</div>
      </div>
      ${rental.signatureDataUrl ? `<div style="margin-top:32px"><div style="font-size:11px;color:#666;text-transform:uppercase">Signed by ${rental.signedBy ?? d.fullName}</div><img src="${rental.signatureDataUrl}" style="max-width:240px;border:1px solid #ddd;padding:4px;margin-top:4px"/></div>` : ""}
      <button onclick="window.print()" style="margin-top:24px;padding:8px 16px;background:#111;color:#fff;border:0;border-radius:4px;cursor:pointer">Print / Save as PDF</button>
      </body></html>`);
    win.document.close();
  }

  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Receipt — {rental?.id}</DialogTitle></DialogHeader>
        {rental && v && d && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground">Renter: {d.fullName}</div>
              <div className="text-xs text-muted-foreground">
                {fmtDate(rental.startDate)}{rental.endDate ? ` → ${fmtDate(rental.endDate)}` : " · open"}
              </div>
            </div>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr><th className="text-left py-1">Date</th><th className="text-left">Description</th><th className="text-right">Amount</th><th className="text-left pl-2">Method</th></tr>
              </thead>
              <tbody>
                <tr className="border-t"><td className="py-1.5">{fmtDate(rental.startDate)}</td><td>Security deposit</td><td className="text-right">{fmtMoney(rental.depositPaid)}</td><td className="pl-2">—</td></tr>
                {sched.map(p => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1.5">{fmtDate(p.dueDate)}</td>
                    <td>Rental payment <span className="text-muted-foreground">({p.status})</span></td>
                    <td className="text-right">{fmtMoney(p.amount)}</td>
                    <td className="pl-2">{p.method ?? "—"}</td>
                  </tr>
                ))}
                {rental.extensions?.map((e, i) => (
                  <tr key={e.id} className="border-t">
                    <td className="py-1.5">{new Date(e.extendedAt).toLocaleDateString()}</td>
                    <td>Extension #{i + 1} (+{e.periods} {e.periodLabel}{e.periods === 1 ? "" : "s"})</td>
                    <td className="text-right">{fmtMoney(e.additionalAmount)}</td>
                    <td className="pl-2">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rounded-md border bg-muted/30 p-3 text-right text-sm space-y-0.5">
              <div>Subtotal: <span className="font-medium">{fmtMoney(baseTotal)}</span></div>
              <div>Extensions: <span className="font-medium">{fmtMoney(extTotal)}</span></div>
              <div className="text-base font-bold pt-1 border-t mt-1">Total: {fmtMoney(grandTotal)}</div>
              {balance !== 0 && <div className="text-xs text-muted-foreground">Outstanding balance: {fmtMoney(Math.max(0, balance))}</div>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={printReceipt}><Printer className="mr-1 h-4 w-4" /> Print / Save PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
