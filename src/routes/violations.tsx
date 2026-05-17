import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { violations, vehicleById, driverById, fmtMoney, fmtDate } from "@/lib/mock/data";
import { useStoreVersion } from "@/lib/mock/store";
import { ReportActions } from "@/components/app/ReportActions";

export const Route = createFileRoute("/violations")({
  head: () => ({ meta: [{ title: "Violations — Camauto Rentals" }] }),
  component: ViolationsPage,
});

function ViolationsPage() {
  useStoreVersion();
  const outstanding = violations.filter(v => v.status === "pending").reduce((s, v) => s + v.amount, 0);
  return (
    <div>
      <PageHeader
        title="Violations Board"
        subtitle={`${violations.length} on record`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ReportActions csv={{
              filename: "violations.csv",
              headers: ["ID", "Type", "Plate", "Driver", "Date", "Amount", "Status", "Notes"],
              rows: violations.map(v => [v.id, v.type, vehicleById(v.vehicleId)?.plate ?? v.vehicleId, v.driverId ? driverById(v.driverId)?.fullName ?? v.driverId : "", v.dateIssued, v.amount, v.status, v.notes ?? ""]),
            }} />
            <Button>+ Log Violation</Button>
          </div>
        }
      />
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
