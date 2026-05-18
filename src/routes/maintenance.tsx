import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maintenance, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { Wrench, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReportActions } from "@/components/app/ReportActions";
import { LogServiceDialog } from "@/components/app/LogServiceDialog";
import { EditMaintenanceDialog } from "@/components/app/EditMaintenanceDialog";
import { useState } from "react";
import { useStoreVersion } from "@/lib/mock/store";
import type { Maintenance } from "@/lib/mock/data";

export const Route = createFileRoute("/maintenance")({
  head: () => ({ meta: [{ title: "Maintenance — Camauto Rentals" }] }),
  component: MaintenancePage,
});

function MaintenancePage() {
  useStoreVersion();
  const [logOpen, setLogOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<Maintenance | null>(null);
  const today = new Date();
  const soon = new Date(today); soon.setDate(today.getDate() + 14);
  const due = maintenance.filter(m => new Date(m.nextServiceDue) <= soon);
  const overdue = maintenance.filter(m => new Date(m.nextServiceDue) < today);
  const totalCost = maintenance.reduce((s, m) => s + m.cost, 0);
  const daysOverdue = (d: string) =>
    Math.floor((today.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div>
      <PageHeader
        title="Maintenance Log"
        subtitle="Per-vehicle service history"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ReportActions csv={{
              filename: "maintenance.csv",
              headers: ["ID", "Vehicle", "Plate", "Service", "Vendor", "Date", "Mileage", "Cost", "Next due"],
              rows: maintenance.map(m => {
                const v = vehicleById(m.vehicleId);
                return [m.id, v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId, v?.plate ?? "", m.serviceType, m.vendor, m.dateCompleted, m.mileageAtService, m.cost, m.nextServiceDue];
              }),
            }} />
            <Button onClick={() => setLogOpen(true)}>+ Log Service</Button>
          </div>
        }
      />
      <LogServiceDialog open={logOpen} onOpenChange={setLogOpen} />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <KPI label="YTD spend" value={fmtMoney(totalCost)} icon={Wrench} />
        <KPI label="Service records" value={String(maintenance.length)} icon={Wrench} />
        <KPI label="Overdue" value={String(overdue.length)} icon={AlertTriangle} tone={overdue.length ? "text-destructive" : "text-foreground"} />
      </div>

      {overdue.length > 0 && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Overdue services</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overdue.map(m => {
              const v = vehicleById(m.vehicleId);
              const days = daysOverdue(m.nextServiceDue);
              return (
                <div key={m.id} className="flex items-center justify-between rounded-md bg-card border border-destructive/30 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{v?.year} {v?.make} {v?.model} · {v?.plate}</div>
                    <div className="text-xs text-muted-foreground">{m.serviceType} · was due {fmtDate(m.nextServiceDue)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive">{days} {days === 1 ? "day" : "days"} overdue</Badge>
                    <Button size="sm" variant="outline">Schedule</Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {due.length > 0 && (
        <Card className="mb-6 border-warning/40 bg-warning/5">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning-foreground" />Service due within 2 weeks</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {due.map(m => {
              const v = vehicleById(m.vehicleId);
              return (
                <div key={m.id} className="flex items-center justify-between rounded-md bg-card border border-border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{v?.year} {v?.make} {v?.model} · {v?.plate}</div>
                    <div className="text-xs text-muted-foreground">Due {fmtDate(m.nextServiceDue)}</div>
                  </div>
                  <Button size="sm" variant="outline">Schedule</Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Service history</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {maintenance.map(m => {
            const v = vehicleById(m.vehicleId);
            const isOverdue = new Date(m.nextServiceDue) < today;
            const days = isOverdue ? daysOverdue(m.nextServiceDue) : 0;
            const isOpen = !m.dateCompleted;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setEditRecord(m)}
                className={`flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/40 ${isOverdue ? "bg-destructive/5" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {m.serviceType}
                    {isOverdue && <Badge variant="destructive">{days}d overdue</Badge>}
                    {isOpen && (
                      <Badge variant="outline" className="border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                        Open
                      </Badge>
                    )}
                    {m.sourceInspectionId && (
                      <Badge variant="outline">From inspection</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {v?.year} {v?.make} {v?.model} · {v?.plate} · {m.vendor} · {m.dateCompleted ? fmtDate(m.dateCompleted) : "open"}
                  </div>
                </div>
                <span className="font-semibold">{fmtMoney(m.cost)}</span>
              </button>
            );
          })}
        </CardContent>
      </Card>
      <EditMaintenanceDialog
        open={!!editRecord}
        onOpenChange={(o) => { if (!o) setEditRecord(null); }}
        record={editRecord}
      />
    </div>
  );
}

function KPI({ label, value, icon: Icon, tone = "text-foreground" }: { label: string; value: string; icon: any; tone?: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
    </CardContent></Card>
  );
}
