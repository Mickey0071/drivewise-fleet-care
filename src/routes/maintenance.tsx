import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maintenance, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { Wrench, AlertTriangle, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReportActions } from "@/components/app/ReportActions";
import { LogServiceDialog } from "@/components/app/LogServiceDialog";
import { AddIssueDialog } from "@/components/app/AddIssueDialog";
import { ResolveMaintenanceDialog } from "@/components/app/ResolveMaintenanceDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { isServiceLogRecord } from "@/lib/maintenance-utils";
import { useState } from "react";
import { useStoreVersion } from "@/lib/mock/store";
import type { Maintenance } from "@/lib/mock/data";
import { PendingInspections } from "@/components/app/PendingInspections";

export const Route = createFileRoute("/maintenance")({
  head: () => ({ meta: [{ title: "Maintenance — Camauto Rentals" }] }),
  component: MaintenancePage,
});

function MaintenancePage() {
  useStoreVersion();
  const [logOpen, setLogOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [resolveRecord, setResolveRecord] = useState<Maintenance | null>(null);
  const today = new Date();
  const open = maintenance.filter(m => !m.dateCompleted)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const resolved = maintenance.filter(m => !!m.dateCompleted && !isServiceLogRecord(m))
    .sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""));
  const serviceLog = maintenance.filter(isServiceLogRecord)
    .sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""));
  const totalCost = resolved.reduce((s, m) => s + m.cost, 0);
  const serviceCost = serviceLog.reduce((s, m) => s + m.cost, 0);

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
            <Button variant="outline" onClick={() => setIssueOpen(true)}>+ Add Issue</Button>
            <Button onClick={() => setLogOpen(true)}>+ Log Service</Button>
          </div>
        }
      />
      <LogServiceDialog open={logOpen} onOpenChange={setLogOpen} />
      <AddIssueDialog open={issueOpen} onOpenChange={setIssueOpen} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPI label="Open issues" value={String(open.length)} icon={AlertTriangle} tone={open.length ? "text-destructive" : "text-foreground"} />
        <KPI label="Closed issues" value={String(resolved.length)} icon={Wrench} />
        <KPI label="Service log" value={String(serviceLog.length)} icon={ClipboardList} />
        <KPI label="Repair spend" value={fmtMoney(totalCost)} icon={Wrench} />
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">Open Issues ({open.length})</TabsTrigger>
          <TabsTrigger value="closed">Closed Issues ({resolved.length})</TabsTrigger>
          <TabsTrigger value="service">Service Log ({serviceLog.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-4">
      <Card>
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
            const issue = (m.serviceType ?? "").split("\n")[0].trim();
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setResolveRecord(m)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 shrink-0 basis-1/3">
                  <div className="truncate text-sm font-medium">
                    {v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}
                  </div>
                  <div className="text-xs text-muted-foreground">Tag #{v?.plate ?? "—"}</div>
                </div>
                <div className="min-w-0 flex-1 truncate text-sm">{issue}</div>
              </button>
            );
          })}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
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
        </TabsContent>

        <TabsContent value="service" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                Service log ({serviceLog.length}) · {fmtMoney(serviceCost)}
              </CardTitle>
              <Button size="sm" onClick={() => setLogOpen(true)}>+ Log Service</Button>
            </CardHeader>
            <CardContent className="p-0">
              {serviceLog.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No routine service logged yet. Click “+ Log Service” to add one.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Vehicle</th>
                        <th className="px-4 py-2 font-medium">Service type</th>
                        <th className="px-4 py-2 font-medium">Date done</th>
                        <th className="px-4 py-2 font-medium">Mileage</th>
                        <th className="px-4 py-2 text-right font-medium">Cost</th>
                        <th className="px-4 py-2 font-medium">Next due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {serviceLog.map(m => {
                        const v = vehicleById(m.vehicleId);
                        return (
                          <tr key={m.id} className="hover:bg-muted/40">
                            <td className="px-4 py-2">
                              <div className="font-medium">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</div>
                              <div className="text-xs text-muted-foreground">Tag #{v?.plate ?? "—"}</div>
                            </td>
                            <td className="px-4 py-2">{m.serviceType}</td>
                            <td className="px-4 py-2">{fmtDate(m.dateCompleted)}</td>
                            <td className="px-4 py-2">{m.mileageAtService.toLocaleString()} mi</td>
                            <td className="px-4 py-2 text-right font-medium">{fmtMoney(m.cost)}</td>
                            <td className="px-4 py-2">{fmtDate(m.nextServiceDue)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="mt-6">
        <PendingInspections />
      </div>

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
