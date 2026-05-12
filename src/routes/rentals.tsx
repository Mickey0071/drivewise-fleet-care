import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rentals, vehicleById, driverById, payments, fmtMoney, fmtDate } from "@/lib/mock/data";
import { ReportActions } from "@/components/app/ReportActions";

export const Route = createFileRoute("/rentals")({
  head: () => ({ meta: [{ title: "Rentals — Camauto Rentals" }] }),
  component: RentalsPage,
});

function RentalsPage() {
  return (
    <div>
      <PageHeader
        title="Rental Management"
        subtitle={`${rentals.length} active rentals`}
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
            <Button>+ New Rental</Button>
          </div>
        }
      />
      <div className="grid gap-3 lg:grid-cols-2">
        {rentals.map(r => {
          const v = vehicleById(r.vehicleId);
          const d = driverById(r.driverId);
          const sched = payments.filter(p => p.rentalId === r.id);
          const next = sched.find(p => p.status !== "paid");
          return (
            <Card key={r.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{d?.fullName}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {v?.year} {v?.make} {v?.model} · {v?.plate}
                  </p>
                </div>
                <StatusBadge status={r.paymentStatus} />
              </CardHeader>
              <CardContent className="space-y-3">
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
                  <Button variant="outline" size="sm" className="flex-1">Edit</Button>
                  <Button variant="outline" size="sm" className="flex-1">Mark Returned</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}
