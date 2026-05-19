import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maintenance, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { Wrench, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReportActions } from "@/components/app/ReportActions";
import { LogServiceDialog } from "@/components/app/LogServiceDialog";
import { ResolveMaintenanceDialog } from "@/components/app/ResolveMaintenanceDialog";
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
  const [resolveRecord, setResolveRecord] = useState<Maintenance | null>(null);
  const today = new Date();
  const open = maintenance.filter(m => !m.dateCompleted)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const resolved = maintenance.filter(m => !!m.dateCompleted)
    .sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""));
  const totalCost = resolved.reduce((s, m) => s + m.cost, 0);
  const daysSince = (d?: string) => d
    ? Math.floor((today.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle={`${open.length} open issue${open.length === 1 ? "" : "s"} across the fleet`}
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
        <KPI label="Open issues" value={String(open.length)} icon={AlertTriangle} tone={open.length ? "text-destructive" : "text-foreground"} />
        <KPI label="Resolved" value={String(resolved.length)} icon={Wrench} />
        <KPI label="Repair spend" value={fmtMoney(totalCost)} icon={Wrench} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Open issues ({open.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {open.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No open maintenance issues. The fleet is in good shape.
            </div>
          ) : open.map(m => {
            const v = vehicleById(m.vehicleId);
            const age = daysSince(m.createdAt?.slice(0, 10));
            const priority = age >= 14 ? "high" : age >= 5 ? "medium" : "normal";
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setResolveRecord(m)}
                className="grid w-full grid-cols-12 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <div className="col-span-12 sm:col-span-4 min-w-0">
                  <div className="truncate text-sm font-medium">
                    {v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}
                  </div>
                  <div className="text-xs text-muted-foreground">Tag #{v?.plate ?? "—"}</div>
                </div>
                <div className="col-span-8 sm:col-span-5 min-w-0">
                  <div className="truncate text-sm">{m.serviceType}</div>
                  {m.sourceInspectionId && (
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">From inspection</div>
                  )}
                </div>
                <div className="col-span-2 sm:col-span-2 text-xs text-muted-foreground">
                  {m.createdAt ? fmtDate(m.createdAt.slice(0, 10)) : "—"}
                </div>
                <div className="col-span-2 sm:col-span-1 flex justify-end">
                  <Badge
                    variant={priority === "high" ? "destructive" : "outline"}
                    className={
                      priority === "medium"
                        ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : ""
                    }
                  >
                    {priority}
                  </Badge>
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Completed issues ({resolved.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {resolved.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No completed issues yet.</div>
          ) : resolved.map(m => {
            const v = vehicleById(m.vehicleId);
            // Parse resolution line appended by ResolveMaintenanceDialog:
            // "Resolved YYYY-MM-DD by NAME: WHAT (cost $X.XX)"
            const resLine = (m.notes ?? "")
              .split("\n")
              .reverse()
              .find(l => l.startsWith("Resolved "));
            let whatFixed = "";
            let completedBy = m.vendor;
            if (resLine) {
              const match = resLine.match(/^Resolved \d{4}-\d{2}-\d{2} by ([^:]+):\s*(.*?)(?:\s*\(cost \$[\d.]+\))?$/);
              if (match) {
                completedBy = match[1].trim();
                whatFixed = match[2].trim();
              }
            }
            return (
              <div key={m.id} className="grid grid-cols-12 items-start gap-3 p-4">
                <div className="col-span-12 sm:col-span-3 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}
                  </div>
                  <div className="text-xs text-muted-foreground">Tag #{v?.plate ?? "—"}</div>
                </div>
                <div className="col-span-12 sm:col-span-4 min-w-0">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Issue</div>
                  <div className="text-sm">{m.serviceType}</div>
                  {whatFixed && (
                    <>
                      <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">What was fixed</div>
                      <div className="text-sm">{whatFixed}</div>
                    </>
                  )}
                </div>
                <div className="col-span-6 sm:col-span-2 min-w-0">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Completed</div>
                  <div className="text-sm">{fmtDate(m.dateCompleted)}</div>
                  <div className="text-xs text-muted-foreground truncate">by {completedBy}</div>
                </div>
                <div className="col-span-6 sm:col-span-3 text-right">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Cost</div>
                  <div className="text-sm font-semibold">{fmtMoney(m.cost)}</div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <ResolveMaintenanceDialog
        open={!!resolveRecord}
        onOpenChange={(o) => { if (!o) setResolveRecord(null); }}
        record={resolveRecord}
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
