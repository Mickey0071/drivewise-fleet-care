import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { rentals, vehicleById, driverById, payments, fmtMoney, fmtDate } from "@/lib/mock/data";
import { useStoreVersion, updateRental, markReturned } from "@/lib/mock/store";
import { ReportActions } from "@/components/app/ReportActions";
import { NewReservationDialog } from "@/components/app/NewReservationDialog";
import { useEffect, useState } from "react";
import { Car } from "lucide-react";
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
                    {!r.endDate && (
                      <Button variant="outline" size="sm" onClick={() => {
                        markReturned(r.id);
                        toast.success("Vehicle marked returned", { description: `${v?.year} ${v?.make} ${v?.model}` });
                      }}>Mark Returned</Button>
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
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
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
