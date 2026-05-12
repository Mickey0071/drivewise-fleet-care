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
      <div className="flex flex-col gap-2">
        {rentals.map(r => {
          const v = vehicleById(r.vehicleId);
          const d = driverById(r.driverId);
          const sched = payments.filter(p => p.rentalId === r.id);
          const next = sched.find(p => p.status !== "paid");
          const imgQuery = encodeURIComponent(`${v?.make ?? ""} ${v?.model ?? ""} car`.trim());
          const imgUrl = `https://source.unsplash.com/featured/600x400/?${imgQuery}`;
          return (
            <Card key={r.id} className="overflow-hidden">
              <div className="flex items-stretch">
                <div className="relative w-28 sm:w-36 shrink-0 bg-muted">
                  <img
                    src={imgUrl}
                    alt={`${v?.year} ${v?.make} ${v?.model}`}
                    className="absolute inset-0 h-full w-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground/40">
                    <Car className="h-7 w-7" />
                  </div>
                </div>
                <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 p-3">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base leading-tight truncate">
                      {v?.year} {v?.make} {v?.model}
                    </CardTitle>
                    <div className="text-xs text-muted-foreground truncate">
                      {v?.plate} · {d?.fullName}
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-4 text-xs">
                    <MiniStat label="Started" value={fmtDate(r.startDate)} />
                    <MiniStat label="Weekly" value={fmtMoney(r.weeklyRate)} />
                    <MiniStat label="Deposit" value={fmtMoney(r.depositPaid)} />
                    <MiniStat
                      label="Next"
                      value={next ? `${fmtMoney(next.amount)} · ${fmtDate(next.dueDate)}` : "All paid"}
                    />
                  </div>
                  <StatusBadge status={r.paymentStatus} />
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">Edit</Button>
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">Return</Button>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  );
}
