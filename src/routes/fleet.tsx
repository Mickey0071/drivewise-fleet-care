import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { vehicles, fmtMoney } from "@/lib/mock/data";
import { carImage } from "@/lib/mock/carImages";

export const Route = createFileRoute("/fleet")({
  head: () => ({ meta: [{ title: "Fleet — Camauto Rentals" }] }),
  component: FleetPage,
});

function FleetPage() {
  return (
    <div>
      <PageHeader
        title="Fleet Manager"
        subtitle={`${vehicles.length} vehicles in service`}
        action={<Button>+ Add Vehicle</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vehicles.map(v => (
          <Link key={v.id} to="/fleet/$vehicleId" params={{ vehicleId: v.id }}>
            <Card className="transition-all hover:border-primary hover:shadow-md">
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-xl bg-muted">
                <img
                  src={carImage(v.model)}
                  alt={`${v.year} ${v.make} ${v.model}`}
                  loading="lazy"
                  width={800}
                  height={512}
                  className="h-full w-full object-cover"
                />
                <div className="absolute right-2 top-2">
                  <StatusBadge status={v.status} />
                </div>
              </div>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{v.id} · {v.plate}</div>
                    <div className="mt-0.5 font-semibold">{v.year} {v.make} {v.model}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{v.mileage.toLocaleString()} mi</span>
                  <span className="font-medium">{fmtMoney(v.weeklyRate)}/wk</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">Risk tier {v.riskTier}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
