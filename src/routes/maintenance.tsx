import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maintenance, vehicles, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { Wrench, AlertTriangle, CalendarClock, Settings2, ChevronDown, ShieldAlert } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";

import { CompletedRepairDetailDialog } from "@/components/app/CompletedRepairDetailDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useStoreVersion, markScheduledComplete, pendingRunnerRepairs, approveRunnerRepair, rejectRunnerRepair } from "@/lib/mock/store";
import { createRepairTicket, processRepairDeposit, completeRepair } from "@/lib/mock/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  dueSoonScheduledItems,
  computeScheduledItems,
  scheduledRemainingLabel,
  isScheduleConfigured,
  type ScheduledItem,
} from "@/lib/maintenance-utils";
import type { Maintenance } from "@/lib/mock/data";

export const Route = createFileRoute("/maintenance")({
  head: () => ({ meta: [{ title: "Maintenance — Camauto Rentals" }] }),
  component: MaintenancePage,
});

function MaintenancePage() {
  useStoreVersion();
  const navigate = useNavigate();
  const [tab, setTab] = useState("scheduled");
  const [configOpen, setConfigOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<Maintenance | null>(null);
  const [ticketRecord, setTicketRecord] = useState<Maintenance | null>(null);
  const [ticketParts, setTicketParts] = useState("");
  const [ticketLabour, setTicketLabour] = useState("");

  function openTicketForm(m: Maintenance) {
    setTicketRecord(m);
    setTicketParts(m.partsCost ? String(m.partsCost) : "");
    setTicketLabour(m.laborCost ? String(m.laborCost) : "");
  }

  function submitTicket() {
    if (!ticketRecord) return;
    const parts = parseFloat(ticketParts);
    const labour = parseFloat(ticketLabour);
    if (!(parts > 0) || !(labour > 0)) {
      toast.error("Enter both parts and labour costs");
      return;
    }
    createRepairTicket(ticketRecord.id, parts, labour);
    setTicketRecord(null);
    toast.success("Repair ticket created — moved to Pending Deposit");
  }

  // Pending Deposit: per-record editable deposit amounts
  const [depositInputs, setDepositInputs] = useState<Record<string, string>>({});
  const depositValue = (m: Maintenance) => {
    const fallback = (m.depositAmount ?? m.depositRequired ?? (m.cost ?? 0) * 0.5);
    return depositInputs[m.id] ?? String(Math.round(fallback * 100) / 100);
  };

  function handleProcessDeposit(m: Maintenance) {
    const amt = parseFloat(depositValue(m));
    if (!(amt > 0)) { toast.error("Enter a deposit amount"); return; }
    processRepairDeposit(m.id, amt);
    toast.success(`Deposit of ${fmtMoney(amt)} processed`);
  }

  // Completion summary dialog
  const [completeRecord, setCompleteRecord] = useState<Maintenance | null>(null);
  const [mechanicName, setMechanicName] = useState("");
  const [completionSummary, setCompletionSummary] = useState<RepairCompletionSummary | null>(null);
  const [adminName, setAdminName] = useState("Admin");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      const { data: prof } = await supabase
        .from("profiles").select("full_name, first_name").eq("id", uid).maybeSingle();
      setAdminName(prof?.full_name || prof?.first_name || data.user?.email || "Admin");
    })();
  }, []);

  function handleCompleteRepair(m: Maintenance) {
    const amtStr = depositInputs[m.id];
    if (amtStr != null && parseFloat(amtStr) > 0 && !m.depositProcessed) {
      processRepairDeposit(m.id, parseFloat(amtStr));
    }
    setMechanicName(m.mechanicName ?? "");
    setCompletionSummary(null);
    setCompleteRecord(m);
  }

  function confirmCompleteRepair() {
    if (!completeRecord) return;
    const summary = completeRepair(completeRecord.id, {
      completedBy: adminName,
      mechanicName: mechanicName.trim() || undefined,
    });
    if (summary) {
      setCompletionSummary(summary);
      toast.success(`Repair completed — ${fmtMoney(summary.total)} posted to P&L`);
    }
  }

  // Repairs (kanban-tracked)
  const repairs = maintenance.filter(m => !!m.status && m.approvalStatus !== "pending" && m.approvalStatus !== "rejected");
  const openRepairs = repairs.filter(m => m.status !== "complete" && m.status !== "reported")
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));
  const completedRepairs = repairs.filter(m => m.status === "complete")
    .sort((a, b) => (b.completionDate ?? b.dateCompleted ?? "").localeCompare(a.completionDate ?? a.dateCompleted ?? ""));
  const pendingCost = openRepairs.reduce((s, m) => s + (m.balance ?? 0), 0);

  // Open repairs from inspection failures (reported, awaiting ticket creation)
  const reportedInspectionRepairs = maintenance
    .filter(m => m.status === "reported" && m.source === "inspection_fail")
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));

  // Repairs awaiting deposit (ticket created, pre-completion)
  const pendingDepositRepairs = maintenance
    .filter(m => m.status === "pending_deposit")
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));

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
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setTab("completed")}>
              View completed repairs
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
                      <div className="min-w-0">
                        <div className="truncate">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.issueDescription || m.serviceType} · {fmtMoney(m.cost)} · {fmtDate((m.completionDate ?? m.dateCompleted)?.slice(0, 10))}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => setDetailRecord(m)}>
                        View Details
                      </Button>
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
          <TabsTrigger value="repairs">Repairs ({reportedInspectionRepairs.length})</TabsTrigger>
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
          {reportedInspectionRepairs.length === 0 && pendingDepositRepairs.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No open repairs.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
            {reportedInspectionRepairs.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {reportedInspectionRepairs.map(m => {
                const v = vehicleById(m.vehicleId);
                return (
                  <Card key={m.id}>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center justify-between text-base">
                        <span className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                          Open Repair ({reportedInspectionRepairs.length})
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">From inspection</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="text-sm font-medium">
                        {v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Issue:</span>{" "}
                        {m.serviceType}
                      </div>
                      {m.repairRequestNotes && (
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">Symptoms:</span>{" "}
                          {m.repairRequestNotes}
                        </div>
                      )}
                      {(m.partsCost || m.laborCost) && (
                        <div className="flex gap-4 text-sm text-muted-foreground">
                          {m.partsCost ? <span>Est. Parts: {fmtMoney(m.partsCost)}</span> : null}
                          {m.laborCost ? <span>Est. Labour: {fmtMoney(m.laborCost)}</span> : null}
                        </div>
                      )}
                      <Button
                        size="sm"
                        className="mt-2"
                        onClick={() => openTicketForm(m)}
                      >
                        Send to Create Ticket
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            )}

            {pendingDepositRepairs.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Pending Deposit ({pendingDepositRepairs.length})
                </h3>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {pendingDepositRepairs.map(m => {
                    const v = vehicleById(m.vehicleId);
                    const total = m.cost ?? 0;
                    const required = m.depositRequired ?? total * 0.5;
                    return (
                      <Card key={m.id}>
                        <CardHeader className="pb-3">
                          <CardTitle className="flex items-center justify-between text-base">
                            <span className="flex items-center gap-2">
                              <Wrench className="h-4 w-4 text-blue-500" />
                              Pending Deposit
                            </span>
                            {m.depositProcessed && (
                              <span className="text-xs font-normal text-green-600">Deposit received</span>
                            )}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="text-sm font-medium">
                            {v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">Issue:</span> {m.serviceType}
                          </div>
                          <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
                            <div className="flex justify-between"><span>Parts</span><span>{fmtMoney(m.partsCost ?? 0)}</span></div>
                            <div className="flex justify-between"><span>Labour</span><span>{fmtMoney(m.laborCost ?? 0)}</span></div>
                            <div className="flex justify-between border-t border-border pt-1 font-medium"><span>Total</span><span>{fmtMoney(total)}</span></div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Deposit required (50%): <span className="font-medium text-foreground">{fmtMoney(required)}</span>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`dep-${m.id}`}>Deposit amount ($)</Label>
                            <Input
                              id={`dep-${m.id}`}
                              type="number" min="0" step="0.01"
                              value={depositValue(m)}
                              onChange={(e) => setDepositInputs(prev => ({ ...prev, [m.id]: e.target.value }))}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleProcessDeposit(m)}>
                              Process Deposit
                            </Button>
                            <Button size="sm" onClick={() => handleCompleteRepair(m)}>
                              Complete Repair
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
            </div>
          )}
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
                        <th className="px-4 py-2 font-medium">Mechanic</th>
                        <th className="px-4 py-2 text-right font-medium">Cost</th>
                        <th className="px-4 py-2 font-medium">Completed</th>
                        <th className="px-4 py-2 text-right font-medium">Details</th>
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
                            <td className="px-4 py-2">{m.completedBy || m.vendor || "—"}</td>
                            <td className="px-4 py-2 text-right font-medium">{fmtMoney(m.cost)}</td>
                            <td className="px-4 py-2">{fmtDate((m.completionDate ?? m.dateCompleted)?.slice(0, 10))}</td>
                            <td className="px-4 py-2 text-right">
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setDetailRecord(m)}>
                                View Details
                              </Button>
                            </td>
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

      <CompletedRepairDetailDialog
        record={detailRecord}
        open={!!detailRecord}
        onOpenChange={(v) => { if (!v) setDetailRecord(null); }}
      />

      <Dialog open={!!ticketRecord} onOpenChange={(o) => { if (!o) setTicketRecord(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Repair Ticket</DialogTitle>
          </DialogHeader>
          {ticketRecord && (() => {
            const v = vehicleById(ticketRecord.vehicleId);
            const parts = parseFloat(ticketParts) || 0;
            const labour = parseFloat(ticketLabour) || 0;
            const total = parts + labour;
            return (
              <div className="space-y-4">
                <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
                  <div><span className="font-medium">Vehicle:</span> {v ? `${v.year} ${v.make} ${v.model}` : ticketRecord.vehicleId}</div>
                  <div><span className="font-medium">Issue:</span> {ticketRecord.serviceType}</div>
                  {ticketRecord.repairRequestNotes && (
                    <div><span className="font-medium">Symptoms:</span> {ticketRecord.repairRequestNotes}</div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ticket-parts">Parts Cost ($)</Label>
                  <Input id="ticket-parts" type="number" min="0" step="0.01" value={ticketParts}
                    onChange={(e) => setTicketParts(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ticket-labour">Labour Cost ($)</Label>
                  <Input id="ticket-labour" type="number" min="0" step="0.01" value={ticketLabour}
                    onChange={(e) => setTicketLabour(e.target.value)} placeholder="0.00" />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm font-medium">
                  <span>Total Cost</span>
                  <span>{fmtMoney(total)}</span>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTicketRecord(null)}>Cancel</Button>
            <Button onClick={submitTicket}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
