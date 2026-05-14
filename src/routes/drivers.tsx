import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { drivers, rentals, payments, vehicleById, fmtDate } from "@/lib/mock/data";
import { AlertCircle } from "lucide-react";

export const Route = createFileRoute("/drivers")({
  head: () => ({ meta: [{ title: "Renters — Camauto Rentals" }] }),
  component: DriversPage,
});

function DriversPage() {
  const today = new Date();
  const soon = new Date(today); soon.setDate(today.getDate() + 60);

  return (
    <div>
      <PageHeader
        title="Renter Management"
        subtitle={`${drivers.length} renters · ${drivers.filter(d => d.status === "active").length} active`}
        action={<Button>+ Add Renter</Button>}
      />
      <div className="space-y-2">
        {drivers.map(d => {
          const rental = rentals.find(r => r.driverId === d.id);
          const veh = rental ? vehicleById(rental.vehicleId) : null;
          const lateCount = payments.filter(p => p.driverId === d.id && p.status !== "paid").length;
          const expSoon = new Date(d.licenseExpiry) < soon;

          return (
            <Card key={d.id} className="transition-colors hover:border-primary/50">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold">{d.fullName}</div>
                    <StatusBadge status={d.status} />
                    {expSoon && (
                      <span className="inline-flex items-center gap-1 text-xs text-warning-foreground">
                        <AlertCircle className="h-3 w-3" /> License expires {fmtDate(d.licenseExpiry)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {d.id} · {d.phone} · {d.rideshare}
                    {veh && ` · Driving ${veh.year} ${veh.make} ${veh.model} (${veh.plate})`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {lateCount > 0 && <StatusBadge status="late" />}
                  <Button variant="outline" size="sm">View profile</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
