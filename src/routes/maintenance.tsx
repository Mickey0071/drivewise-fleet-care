import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maintenance, vehicles, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { Wrench, CalendarClock, Settings2, CheckCircle2, Plus, Flame, RotateCcw, Trash2, Car, ClipboardCheck } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";

import { CompletedRepairDetailDialog } from "@/components/app/CompletedRepairDetailDialog";
import { SendToMechanicDialog } from "@/components/app/SendToMechanicDialog";
import { ViewDiagnosisDialog } from "@/components/app/ViewDiagnosisDialog";
import { MechanicJobHistory } from "@/components/app/MechanicJobHistory";
import { RmCardDialog } from "@/components/app/RmCardDialog";
import { listRmCards, type RmCardRow } from "@/lib/rm-cards.functions";
import { RmPendingApprovals } from "@/components/app/RmPendingApprovals";
import { useServerFn } from "@tanstack/react-start";
import {
  listMechanicJobs,
  resendMechanicJob,
  cancelMechanicJob,
  type MechanicJobRow,
} from "@/lib/mechanic-jobs.functions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useStoreVersion, markScheduledComplete } from "@/lib/mock/store";
import { createManualRepair, moveRepairToDiagnose, saveRepairDiagnosis, recordRepairPaymentRaw, completeRepair, reverseRepairToDiagnose, deleteRepair } from "@/lib/mock/store";
import type { RepairCompletionSummary } from "@/lib/mock/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import {
  dueSoonScheduledItems,
  computeScheduledItems,
  scheduledRemainingLabel,
  isScheduleConfigured,
  type ScheduledItem,
} from "@/lib/maintenance-utils";
import type { Maintenance } from "@/lib/mock/data";
import { ProblemCategorySelect } from "@/components/app/ProblemCategorySelect";

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
  const [createCategory, setCreateCategory] = useState("");
  const [createTakeOffRental, setCreateTakeOffRental] = useState(true);

  // Which repair line is expanded (one at a time, across all phases)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpand = (id: string) => setExpandedId(prev => (prev === id ? null : id));

  // Which phase boxes are open (multiple allowed)
  const [openPhases, setOpenPhases] = useState<Record<string, boolean>>({});
  const togglePhase = (key: string) => setOpenPhases(prev => ({ ...prev, [key]: !prev[key] }));

  // Which scheduled vehicle groups are open (multiple allowed)
  const [openVehicles, setOpenVehicles] = useState<Record<string, boolean>>({});
  const toggleVehicle = (id: string) => setOpenVehicles(prev => ({ ...prev, [id]: !prev[id] }));

  // Delete-repair confirmation
  const [deleteRecord, setDeleteRecord] = useState<Maintenance | null>(null);
  function confirmDeleteRepair() {
    if (!deleteRecord) return;
    deleteRepair(deleteRecord.id);
    setDeleteRecord(null);
    toast.success("✓ Repair deleted — removed from P&L and history");
  }

  function submitCreateRepair() {
    if (!createVehicleId) { toast.error("Select a vehicle"); return; }
    if (!createIssue.trim()) { toast.error("Describe the issue"); return; }
    if (!createCategory) { toast.error("Select a problem category"); return; }
    createManualRepair(createVehicleId, createIssue, createTakeOffRental, createCategory);
    setCreateOpen(false);
    setCreateVehicleId("");
    setCreateIssue("");
    setCreateCategory("");
    setCreateTakeOffRental(true);
    toast.success("Repair created — added to Phase 1");
  }

  // --- Phase 2 (Diagnose) per-record inputs ---
  const [diagInputs, setDiagInputs] = useState<Record<string, { partsNeeded: string; partsCost: string; laborCost: string; mileage: string }>>({});
  const diagFor = (m: Maintenance) =>
    diagInputs[m.id] ?? {
      partsNeeded: m.diagnosisNotes ?? "",
      partsCost: m.partsCost ? String(m.partsCost) : "",
      laborCost: m.laborCost ? String(m.laborCost) : "",
      mileage: m.mileageAtService ? String(m.mileageAtService) : "",
    };
  const setDiag = (id: string, patch: Partial<{ partsNeeded: string; partsCost: string; laborCost: string; mileage: string }>) =>
    setDiagInputs(prev => ({ ...prev, [id]: { ...diagFor(maintenance.find(x => x.id === id)!), ...prev[id], ...patch } }));

  function handleSaveDiagnosis(m: Maintenance) {
    const d = diagFor(m);
    const parts = parseFloat(d.partsCost) || 0;
    const labour = parseFloat(d.laborCost) || 0;
    if (!d.partsNeeded.trim() || (!(parts > 0) && !(labour > 0))) {
      toast.error("Complete parts info to save");
      return;
    }
    saveRepairDiagnosis(m.id, { partsNeeded: d.partsNeeded, partsCost: parts, laborCost: labour, mileageAtService: parseInt(d.mileage, 10) || 0 });
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

  // --- Mechanic diagnosis jobs ---
  const loadJobsFn = useServerFn(listMechanicJobs);
  const resendJobFn = useServerFn(resendMechanicJob);
  const cancelJobFn = useServerFn(cancelMechanicJob);
  const [mechanicJobs, setMechanicJobs] = useState<MechanicJobRow[]>([]);
  const [sendForRecord, setSendForRecord] = useState<Maintenance | null>(null);
  const [viewJob, setViewJob] = useState<MechanicJobRow | null>(null);

  async function refreshJobs() {
    try {
      const r = await loadJobsFn();
      setMechanicJobs((r.jobs ?? []) as unknown as MechanicJobRow[]);
    } catch { /* ignore */ }
  }
  useEffect(() => { refreshJobs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const sentJobByMaint = new Map<string, MechanicJobRow>();
  const submittedJobByMaint = new Map<string, MechanicJobRow>();
  for (const j of mechanicJobs) {
    if (j.status === "sent" && !sentJobByMaint.has(j.maintenance_id)) sentJobByMaint.set(j.maintenance_id, j);
    if (j.status === "submitted" && !submittedJobByMaint.has(j.maintenance_id)) submittedJobByMaint.set(j.maintenance_id, j);
  }

  async function handleResendJob(j: MechanicJobRow) {
    const v = vehicleById(j.vehicle_id ?? "");
    try {
      await resendJobFn({ data: { id: j.id, vehicleLabel: v ? `${v.year} ${v.make} ${v.model}` : "", plate: v?.plate } });
      toast.success("Link resent to mechanic");
    } catch (e: any) { toast.error(e?.message || "Failed to resend"); }
  }
  async function handleCancelJob(j: MechanicJobRow) {
    try {
      await cancelJobFn({ data: { id: j.id } });
      toast.success("Request cancelled");
      refreshJobs();
    } catch (e: any) { toast.error(e?.message || "Failed to cancel"); }
  }

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

  // --- Routine Maintenance Cards ---
  const [rmVehicleId, setRmVehicleId] = useState<string | null>(null);
  const loadRmCardsFn = useServerFn(listRmCards);
  const [rmCards, setRmCards] = useState<RmCardRow[]>([]);
  async function refreshRmCards() {
    try {
      const r = await loadRmCardsFn();
      setRmCards((r.cards ?? []) as RmCardRow[]);
    } catch { /* ignore */ }
  }
  useEffect(() => { refreshRmCards(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const pendingRmCards = rmCards.filter(c => c.status === "submitted");
  const recentRmCards = rmCards.filter(c => c.status === "approved").slice(0, 5);

  return (
    <TooltipProvider>
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
        <div className="space-y-3">
          {/* Phase 1 — State Issue */}
          <Card className="border-yellow-500/40">
            <button type="button" onClick={() => togglePhase("p1")} className="w-full text-left">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-yellow-600">
                    {openPhases["p1"] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
                    Phase 1 · State Issue
                  </span>
                  <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-600">{phase1.length}</span>
                </CardTitle>
              </CardHeader>
            </button>
            {openPhases["p1"] && (
            <CardContent className="p-0 pb-2">
              {phase1.length === 0 ? (
                <p className="px-4 py-2 text-xs text-muted-foreground">Nothing here.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {phase1.map(m => {
                    const fromInspection = (m.source ?? "").includes("inspection");
                    const open = expandedId === m.id;
                    return (
                      <li key={m.id} className="border-l-[3px] border-l-yellow-500">
                        <RepairRow m={m} open={open} onToggle={() => toggleExpand(m.id)} onDelete={() => setDeleteRecord(m)} />
                        {open && (
                          <div className="space-y-2 px-3 pb-3">
                            {m.repairRequestNotes && (
                              <div className="text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">Symptoms:</span> {m.repairRequestNotes}
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <Badge variant="secondary" className="text-[10px]">
                                {fromInspection ? "From inspection" : "Manual"}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">{fmtDate((m.createdAt ?? "").slice(0, 10))}</span>
                            </div>
                            {sentJobByMaint.has(m.id) ? (
                              <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-2">
                                <Badge variant="secondary" className="text-[10px]">
                                  📤 Sent to {sentJobByMaint.get(m.id)!.mechanic_name} · {fmtDate((sentJobByMaint.get(m.id)!.sent_at ?? "").slice(0, 10))}
                                </Badge>
                                <div className="flex gap-2">
                                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => handleResendJob(sentJobByMaint.get(m.id)!)}>Resend Link</Button>
                                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => handleCancelJob(sentJobByMaint.get(m.id)!)}>Cancel Request</Button>
                                </div>
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" className="w-full" onClick={() => setSendForRecord(m)}>
                                Send Diagnosis to Mechanic
                              </Button>
                            )}
                            <Button size="sm" className="w-full" onClick={() => moveRepairToDiagnose(m.id)}>
                              Move to Diagnose →
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
            )}
          </Card>

          {/* Phase 2 — Diagnose */}
          <Card className="border-blue-500/40">
            <button type="button" onClick={() => togglePhase("p2")} className="w-full text-left">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-blue-600">
                    {openPhases["p2"] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                    Phase 2 · Diagnose
                  </span>
                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-600">{phase2.length}</span>
                </CardTitle>
              </CardHeader>
            </button>
            {openPhases["p2"] && (
            <CardContent className="p-0 pb-2">
              {phase2.length === 0 ? (
                <p className="px-4 py-2 text-xs text-muted-foreground">Nothing here.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {phase2.map(m => {
                    const d = diagFor(m);
                    const parts = parseFloat(d.partsCost) || 0;
                    const labour = parseFloat(d.laborCost) || 0;
                    const total = parts + labour;
                    const open = expandedId === m.id;
                    return (
                      <li key={m.id} className="border-l-[3px] border-l-blue-500">
                        <RepairRow m={m} open={open} onToggle={() => toggleExpand(m.id)} onDelete={() => setDeleteRecord(m)} />
                        {open && (
                          <div className="space-y-2 px-3 pb-3">
                      {submittedJobByMaint.has(m.id) && (
                        <div className="flex items-center justify-between rounded-md border bg-blue-500/5 px-2 py-1.5">
                          <span className="text-[11px] text-muted-foreground">
                            📋 Submitted by {submittedJobByMaint.get(m.id)!.mechanic_name} · {fmtDate((submittedJobByMaint.get(m.id)!.submitted_at ?? "").slice(0, 10))}
                          </span>
                          <Button size="sm" variant="link" className="h-auto p-0 text-[11px]" onClick={() => setViewJob(submittedJobByMaint.get(m.id)!)}>
                            View Full Diagnosis
                          </Button>
                        </div>
                      )}
                      <div>
                        <Label className="text-[11px]">Parts needed</Label>
                        <Textarea
                          className="mt-1 min-h-[52px] text-xs"
                          placeholder="e.g. Front brake pads, rotors"
                          value={d.partsNeeded}
                          onChange={(e) => setDiag(m.id, { partsNeeded: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label className="text-[11px]">Mileage</Label>
                        <Input className="mt-1 h-8" type="number" min="0" step="1"
                          value={d.mileage} onChange={(e) => setDiag(m.id, { mileage: e.target.value })} />
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
                            <Button size="sm" className="w-full" onClick={() => handleSaveDiagnosis(m)}>
                              Save Diagnosis →
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
            )}
          </Card>

          {/* Phase 3 — Complete */}
          <Card className="border-green-600/40">
            <button type="button" onClick={() => togglePhase("p3")} className="w-full text-left">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-green-600">
                    {openPhases["p3"] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                    Phase 3 · Complete
                  </span>
                  <span className="rounded-full bg-green-600/15 px-2 py-0.5 text-xs font-medium text-green-600">{phase3.length}</span>
                </CardTitle>
              </CardHeader>
            </button>
            {openPhases["p3"] && (
            <CardContent className="p-0 pb-2">
              {phase3.length === 0 ? (
                <p className="px-4 py-2 text-xs text-muted-foreground">Nothing here.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {phase3.map(m => {
                    const total = m.cost ?? 0;
                    const paid = m.amountPaid ?? 0;
                    const balance = Math.max(0, total - paid);
                    const open = expandedId === m.id;
                    return (
                      <li key={m.id} className="border-l-[3px] border-l-green-600">
                        <RepairRow m={m} open={open} onToggle={() => toggleExpand(m.id)} onDelete={() => setDeleteRecord(m)} />
                        {open && (
                          <div className="space-y-2 px-3 pb-3">
                    {m.diagnosisNotes && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Parts used:</span> {m.diagnosisNotes}
                      </div>
                    )}
                    <div className="space-y-0.5 rounded bg-muted/40 p-2 text-xs">
                      <div className="flex justify-between"><span>Total</span><span>{fmtMoney(total)}</span></div>
                      <div className="flex justify-between"><span>Paid</span><span>{fmtMoney(paid)}</span></div>
                      <div className="flex justify-between border-t border-border pt-0.5 font-medium"><span>Balance</span><span>{fmtMoney(balance)}</span></div>
                    </div>
                    {payOpenId === m.id ? (
                      <div className="flex gap-2">
                        <Input className="h-8" type="number" min="0" step="0.01" placeholder="Amount"
                          value={payInputs[m.id] ?? ""} onChange={(e) => setPayInputs(prev => ({ ...prev, [m.id]: e.target.value }))} />
                        <Button size="sm" onClick={() => handleProcessPayment(m)}>Submit</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => setPayOpenId(m.id)}>
                        + Process Payment
                      </Button>
                    )}
                    <Button size="sm" className="w-full" disabled={balance > 0} onClick={() => handleCompleteRepair(m)}>
                      Complete Repair
                    </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
            )}
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
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            reverseRepairToDiagnose(m.id);
                            toast.success("Repair reversed back to Diagnose");
                          }}
                        >
                          <RotateCcw className="mr-1 h-3 w-3" /> Reverse
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDetailRecord(m)}>
                          Details
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground/60 hover:text-destructive" onClick={() => setDeleteRecord(m)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete repair</TooltipContent>
                        </Tooltip>
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
            <TabsTrigger value="mechanics">Mechanic Jobs ({mechanicJobs.length})</TabsTrigger>
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
                      {Object.values(
                        dueSoon.reduce<Record<string, ScheduledItem[]>>((acc, it) => {
                          (acc[it.vehicleId] ??= []).push(it);
                          return acc;
                        }, {}),
                      ).map(group => {
                        const vid = group[0].vehicleId;
                        const v = vehicleById(vid);
                        const open = openVehicles[vid];
                        const hasOverdue = group.some(it => it.status === "overdue");
                        return (
                          <li key={vid}>
                            <button
                              type="button"
                              onClick={() => setRmVehicleId(vid)}
                              className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40"
                            >
                              <ClipboardCheck className="h-4 w-4 shrink-0 text-primary" />
                              <Car className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {v ? `${v.year} ${v.make} ${v.model}` : vid}
                              </span>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${hasOverdue ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-600"}`}>
                                {group.length} item{group.length === 1 ? "" : "s"} due
                              </span>
                            </button>
                            {false && open && (
                              <ul className="divide-y divide-border border-t border-border bg-muted/20">
                                {group.map(it => (
                                  <li key={it.key} className="flex items-center justify-between gap-2 py-2 pl-12 pr-4">
                                    <div className="min-w-0">
                                      <div className="text-sm">{it.label}</div>
                                      <div className={`text-xs ${it.status === "overdue" ? "text-destructive" : "text-muted-foreground"}`}>
                                        {scheduledRemainingLabel(it)}
                                        {it.dueDate ? ` · due ${fmtDate(it.dueDate)}` : it.dueMileage ? ` · at ${it.dueMileage.toLocaleString()} mi` : ""}
                                      </div>
                                    </div>
                                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => handleMarkComplete(it)}>
                                      Mark Complete
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            )}
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

            {/* RM Cards awaiting approval */}
            <RmPendingApprovals
              cards={pendingRmCards}
              labelFor={(vid) => {
                const v = vehicleById(vid);
                return v ? `${v.year} ${v.make} ${v.model}` : vid;
              }}
              onChanged={refreshRmCards}
            />

            {/* Recent RM Cards */}
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="h-4 w-4 text-primary" />
                  Recent RM Cards (last 5)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {recentRmCards.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">No routine maintenance cards submitted yet.</div>
                ) : (
                  <ul className="divide-y divide-border">
                    {recentRmCards.map(c => {
                      const v = vehicleById(c.vehicle_id);
                      const items = Array.isArray(c.items_checked) ? c.items_checked : [];
                      const passed = items.filter(i => i.status === "Pass").length;
                      const failed = items.filter(i => i.status === "Fail").length;
                      return (
                        <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{v ? `${v.year} ${v.make} ${v.model}` : c.vehicle_id}</div>
                            <div className="text-xs text-muted-foreground">
                              {fmtDate((c.submitted_at ?? c.created_at)?.slice(0, 10))} · {c.inspector_name || "—"}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-xs">
                            <span className="rounded-full bg-green-500/15 px-2 py-0.5 font-medium text-green-600">{passed} passed</span>
                            <span className={`rounded-full px-2 py-0.5 font-medium ${failed > 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>{failed} failed</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
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
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="mr-2 h-7 px-2 text-xs"
                                  onClick={() => {
                                    reverseRepairToDiagnose(m.id);
                                    toast.success("Repair reversed back to Diagnose");
                                  }}
                                >
                                  <RotateCcw className="mr-1 h-3 w-3" /> Reverse
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setDetailRecord(m)}>
                                  View Details
                                </Button>
                                <Button size="sm" variant="ghost" className="ml-2 h-7 px-2 text-xs text-muted-foreground/70 hover:text-destructive" onClick={() => setDeleteRecord(m)}>
                                  <Trash2 className="mr-1 h-3 w-3" /> Delete
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

          <TabsContent value="mechanics" className="mt-4">
            <MechanicJobHistory jobs={mechanicJobs} onView={(j) => setViewJob(j)} />
          </TabsContent>
        </Tabs>
      </section>

      <CompletedRepairDetailDialog
        record={detailRecord}
        open={!!detailRecord}
        onOpenChange={(v) => { if (!v) setDetailRecord(null); }}
      />

      {sendForRecord && (() => {
        const v = vehicleById(sendForRecord.vehicleId);
        return (
          <SendToMechanicDialog
            open={!!sendForRecord}
            onOpenChange={(o) => { if (!o) setSendForRecord(null); }}
            maintenanceId={sendForRecord.id}
            vehicleId={sendForRecord.vehicleId}
            vehicleLabel={v ? `${v.year} ${v.make} ${v.model}` : ""}
            plate={v?.plate}
            issue={sendForRecord.issueDescription ?? sendForRecord.serviceType ?? ""}
            adminName={adminName}
            onSent={refreshJobs}
          />
        );
      })()}

      <ViewDiagnosisDialog job={viewJob} onClose={() => setViewJob(null)} />

      <RmCardDialog
        vehicleId={rmVehicleId}
        open={!!rmVehicleId}
        onOpenChange={(o) => { if (!o) setRmVehicleId(null); }}
        adminName={adminName}
        onSubmitted={refreshRmCards}
      />

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) { setCreateVehicleId(""); setCreateIssue(""); setCreateCategory(""); setCreateTakeOffRental(true); } }}>
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
            <div className="space-y-2">
              <Label htmlFor="create-category">Problem category</Label>
              <ProblemCategorySelect id="create-category" value={createCategory} onChange={setCreateCategory} />
              <p className="text-xs text-muted-foreground">Required — used to group repairs in analytics.</p>
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

      <AlertDialog open={!!deleteRecord} onOpenChange={(o) => { if (!o) setDeleteRecord(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this repair?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>This will permanently remove:</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  <li>The repair record</li>
                  <li>Any P&amp;L expense entries</li>
                  <li>Fleet card repair history entry</li>
                  <li>Scorecard data</li>
                </ul>
                <p>Vehicle availability will be restored.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDeleteRepair}>
              Yes, Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
    </TooltipProvider>
  );
}

function RepairRow({ m, open, onToggle, onDelete }: { m: Maintenance; open: boolean; onToggle: () => void; onDelete: () => void }) {
  const v = vehicleById(m.vehicleId);
  const name = v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId;
  const issue = m.issueDescription ?? m.serviceType;
  return (
    <div className="flex w-full items-center gap-1 pr-1 hover:bg-muted/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{name}</span>
          <span className="text-muted-foreground"> — {issue}</span>
        </span>
        {m.problemCategory && (
          <Badge variant="outline" className="shrink-0 text-[10px]">{m.problemCategory}</Badge>
        )}
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground/60 hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete repair</TooltipContent>
      </Tooltip>
    </div>
  );
}
