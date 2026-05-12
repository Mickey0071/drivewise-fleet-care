import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { violations, vehicleById, driverById, fmtMoney, fmtDate } from "@/lib/mock/data";

export const Route = createFileRoute("/violations")({
  head: () => ({ meta: [{ title: "Violations — Camauto Rentals" }] }),
  component: ViolationsPage,
});

function ViolationsPage() {
  const outstanding = violations.filter(v => v.status === "pending").reduce((s, v) => s + v.amount, 0);
  return (
    <div>
      <PageHeader title="Violations Board" subtitle={`${violations.length} on record`} action={<Button>+ Log Violation</Button>} />
      <Card className="mb-6 border-destructive/40 bg-destructive/5">
        <CardContent className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Outstanding</div>
          <div className="mt-1 text-3xl font-bold text-destructive">{fmtMoney(outstanding)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {violations.map(v => {
            const veh = vehicleById(v.vehicleId);
            const drv = v.driverId ? driverById(v.driverId) : null;
            return (
              <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{v.type.toUpperCase()} · {veh?.plate}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtDate(v.dateIssued)} {drv && `· ${drv.fullName}`} {v.notes && `· ${v.notes}`}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{fmtMoney(v.amount)}</span>
                  <StatusBadge status={v.status} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
