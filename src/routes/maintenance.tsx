import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maintenance, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { Wrench, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/maintenance")({
  head: () => ({ meta: [{ title: "Maintenance — Camauto Rentals" }] }),
  component: MaintenancePage,
});

function MaintenancePage() {
  const today = new Date();
  const soon = new Date(today); soon.setDate(today.getDate() + 14);
  const due = maintenance.filter(m => new Date(m.nextServiceDue) <= soon);
  const totalCost = maintenance.reduce((s, m) => s + m.cost, 0);

  return (
    <div>
      <PageHeader title="Maintenance Log" subtitle="Per-vehicle service history" action={<Button>+ Log Service</Button>} />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <KPI label="YTD spend" value={fmtMoney(totalCost)} icon={Wrench} />
        <KPI label="Service records" value={String(maintenance.length)} icon={Wrench} />
        <KPI label="Due soon" value={String(due.length)} icon={AlertTriangle} tone="text-warning-foreground" />
      </div>

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
            return (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{m.serviceType}</div>
                  <div className="text-xs text-muted-foreground">
                    {v?.year} {v?.make} {v?.model} · {v?.plate} · {m.vendor} · {fmtDate(m.dateCompleted)}
                  </div>
                </div>
                <span className="font-semibold">{fmtMoney(m.cost)}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>
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
