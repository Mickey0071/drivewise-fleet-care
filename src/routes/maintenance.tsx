import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maintenance, vehicles, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { Wrench, CalendarClock, Settings2, CheckCircle2, Plus, Flame } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";

import { CompletedRepairDetailDialog } from "@/components/app/CompletedRepairDetailDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useStoreVersion, markScheduledComplete } from "@/lib/mock/store";
import { createManualRepair, moveRepairToDiagnose, saveRepairDiagnosis, recordRepairPaymentRaw, completeRepair } from "@/lib/mock/store";
import type { RepairCompletionSummary } from "@/lib/mock/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  const [detailRecord, setDetailRecord] = useState<Maintenance | null>(null);

  // --- [+ Create Repair] (Phase 1) form ---
  const [createOpen, setCreateOpen] = useState(false);
  const [createVehicleId, setCreateVehicleId] = useState("");
  const [createIssue, setCreateIssue] = useState("");
  const [createTakeOffRental, setCreateTakeOffRental] = useState(true);

  // Which repair line is expanded (one at a time, across all phases)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpand = (id: string) => setExpandedId(prev => (prev === id ? null : id));

  function submitCreateRepair() {
    if (!createVehicleId) { toast.error("Select a vehicle"); return; }
    if (!createIssue.trim()) { toast.error("Describe the issue"); return; }
    createManualRepair(createVehicleId, createIssue, createTakeOffRental);
    setCreateOpen(false);
    setCreateVehicleId("");
    setCreateIssue("");
    setCreateTakeOffRental(true);
    toast.success("Repair created — added to Phase 1");
  }

  // --- Phase 2 (Diagnose) per-record inputs ---
  const [diagInputs, setDiagInputs] = useState<Record<string, { partsNeeded: string; partsCost: string; laborCost: string }>>({});
  const diagFor = (m: Maintenance) =>
    diagInputs[m.id] ?? {
      partsNeeded: m.diagnosisNotes ?? "",
      partsCost: m.partsCost ? String(m.partsCost) : "",
      laborCost: m.laborCost ? String(m.laborCost) : "",
    };
  const setDiag = (id: string, patch: Partial<{ partsNeeded: string; partsCost: string; laborCost: string }>) =>
    setDiagInputs(prev => ({ ...prev, [id]: { ...diagFor(maintenance.find(x => x.id === id)!), ...prev[id], ...patch } }));

  function handleSaveDiagnosis(m: Maintenance) {
    const d = diagFor(m);
    const parts = parseFloat(d.partsCost) || 0;
    const labour = parseFloat(d.laborCost) || 0;
    if (!d.partsNeeded.trim() || (!(parts > 0) && !(labour > 0))) {
      toast.error("Complete parts info to save");
      return;
    }
    saveRepairDiagnosis(m.id, { partsNeeded: d.partsNeeded, partsCost: parts, laborCost: labour });
    toast.success("Diagnosis saved — moved to Complete");
  }

  // --- Phase 3 (Complete) payment inputs ---
  const [payInputs, setPayInputs] = useState<Record<string, string>>({});
  const [payOpenId, setPayOpenId] = useState<string | null>(null);

  function handleProcessPayment(m: Maintenance) {
    const amt = parseFloat(payInputs[m.id] ?? "");
    if (!(amt > 0)) { toast.error("Enter a payment amount"); return; }
    recordRepairPaymentRaw(m.id, amt);
    setPayInputs(prev => ({ ...prev, [m.id]: "" }));
    setPayOpenId(null);
    toast.success(`Payment of ${fmtMoney(amt)} recorded`);
  }

  // Completion summary dialog
  const [completeRecord, setCompleteRecord] = useState<Maintenance | null>(null);
  const [mechanicName, setMechanicName] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
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
    setMechanicName(m.mechanicName ?? "");
    setCompletionNotes("");
    setCompletionSummary(null);
    setCompleteRecord(m);
  }

  function confirmCompleteRepair() {
    if (!completeRecord) return;
    const summary = completeRepair(completeRecord.id, {
      completedBy: adminName,
      mechanicName: mechanicName.trim() || undefined,
      mechanicNotes: completionNotes.trim() || undefined,
    });
    if (summary) {
      setCompletionSummary(summary);
      toast.success(`Repair completed — ${fmtMoney(summary.total)} posted to P&L`);
    }
  }

  // Repairs (kanban-tracked)
  const repairs = maintenance.filter(m => !!m.status && m.approvalStatus !== "pending" && m.approvalStatus !== "rejected");
  const completedRepairs = repairs.filter(m => m.status === "complete")
    .sort((a, b) => (b.completionDate ?? b.dateCompleted ?? "").localeCompare(a.completionDate ?? a.dateCompleted ?? ""));

  const byNewest = (a: Maintenance, b: Maintenance) =>
    (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id);

  // --- 3-phase active repairs ---
  const phase1 = maintenance.filter(m => m.status === "reported").sort(byNewest);
  const phase2 = maintenance.filter(m => m.status === "diagnosing").sort(byNewest);
  const phase3 = maintenance.filter(m => m.status === "pending_complete").sort(byNewest);
  const activeCount = phase1.length + phase2.length + phase3.length;

  const monthKey = new Date().toISOString().slice(0, 7);
  const completedThisMonth = completedRepairs.filter(
    m => (m.completionDate ?? m.dateCompleted ?? "").slice(0, 7) === monthKey,
  );
  const completedThisMonthTotal = completedThisMonth.reduce((s, m) => s + (m.cost ?? 0), 0);

  // Scheduled maintenance (derived from per-vehicle Alert Settings)
  const dueSoon = dueSoonScheduledItems(vehicles);
  const allScheduled = vehicles.flatMap(v => computeScheduledItems(v));
  const configuredCount = vehicles.filter(isScheduleConfigured).length;

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
        subtitle={`${activeCount} active repair${activeCount === 1 ? "" : "s"} · Daily 8AM SMS until complete`}
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
            <Button
              className="bg-amber-500 text-white hover:bg-amber-600"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="mr-1 h-4 w-4" /> Create Repair
            </Button>
          </div>
        }
      />

      {/* ===================== ACTIVE REPAIRS (TOP) ===================== */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Flame className="h-5 w-5 text-amber-500" />
          Active Repairs ({activeCount})
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Phase 1 — State Issue */}
          <Card className="border-yellow-500/40">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-yellow-600">
                  <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
                  Phase 1 · State Issue
                </span>
                <span className="text-xs font-normal text-muted-foreground">{phase1.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-3 pt-0">
              {phase1.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Nothing here.</p>
              ) : phase1.map(m => {
                const v = vehicleById(m.vehicleId);
                const fromInspection = (m.source ?? "").includes("inspection");
                return (
                  <div key={m.id} className="rounded-md border border-l-[3px] border-l-yellow-500 border-border p-3">
                    <div className="text-sm font-medium">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{m.issueDescription ?? m.serviceType}</div>
                    {m.repairRequestNotes && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Symptoms:</span> {m.repairRequestNotes}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <Badge variant="secondary" className="text-[10px]">
                        {fromInspection ? "From inspection" : "Manual"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{fmtDate((m.createdAt ?? "").slice(0, 10))}</span>
                    </div>
                    <Button size="sm" className="mt-2 w-full" onClick={() => moveRepairToDiagnose(m.id)}>
                      Move to Diagnose →
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Phase 2 — Diagnose */}
          <Card className="border-blue-500/40">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-blue-600">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                  Phase 2 · Diagnose
                </span>
                <span className="text-xs font-normal text-muted-foreground">{phase2.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-3 pt-0">
              {phase2.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Nothing here.</p>
              ) : phase2.map(m => {
                const v = vehicleById(m.vehicleId);
                const d = diagFor(m);
                const parts = parseFloat(d.partsCost) || 0;
                const labour = parseFloat(d.laborCost) || 0;
                const total = parts + labour;
                return (
                  <div key={m.id} className="rounded-md border border-l-[3px] border-l-blue-500 border-border p-3">
                    <div className="text-sm font-medium">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{m.issueDescription ?? m.serviceType}</div>
                    <div className="mt-2 space-y-2">
                      <div>
                        <Label className="text-[11px]">Parts needed</Label>
                        <Textarea
                          className="mt-1 min-h-[52px] text-xs"
                          placeholder="e.g. Front brake pads, rotors"
                          value={d.partsNeeded}
                          onChange={(e) => setDiag(m.id, { partsNeeded: e.target.value })}
                        />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Label className="text-[11px]">Parts $</Label>
                          <Input className="mt-1 h-8" type="number" min="0" step="0.01"
                            value={d.partsCost} onChange={(e) => setDiag(m.id, { partsCost: e.target.value })} />
                        </div>
                        <div className="flex-1">
                          <Label className="text-[11px]">Labour $</Label>
                          <Input className="mt-1 h-8" type="number" min="0" step="0.01"
                            value={d.laborCost} onChange={(e) => setDiag(m.id, { laborCost: e.target.value })} />
                        </div>
                      </div>
                      <div className="flex justify-between rounded bg-muted/40 px-2 py-1 text-xs font-medium">
                        <span>Total</span><span>{fmtMoney(total)}</span>
                      </div>
                    </div>
                    <Button size="sm" className="mt-2 w-full" onClick={() => handleSaveDiagnosis(m)}>
                      Save Diagnosis →
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Phase 3 — Complete */}
          <Card className="border-green-600/40">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-green-600">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  Phase 3 · Complete
                </span>
                <span className="text-xs font-normal text-muted-foreground">{phase3.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-3 pt-0">
              {phase3.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Nothing here.</p>
              ) : phase3.map(m => {
                const v = vehicleById(m.vehicleId);
                const total = m.cost ?? 0;
                const paid = m.amountPaid ?? 0;
                const balance = Math.max(0, total - paid);
                return (
                  <div key={m.id} className="rounded-md border border-l-[3px] border-l-green-600 border-border p-3">
                    <div className="text-sm font-medium">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{m.issueDescription ?? m.serviceType}</div>
                    {m.diagnosisNotes && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Parts used:</span> {m.diagnosisNotes}
                      </div>
                    )}
                    <div className="mt-2 space-y-0.5 rounded bg-muted/40 p-2 text-xs">
                      <div className="flex justify-between"><span>Total</span><span>{fmtMoney(total)}</span></div>
                      <div className="flex justify-between"><span>Paid</span><span>{fmtMoney(paid)}</span></div>
                      <div className="flex justify-between border-t border-border pt-0.5 font-medium"><span>Balance</span><span>{fmtMoney(balance)}</span></div>
                    </div>
                    {payOpenId === m.id ? (
                      <div className="mt-2 flex gap-2">
                        <Input className="h-8" type="number" min="0" step="0.01" placeholder="Amount"
                          value={payInputs[m.id] ?? ""} onChange={(e) => setPayInputs(prev => ({ ...prev, [m.id]: e.target.value }))} />
                        <Button size="sm" onClick={() => handleProcessPayment(m)}>Submit</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setPayOpenId(m.id)}>
                        + Process Payment
                      </Button>
                    )}
                    <Button size="sm" className="mt-2 w-full" disabled={balance > 0} onClick={() => handleCompleteRepair(m)}>
                      Complete Repair
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ===================== COMPLETED (MIDDLE) ===================== */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Completed (3 recent)
          </h2>
          <span className="text-sm text-muted-foreground">
            {fmtMoney(completedThisMonthTotal)} this month
          </span>
        </div>
        <Card>
          <CardContent className="p-0">
            {completedRepairs.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No completed repairs yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {completedRepairs.slice(0, 3).map(m => {
                  const v = vehicleById(m.vehicleId);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.selectedSolution?.name ?? m.serviceType} · {fmtDate((m.completionDate ?? m.dateCompleted)?.slice(0, 10))}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-medium">{fmtMoney(m.cost)}</span>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDetailRecord(m)}>
                          Details
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <button
          className="mt-2 text-sm text-primary hover:underline"
          onClick={() => { setTab("completed"); document.getElementById("scheduled-section")?.scrollIntoView({ behavior: "smooth" }); }}
        >
          View all completed repairs →
        </button>
      </section>

      {/* ===================== SCHEDULED MAINTENANCE (BOTTOM) ===================== */}
      <section id="scheduled-section" className="mb-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
          Scheduled Maintenance
        </h2>
        <Card className="mb-4">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium">{configuredCount}/{vehicles.length} vehicles configured</div>
              <div className="text-sm text-muted-foreground">
                {dueSoon.length === 0
                  ? "Nothing due within 7 days or 100 miles."
                  : `${dueSoon.length} item${dueSoon.length === 1 ? "" : "s"} due within 7 days or 100 miles.`}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate({ to: "/fleet" })}>Configure Alerts</Button>
              <Button size="sm" onClick={() => setTab("scheduled")}>View Scheduled Tab</Button>
            </div>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="scheduled">Scheduled ({dueSoon.length})</TabsTrigger>
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
      </section>

      <CompletedRepairDetailDialog
        record={detailRecord}
        open={!!detailRecord}
        onOpenChange={(v) => { if (!v) setDetailRecord(null); }}
      />

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) { setCreateVehicleId(""); setCreateIssue(""); setCreateTakeOffRental(true); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Repair</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Vehicle</Label>
              <Select value={createVehicleId} onValueChange={setCreateVehicleId}>
                <SelectTrigger><SelectValue placeholder="Select a vehicle" /></SelectTrigger>
                <SelectContent>
                  {vehicles.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.year} {v.make} {v.model} · {v.plate}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-issue">Issue</Label>
              <Input id="create-issue" value={createIssue} maxLength={200}
                onChange={(e) => setCreateIssue(e.target.value)} placeholder="What's wrong?" />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="take-off-rental">Take off rental availability?</Label>
                <p className="text-xs text-muted-foreground">
                  {createTakeOffRental ? "Vehicle will be blocked from new rentals." : "Vehicle stays bookable while in repair."}
                </p>
              </div>
              <Switch id="take-off-rental" checked={createTakeOffRental} onCheckedChange={setCreateTakeOffRental} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreateRepair}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!completeRecord} onOpenChange={(o) => { if (!o) { setCompleteRecord(null); setCompletionSummary(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{completionSummary ? "Repair Completed" : "Complete Repair"}</DialogTitle>
          </DialogHeader>
          {completeRecord && (() => {
            const m = completeRecord;
            const v = vehicleById(m.vehicleId);
            const parts = m.partsCost ?? 0;
            const labour = m.laborCost ?? 0;
            const total = parts + labour;
            const today = new Date().toISOString().slice(0, 10);
            return (
              <div className="space-y-4">
                <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
                  <div><span className="font-medium">Vehicle:</span> {v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId}</div>
                  <div><span className="font-medium">Issue:</span> {m.serviceType}</div>
                  <div className="flex items-center gap-1 font-medium text-green-600">
                    <CheckCircle2 className="h-4 w-4" /> Completed
                  </div>
                </div>
                <div className="space-y-1 rounded-md border border-border p-3 text-sm">
                  <div className="flex justify-between"><span>Parts</span><span>{fmtMoney(parts)}</span></div>
                  <div className="flex justify-between"><span>Labour</span><span>{fmtMoney(labour)}</span></div>
                  <div className="flex justify-between border-t border-border pt-1 font-medium"><span>Total</span><span>{fmtMoney(total)}</span></div>
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div><span className="font-medium text-foreground">Completion date:</span> {fmtDate(today)}</div>
                  <div><span className="font-medium text-foreground">Completed by:</span> {adminName}</div>
                </div>
                {!completionSummary ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="mechanic-name">Mechanic name (optional)</Label>
                      <Input id="mechanic-name" value={mechanicName}
                        onChange={(e) => setMechanicName(e.target.value)} placeholder="e.g. Joe's Auto" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="completion-notes">Completion notes (optional)</Label>
                      <Textarea id="completion-notes" value={completionNotes}
                        onChange={(e) => setCompletionNotes(e.target.value)} placeholder="Work performed, parts replaced…" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-md bg-green-500/10 p-3 text-sm">
                    {mechanicName.trim() && (
                      <div className="text-muted-foreground">
                        <span className="font-medium text-foreground">Mechanic:</span> {mechanicName.trim()}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" /> Logged to fleet card repair history</div>
                    <div className="flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" /> Posted to P&L expenses ({fmtMoney(completionSummary.expensePosted)})</div>
                    <div className="flex items-center gap-2 text-green-600"><CheckCircle2 className="h-4 w-4" /> Added to scorecard data</div>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            {!completionSummary ? (
              <>
                <Button variant="outline" onClick={() => setCompleteRecord(null)}>Cancel</Button>
                <Button onClick={confirmCompleteRepair}>Complete Repair</Button>
              </>
            ) : (
              <Button onClick={() => { setCompleteRecord(null); setCompletionSummary(null); }}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
