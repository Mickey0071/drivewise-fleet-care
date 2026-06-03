import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maintenance, vehicles, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { Wrench, AlertTriangle, CalendarClock, Settings2, ChevronDown, ShieldAlert } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";
import { CreateRepairDialog } from "@/components/app/CreateRepairDialog";
import { RepairsBoard } from "@/components/app/RepairsBoard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useStoreVersion, markScheduledComplete, pendingRunnerRepairs, approveRunnerRepair, rejectRunnerRepair } from "@/lib/mock/store";
import { supabase } from "@/integrations/supabase/client";
import {
  dueSoonScheduledItems,
  computeScheduledItems,
  scheduledRemainingLabel,
  isScheduleConfigured,
  type ScheduledItem,
} from "@/lib/maintenance-utils";

export const Route = createFileRoute("/maintenance")({
  head: () => ({ meta: [{ title: "Maintenance — Camauto Rentals" }] }),
  component: MaintenancePage,
});

function MaintenancePage() {
  useStoreVersion();
  const navigate = useNavigate();
  const [repairOpen, setRepairOpen] = useState(false);
  const [tab, setTab] = useState("scheduled");
  const [configOpen, setConfigOpen] = useState(false);

  // Repairs (kanban-tracked)
  const repairs = maintenance.filter(m => !!m.status && m.approvalStatus !== "pending" && m.approvalStatus !== "rejected");
  const openRepairs = repairs.filter(m => m.status !== "complete")
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));
  const completedRepairs = repairs.filter(m => m.status === "complete")
    .sort((a, b) => (b.completionDate ?? b.dateCompleted ?? "").localeCompare(a.completionDate ?? a.dateCompleted ?? ""));
  const pendingCost = openRepairs.reduce((s, m) => s + (m.balance ?? 0), 0);

  const monthKey = new Date().toISOString().slice(0, 7);
  const completedThisMonth = completedRepairs.filter(
    m => (m.completionDate ?? m.dateCompleted ?? "").slice(0, 7) === monthKey,
  );

  // Scheduled maintenance (derived from per-vehicle Alert Settings)
  const dueSoon = dueSoonScheduledItems(vehicles);
  const allScheduled = vehicles.flatMap(v => computeScheduledItems(v));
  const configuredCount = vehicles.filter(isScheduleConfigured).length;

  // Pending runner repair requests (awaiting admin approval)
  const pending = pendingRunnerRepairs();
  const [runnerNames, setRunnerNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = Array.from(new Set(pending.map(p => p.runnerId).filter(Boolean))) as string[];
    const missing = ids.filter(id => !(id in runnerNames));
    if (missing.length === 0) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, first_name").in("id", missing);
      if (!data) return;
      setRunnerNames(prev => {
        const next = { ...prev };
        for (const r of data as any[]) next[r.id] = r.full_name || r.first_name || "Runner";
        return next;
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.map(p => p.runnerId).join(",")]);

  async function handleApprove(id: string) {
    await approveRunnerRepair(id);
    toast.success("Repair approved — moved to Open repairs");
  }
  function handleReject(id: string) {
    rejectRunnerRepair(id);
    toast.success("Repair request rejected");
  }

  async function handleMarkComplete(it: ScheduledItem) {
    try {
      await markScheduledComplete(it.vehicleId, it.type, it.customId);
      const v = vehicleById(it.vehicleId);
      toast.success(`${it.label} cleared for ${v ? `${v.year} ${v.make} ${v.model}` : it.vehicleId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  }

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
          </div>
        }
      />
      <CreateRepairDialog open={repairOpen} onOpenChange={setRepairOpen} />

      {/* Configuration section */}
      <Collapsible open={configOpen} onOpenChange={setConfigOpen} className="mb-4">
        <Card>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between p-4 text-left">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                Configure Scheduled Repairs Alerts
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {configuredCount}/{vehicles.length} vehicles configured
                <ChevronDown className={`h-4 w-4 transition-transform ${configOpen ? "rotate-180" : ""}`} />
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border p-4 text-sm text-muted-foreground">
              <p>
                Alert intervals (oil, battery, alternator, inspection) are set per vehicle in Fleet.
                Due dates are auto-calculated from each vehicle's current mileage and last-service dates.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => navigate({ to: "/fleet" })}>
                Edit Alert Settings
              </Button>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Pending runner repairs alert */}
      <Card className={`mb-6 ${pending.length > 0 ? "border-amber-500/50 bg-amber-500/5" : ""}`}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className={`h-4 w-4 ${pending.length > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
            {pending.length > 0
              ? `⚠️ Pending runner repairs — ${pending.length} awaiting approval`
              : "No repairs awaiting approval"}
          </CardTitle>
        </CardHeader>
        {pending.length > 0 && (
          <CardContent className="space-y-3 p-0">
            <ul className="divide-y divide-border">
              {pending.map(m => {
                const v = vehicleById(m.vehicleId);
                return (
                  <li key={m.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</div>
                      <div className="text-sm text-muted-foreground">{m.issueDescription || m.serviceType}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {(m.runnerId && runnerNames[m.runnerId]) || "Runner"}
                        {" · "}
                        {fmtDate((m.createdAt ?? "").slice(0, 10))}
                        {m.cost > 0 ? ` · Est. ${fmtMoney(m.cost)}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/fleet/$vehicleId" params={{ vehicleId: m.vehicleId }}>View</Link>
                      </Button>
                      <Button size="sm" onClick={() => handleApprove(m.id)}>Approve</Button>
                      <Button size="sm" variant="destructive" onClick={() => handleReject(m.id)}>Reject</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        )}
      </Card>

      {/* Dashboard summary — 3 cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* CARD 1: Scheduled repairs due soon */}
        <Card className="border-amber-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-amber-500" />
                Scheduled ({dueSoon.length})
              </span>
              <span className="text-xs font-normal text-muted-foreground">due soon</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dueSoon.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing due within 7 days or 100 miles.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {dueSoon.slice(0, 3).map(it => {
                  const v = vehicleById(it.vehicleId);
                  return (
                    <li key={it.key} className="flex items-center justify-between gap-2">
                      <span className="truncate">{v ? `${v.year} ${v.make} ${v.model}` : it.vehicleId}</span>
                      <span className={`shrink-0 text-xs ${it.status === "overdue" ? "text-destructive" : "text-muted-foreground"}`}>
                        {it.label} · {scheduledRemainingLabel(it)}
                      </span>
                    </li>
                  );
                })}
                {dueSoon.length > 3 && (
                  <li className="text-xs text-muted-foreground">…{dueSoon.length - 3} more</li>
                )}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setTab("scheduled")}>Scheduled tab</Button>
              <Button size="sm" variant="ghost" onClick={() => navigate({ to: "/fleet" })}>Configure</Button>
            </div>
          </CardContent>
        </Card>

        {/* CARD 2: Open repairs */}
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
                {openRepairs.slice(0, 2).map(m => {
                  const v = vehicleById(m.vehicleId);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</span>
                      <span className="truncate text-muted-foreground">{m.issueDescription || m.serviceType}</span>
                    </li>
                  );
                })}
                {openRepairs.length > 2 && (
                  <li className="text-xs text-muted-foreground">…{openRepairs.length - 2} more</li>
                )}
              </ul>
            )}
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setTab("repairs")}>
              Go to Repairs tab
            </Button>
          </CardContent>
        </Card>

        {/* CARD 3: Completed (recent) */}
        <Card className="border-green-600/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-green-600" />
                Completed ({completedRepairs.length})
              </span>
              <span className="text-xs font-normal text-muted-foreground">recent</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {completedRepairs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completed repairs yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {completedRepairs.slice(0, 3).map(m => {
                  const v = vehicleById(m.vehicleId);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fmtMoney(m.cost)} · {fmtDate((m.completionDate ?? m.dateCompleted)?.slice(0, 10))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setTab("completed")}>
              View all completed repairs →
            </Button>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="scheduled">Scheduled ({dueSoon.length})</TabsTrigger>
          <TabsTrigger value="repairs">Repairs ({repairs.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completedRepairs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="scheduled" className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Due soon */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="h-4 w-4 text-amber-500" />
                  Due soon ({dueSoon.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {dueSoon.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">Nothing due within 7 days or 100 miles.</div>
                ) : (
                  <ul className="divide-y divide-border">
                    {dueSoon.map(it => {
                      const v = vehicleById(it.vehicleId);
                      return (
                        <li key={it.key} className="flex items-center justify-between gap-2 px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{v ? `${v.year} ${v.make} ${v.model}` : it.vehicleId}</div>
                            <div className={`text-xs ${it.status === "overdue" ? "text-destructive" : "text-muted-foreground"}`}>
                              {it.label} · {scheduledRemainingLabel(it)}
                              {it.dueDate ? ` · due ${fmtDate(it.dueDate)}` : it.dueMileage ? ` · at ${it.dueMileage.toLocaleString()} mi` : ""}
                            </div>
                          </div>
                          <Button size="sm" variant="outline" className="shrink-0" onClick={() => handleMarkComplete(it)}>
                            Mark Complete
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Upcoming (not yet due) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  Upcoming
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {allScheduled.filter(it => it.status === "upcoming").length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">No upcoming scheduled maintenance.</div>
                ) : (
                  <ul className="divide-y divide-border">
                    {allScheduled.filter(it => it.status === "upcoming").map(it => {
                      const v = vehicleById(it.vehicleId);
                      return (
                        <li key={it.key} className="flex items-center justify-between gap-2 px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{v ? `${v.year} ${v.make} ${v.model}` : it.vehicleId}</div>
                            <div className="text-xs text-muted-foreground">
                              {it.label} · {scheduledRemainingLabel(it)}
                              {it.dueDate ? ` · due ${fmtDate(it.dueDate)}` : it.dueMileage ? ` · at ${it.dueMileage.toLocaleString()} mi` : ""}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
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
    </div>
  );
}
