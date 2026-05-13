import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { rentals, vehicleById, driverById, payments, fmtMoney, fmtDate } from "@/lib/mock/data";
import { useStoreVersion, updateRental, markReturned, getInspectionsForRental, addInspection, extendRental } from "@/lib/mock/store";
import { ReportActions } from "@/components/app/ReportActions";
import { NewReservationDialog } from "@/components/app/NewReservationDialog";
import { useEffect, useState } from "react";
import { Car, Truck, ClipboardCheck, CheckCircle2, CalendarPlus, FileSignature } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { Rental } from "@/lib/mock/data";

export const Route = createFileRoute("/rentals")({
  head: () => ({ meta: [{ title: "Reservations — Camauto Rentals" }] }),
  component: RentalsPage,
});

function RentalsPage() {
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<Rental | null>(null);
  const [delivering, setDelivering] = useState<Rental | null>(null);
  const [returning, setReturning] = useState<Rental | null>(null);
  const [extending, setExtending] = useState<Rental | null>(null);
  const [viewingAgreement, setViewingAgreement] = useState<Rental | null>(null);
  useStoreVersion();
  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle={`${rentals.length} active reservations`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ReportActions csv={{
              filename: "rentals.csv",
              headers: ["ID", "Driver", "Vehicle", "Plate", "Started", "Ended", "Weekly", "Deposit", "Status"],
              rows: rentals.map(r => {
                const v = vehicleById(r.vehicleId);
                return [r.id, driverById(r.driverId)?.fullName ?? r.driverId, v ? `${v.year} ${v.make} ${v.model}` : r.vehicleId, v?.plate ?? "", r.startDate, r.endDate ?? "", r.weeklyRate, r.depositPaid, r.paymentStatus];
              }),
            }} />
            <Button onClick={() => setNewOpen(true)}>+ New Reservation</Button>
          </div>
        }
      />
      <div className="flex flex-col gap-3">
        {rentals.map(r => {
          const v = vehicleById(r.vehicleId);
          const d = driverById(r.driverId);
          const sched = payments.filter(p => p.rentalId === r.id);
          const next = sched.find(p => p.status !== "paid");
          const imgQuery = encodeURIComponent(`${v?.make ?? ""} ${v?.model ?? ""} car`.trim());
          const imgUrl = `https://source.unsplash.com/featured/600x400/?${imgQuery}`;
          return (
            <Card key={r.id} className="overflow-hidden">
              <div className="flex flex-col md:flex-row">
                <div className="relative w-full md:w-72 lg:w-80 shrink-0 bg-muted">
                  <div className="aspect-[4/3] md:aspect-auto md:h-full">
                    <img
                      src={imgUrl}
                      alt={`${v?.year} ${v?.make} ${v?.model}`}
                      className="h-full w-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground/40">
                      <Car className="h-16 w-16" />
                    </div>
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
                        Rented to <span className="text-foreground font-medium">{d?.fullName}</span>
                      </p>
                    </div>
                    <StatusBadge status={r.paymentStatus} />
                  </div>
                  <HandoffStatus rental={r} />
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <Stat label="Started" value={fmtDate(r.startDate)} />
                    <Stat
                      label={r.billingPeriod === "daily" ? "Daily" : r.billingPeriod === "monthly" ? "Monthly" : "Weekly"}
                      value={fmtMoney(r.rate ?? r.weeklyRate)}
                    />
                    <Stat label="Deposit" value={fmtMoney(r.depositPaid)} />
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <div className="text-xs uppercase text-muted-foreground">Next payment</div>
                    {next ? (
                      <div className="mt-1 flex items-center justify-between">
                        <span className="font-medium">{fmtMoney(next.amount)} due {fmtDate(next.dueDate)}</span>
                        <StatusBadge status={next.status} />
                      </div>
                    ) : <div className="mt-1 text-sm text-muted-foreground">All paid</div>}
                  </div>
                  <div className="flex gap-2">
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
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <NewReservationDialog open={newOpen} onOpenChange={setNewOpen} />
      <EditRentalDialog rental={editing} onClose={() => setEditing(null)} />
      <DeliveryDialog rental={delivering} onClose={() => setDelivering(null)} />
      <ReturnDialog rental={returning} onClose={() => setReturning(null)} />
      <ExtendRentalDialog rental={extending} onClose={() => setExtending(null)} />
      <AgreementDialog rental={viewingAgreement} onClose={() => setViewingAgreement(null)} />
    </div>
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
  const [newEndDate, setNewEndDate] = useState("");
  useEffect(() => {
    if (rental) {
      // Default to +7 days from current end date or today
      const base = rental.endDate ? new Date(rental.endDate) : new Date();
      base.setDate(base.getDate() + 7);
      setNewEndDate(base.toISOString().slice(0, 10));
    }
  }, [rental]);
  function confirm() {
    if (!rental || !newEndDate) return;
    if (rental.endDate && newEndDate <= rental.endDate) {
      toast.error("New end date must be after the current end date");
      return;
    }
    extendRental(rental.id, newEndDate);
    toast.success("Rental extended", {
      description: `${v?.year} ${v?.make} ${v?.model} now ends ${fmtDate(newEndDate)}`,
    });
    onClose();
  }
  return (
    <Dialog open={!!rental} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Extend rental</DialogTitle></DialogHeader>
        {rental && v && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{v.year} {v.make} {v.model} · {v.plate}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Current end date: {rental.endDate ? fmtDate(rental.endDate) : "open-ended"}
              </div>
            </div>
            <div>
              <Label htmlFor="ext-end">New end date</Label>
              <Input id="ext-end" type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)} />
              <p className="mt-2 text-xs text-muted-foreground">
                One additional billing cycle ({rental.billingPeriod ?? "weekly"}) will be scheduled if it falls within the new window.
              </p>
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
          <div className="space-y-3 text-sm">
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
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
