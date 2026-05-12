import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { rentals, vehicleById, driverById, payments, fmtMoney, fmtDate } from "@/lib/mock/data";
import { ReportActions } from "@/components/app/ReportActions";
import { NewReservationDialog } from "@/components/app/NewReservationDialog";
import { useState } from "react";
import { Car } from "lucide-react";

export const Route = createFileRoute("/rentals")({
  head: () => ({ meta: [{ title: "Reservations — Camauto Rentals" }] }),
  component: RentalsPage,
});

function RentalsPage() {
  const [newOpen, setNewOpen] = useState(false);
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
                    <Stat label="Weekly" value={fmtMoney(r.weeklyRate)} />
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
                    <Button variant="outline" size="sm">Edit</Button>
                    <Button variant="outline" size="sm">Mark Returned</Button>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <NewReservationDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}
