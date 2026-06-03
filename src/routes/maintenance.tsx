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
import { CreateRepairDialog } from "@/components/app/CreateRepairDialog";
import { RepairsBoard } from "@/components/app/RepairsBoard";
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
  const [repairOpen, setRepairOpen] = useState(false);
  const [resolveRecord, setResolveRecord] = useState<Maintenance | null>(null);
  const [tab, setTab] = useState("scheduled");

  // Scheduled maintenance = routine service log + non-repair open issues
  const openIssues = maintenance
    .filter(m => !m.dateCompleted && !m.status)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const serviceLog = maintenance.filter(isServiceLogRecord)
    .sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""));
  const serviceCost = serviceLog.reduce((s, m) => s + m.cost, 0);

  // Repairs (kanban-tracked)
  const repairs = maintenance.filter(m => !!m.status);
  const openRepairs = repairs.filter(m => m.status !== "complete")
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));
  const completedRepairs = repairs.filter(m => m.status === "complete")
    .sort((a, b) => (b.completionDate ?? b.dateCompleted ?? "").localeCompare(a.completionDate ?? a.dateCompleted ?? ""));
  const pendingCost = openRepairs.reduce((s, m) => s + (m.balance ?? 0), 0);

  const monthKey = new Date().toISOString().slice(0, 7);
  const completedThisMonth = completedRepairs.filter(
    m => (m.completionDate ?? m.dateCompleted ?? "").slice(0, 7) === monthKey,
  );
  const completedThisMonthCost = completedThisMonth.reduce((s, m) => s + m.cost, 0);

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle={`${openRepairs.length} open repair${openRepairs.length === 1 ? "" : "s"} across the fleet`}
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
      <CreateRepairDialog open={repairOpen} onOpenChange={setRepairOpen} />

      {/* Dashboard summary */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Open repairs ({openRepairs.length})
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                {fmtMoney(pendingCost)} pending
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openRepairs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open repairs. Fleet is in good shape.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {openRepairs.slice(0, 3).map(m => {
                  const v = vehicleById(m.vehicleId);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</span>
                      <span className="truncate text-muted-foreground">{m.issueDescription || m.serviceType}</span>
                    </li>
                  );
                })}
                {openRepairs.length > 3 && (
                  <li className="text-xs text-muted-foreground">…{openRepairs.length - 3} more</li>
                )}
              </ul>
            )}
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setTab("repairs")}>
              Go to Repairs tab
            </Button>
          </CardContent>
        </Card>

        <Card className="border-green-600/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-green-600" />
                Completed this month ({completedThisMonth.length})
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                {fmtMoney(completedThisMonthCost)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {completedThisMonth.length === 0 ? (
              <p className="text-sm text-muted-foreground">No repairs completed this month yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {completedThisMonth.slice(0, 3).map(m => {
                  const v = vehicleById(m.vehicleId);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</span>
                      <span className="truncate text-muted-foreground">{m.selectedSolution?.name ?? m.serviceType}</span>
                    </li>
                  );
                })}
                {completedThisMonth.length > 3 && (
                  <li className="text-xs text-muted-foreground">…{completedThisMonth.length - 3} more</li>
                )}
              </ul>
            )}
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setTab("completed")}>
              Go to Completed tab
            </Button>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="scheduled">Scheduled ({serviceLog.length + openIssues.length})</TabsTrigger>
          <TabsTrigger value="repairs">Repairs ({repairs.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completedRepairs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="scheduled" className="mt-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Open issues ({openIssues.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {openIssues.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No open maintenance issues. The fleet is in good shape.
            </div>
          ) : openIssues.map(m => {
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

        <TabsContent value="repairs" className="mt-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Track repairs from open issue to fully-paid completion.</p>
            <Button size="sm" onClick={() => setRepairOpen(true)}>+ New Repair</Button>
          </div>
          <RepairsBoard />
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4 text-green-600" />
                Completed repairs ({completedRepairs.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {completedRepairs.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No completed repairs yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Vehicle</th>
                        <th className="px-4 py-2 font-medium">Repair</th>
                        <th className="px-4 py-2 text-right font-medium">Cost</th>
                        <th className="px-4 py-2 font-medium">Completed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {completedRepairs.map(m => {
                        const v = vehicleById(m.vehicleId);
                        return (
                          <tr key={m.id} className="hover:bg-muted/40">
                            <td className="px-4 py-2">
                              <div className="font-medium">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</div>
                              <div className="text-xs text-muted-foreground">Tag #{v?.plate ?? "—"}</div>
                            </td>
                            <td className="px-4 py-2">{m.selectedSolution?.name ?? m.serviceType}</td>
                            <td className="px-4 py-2 text-right font-medium">{fmtMoney(m.cost)}</td>
                            <td className="px-4 py-2">{fmtDate((m.completionDate ?? m.dateCompleted)?.slice(0, 10))}</td>
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


