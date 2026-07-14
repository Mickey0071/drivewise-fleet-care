import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { maintenance, vehicles, activeVehicles, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
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
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useStoreVersion, markScheduledComplete } from "@/lib/mock/store";
import { createManualRepair, moveRepairToDiagnose, saveRepairDiagnosis, recordRepairPaymentRaw, completeRepair, reverseRepairToDiagnose, deleteRepair } from "@/lib/mock/store";
import { saveRepairDiagnosisLineItems, completeRepairLineItem, lineItemTotals, updateRepairAdjustments, updateRepairLineItem, addRepairLineItem } from "@/lib/mock/store";
import type { RepairLineItem } from "@/lib/mock/data";
import type { RepairCompletionSummary } from "@/lib/mock/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  effectiveRepairCost,
  repairDisplayTitle,
  repairReportedIssue,
  repairSplitLabel,
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
  // Additional "what's wrong" items entered alongside the primary issue.
  const [createExtraItems, setCreateExtraItems] = useState<string[]>([]);
  // Routine maintenance tasks (labels) pulled into this ticket from the vehicle's schedule.
  const [createRoutineItems, setCreateRoutineItems] = useState<string[]>([]);

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
    const routine = createRoutineItems.map(t => t.trim()).filter(Boolean);
    const extras = createExtraItems.map(t => t.trim()).filter(Boolean);
    const primary = createIssue.trim();
    const titles = [...routine, ...(primary ? [primary] : []), ...extras];
    if (titles.length === 0) { toast.error("Describe the issue or add a routine task"); return; }
    if (!createCategory) { toast.error("Select a problem category"); return; }
    const lineItems: RepairLineItem[] | undefined =
      titles.length > 1
        ? titles.map((title, i) => ({
            id: `li${Date.now()}_${i}`,
            title,
            problemCategory: createCategory,
            partsCost: 0,
            laborCost: 0,
            status: "open" as const,
          }))
        : undefined;
    const summaryIssue = lineItems ? titles.join("; ") : titles[0];
    createManualRepair(createVehicleId, summaryIssue, createTakeOffRental, createCategory, lineItems);
    setCreateOpen(false);
    setCreateVehicleId("");
    setCreateIssue("");
    setCreateCategory("");
    setCreateTakeOffRental(true);
    setCreateExtraItems([]);
    setCreateRoutineItems([]);
    toast.success("Repair created — added to Phase 1");
  }

  function toggleRoutineItem(label: string) {
    setCreateRoutineItems(prev => {
      const next = prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label];
      if (next.length > 0 && !createCategory) setCreateCategory("Routine / scheduled");
      return next;
    });
  }

  // --- Phase 2 (Diagnose) per-record inputs ---
  type SplitEntry = { diagnosis: string; partsNeeded: string; partsCost: string; laborCost: string; mechanicName: string; partsSupplier: string };
  type DiagInput = {
    diagnosis: string;
    partsNeeded: string;
    partsCost: string;
    laborCost: string;
    mileage: string;
    mechanicName: string;
    partsSupplier: string;
    splitEnabled: boolean;
    extraSplits: SplitEntry[];
    /** When true (with multiple problems), keep them as line items on ONE ticket. */
    oneTicket: boolean;
  };
  const [diagInputs, setDiagInputs] = useState<Record<string, DiagInput>>({});
  const diagFor = (m: Maintenance): DiagInput =>
    diagInputs[m.id] ?? {
      diagnosis: m.diagnosisTitle ?? "",
      partsNeeded: m.diagnosisNotes ?? "",
      partsCost: m.partsCost ? String(m.partsCost) : "",
      laborCost: m.laborCost ? String(m.laborCost) : "",
      mileage: m.mileageAtService ? String(m.mileageAtService) : "",
      mechanicName: m.mechanicName ?? "",
      partsSupplier: m.vendor && m.vendor !== "Pending assignment" ? m.vendor : "",
      splitEnabled: false,
      extraSplits: [],
      oneTicket: false,
    };
  const setDiag = (id: string, patch: Partial<DiagInput>) =>
    setDiagInputs(prev => ({ ...prev, [id]: { ...diagFor(maintenance.find(x => x.id === id)!), ...prev[id], ...patch } }));
  const emptySplit = (): SplitEntry => ({ diagnosis: "", partsNeeded: "", partsCost: "", laborCost: "", mechanicName: "", partsSupplier: "" });
  const setSplit = (id: string, idx: number, patch: Partial<SplitEntry>) => {
    const cur = diagFor(maintenance.find(x => x.id === id)!);
    const extraSplits = cur.extraSplits.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    setDiag(id, { extraSplits });
  };

  function handleSaveDiagnosis(m: Maintenance) {
    const d = diagFor(m);
    const parts = parseFloat(d.partsCost) || 0;
    const labour = parseFloat(d.laborCost) || 0;
    if (!d.partsNeeded.trim() || (!(parts > 0) && !(labour > 0))) {
      toast.error("Complete parts info to save");
      return;
    }
    const mileage = parseInt(d.mileage, 10) || 0;
    if (d.splitEnabled && d.extraSplits.length > 0) {
      const first = { diagnosis: d.diagnosis, partsNeeded: d.partsNeeded, partsCost: parts, laborCost: labour, mechanicName: d.mechanicName, vendor: d.partsSupplier };
      const rest = d.extraSplits
        .filter(s => s.diagnosis.trim() || s.partsNeeded.trim())
        .map(s => ({
          diagnosis: s.diagnosis,
          partsNeeded: s.partsNeeded,
          partsCost: parseFloat(s.partsCost) || 0,
          laborCost: parseFloat(s.laborCost) || 0,
          mechanicName: s.mechanicName,
          vendor: s.partsSupplier,
        }));
      if (rest.length === 0) {
        toast.error("Add details to the extra repair, or turn off split");
        return;
      }
      if (d.oneTicket) {
        // Keep all problems as line items on ONE ticket.
        const items: RepairLineItem[] = [first, ...rest].map((s, i) => ({
          id: `li${Date.now()}_${i}`,
          title: s.diagnosis.trim() || `Repair ${i + 1}`,
          problemCategory: m.problemCategory,
          partsNeeded: s.partsNeeded.trim() || undefined,
          partsCost: s.partsCost,
          laborCost: s.laborCost,
          mechanicName: s.mechanicName?.trim() || undefined,
          partsSupplier: s.vendor?.trim() || undefined,
          status: "open",
        }));
        saveRepairDiagnosisLineItems(m.id, items, mileage);
        toast.success(`${items.length} repair items saved on one ticket — moved to Complete`);
        return;
      }
      saveRepairDiagnosis(m.id, { diagnosis: d.diagnosis, partsNeeded: d.partsNeeded, partsCost: parts, laborCost: labour, mileageAtService: mileage, mechanicName: d.mechanicName, vendor: d.partsSupplier, splits: [first, ...rest] });
      toast.success(`Split into ${rest.length + 1} repair tickets — moved to Complete`);
      return;
    }
    saveRepairDiagnosis(m.id, { diagnosis: d.diagnosis, partsNeeded: d.partsNeeded, partsCost: parts, laborCost: labour, mileageAtService: mileage, mechanicName: d.mechanicName, vendor: d.partsSupplier });
    toast.success("Diagnosis saved — moved to Complete");
  }

  // --- Phase 3 (Complete) payment inputs ---
  const [payInputs, setPayInputs] = useState<Record<string, string>>({});
  const [payOpenId, setPayOpenId] = useState<string | null>(null);

  // --- Phase 3 per-item completion (multi-item tickets) ---
  const [itemDraft, setItemDraft] = useState<Record<string, { partsCost: string; laborCost: string; mechanicName: string; notes: string }>>({});
  const itemDraftFor = (item: RepairLineItem) =>
    itemDraft[item.id] ?? {
      partsCost: item.partsCost ? String(item.partsCost) : "",
      laborCost: item.laborCost ? String(item.laborCost) : "",
      mechanicName: "",
      notes: "",
    };
  function handleCompleteItem(m: Maintenance, item: RepairLineItem) {
    const d = itemDraftFor(item);
    const res = completeRepairLineItem(m.id, item.id, {
      partsCost: parseFloat(d.partsCost) || 0,
      laborCost: parseFloat(d.laborCost) || 0,
      mechanicName: d.mechanicName.trim() || undefined,
      notes: d.notes.trim() || undefined,
      completedBy: adminName,
    });
    setItemDraft(prev => { const n = { ...prev }; delete n[item.id]; return n; });
    if (res?.allComplete) toast.success("✓ All items complete — repair closed & logged to the vehicle");
    else toast.success("✓ Item completed & logged to the vehicle");
  }

  function handleProcessPayment(m: Maintenance) {
    const amt = parseFloat(payInputs[m.id] ?? "");
    if (!(amt > 0)) { toast.error("Enter a payment amount"); return; }
    recordRepairPaymentRaw(m.id, amt);
    setPayInputs(prev => ({ ...prev, [m.id]: "" }));
    setPayOpenId(null);
    toast.success(`Payment of ${fmtMoney(amt)} recorded`);
  }

  // --- Phase 3 pre-complete adjustments (single-repair tickets) ---
  type AdjustDraft = { partsCost: string; laborCost: string; mechanicName: string; partsSupplier: string };
  const [adjustDraft, setAdjustDraft] = useState<Record<string, AdjustDraft>>({});
  const adjustFor = (m: Maintenance): AdjustDraft =>
    adjustDraft[m.id] ?? {
      partsCost: m.partsCost != null ? String(m.partsCost) : "",
      laborCost: m.laborCost != null ? String(m.laborCost) : "",
      mechanicName: m.mechanicName ?? "",
      partsSupplier: m.vendor && m.vendor !== "Pending assignment" ? m.vendor : "",
    };
  const setAdjust = (id: string, patch: Partial<AdjustDraft>) =>
    setAdjustDraft(prev => ({ ...prev, [id]: { ...adjustFor(maintenance.find(x => x.id === id)!), ...prev[id], ...patch } }));
  function handleSaveAdjustments(m: Maintenance) {
    const d = adjustFor(m);
    updateRepairAdjustments(m.id, {
      partsCost: parseFloat(d.partsCost) || 0,
      laborCost: parseFloat(d.laborCost) || 0,
      mechanicName: d.mechanicName,
      vendor: d.partsSupplier,
    });
    toast.success("Adjustments saved");
  }

  // --- Phase 3 line item edits + new-item add ---
  const [itemEdits, setItemEdits] = useState<Record<string, { partsSupplier: string }>>({});
  const itemEditFor = (item: RepairLineItem) =>
    itemEdits[item.id] ?? { partsSupplier: item.partsSupplier ?? "" };
  function handleSaveItemChanges(m: Maintenance, item: RepairLineItem) {
    const d = itemDraftFor(item);
    const e = itemEditFor(item);
    updateRepairLineItem(m.id, item.id, {
      partsCost: parseFloat(d.partsCost) || 0,
      laborCost: parseFloat(d.laborCost) || 0,
      mechanicName: d.mechanicName,
      notes: d.notes,
      partsSupplier: e.partsSupplier,
    });
    toast.success("Item updated");
  }
  type NewItemDraft = { title: string; partsCost: string; laborCost: string; mechanicName: string; partsSupplier: string; partsNeeded: string };
  const [newItemDraft, setNewItemDraft] = useState<Record<string, NewItemDraft>>({});
  const [newItemOpen, setNewItemOpen] = useState<Record<string, boolean>>({});
  const newItemFor = (id: string): NewItemDraft =>
    newItemDraft[id] ?? { title: "", partsCost: "", laborCost: "", mechanicName: "", partsSupplier: "", partsNeeded: "" };
  function handleAddNewItem(m: Maintenance) {
    const d = newItemFor(m.id);
    if (!d.title.trim()) { toast.error("Item title required"); return; }
    addRepairLineItem(m.id, {
      title: d.title.trim(),
      partsNeeded: d.partsNeeded.trim() || undefined,
      partsCost: parseFloat(d.partsCost) || 0,
      laborCost: parseFloat(d.laborCost) || 0,
      mechanicName: d.mechanicName.trim() || undefined,
      partsSupplier: d.partsSupplier.trim() || undefined,
    });
    setNewItemDraft(prev => { const n = { ...prev }; delete n[m.id]; return n; });
    setNewItemOpen(prev => ({ ...prev, [m.id]: false }));
    toast.success("Item added");
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
  const completedThisMonthTotal = completedThisMonth.reduce((s, m) => s + effectiveRepairCost(m), 0);

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
                        <RepairRow m={m} open={open} onToggle={() => toggleExpand(m.id)} onDelete={() => setDeleteRecord(m)} job={sentJobByMaint.get(m.id) ?? submittedJobByMaint.get(m.id)} />
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
                    Phase 2 · Diag/In Repair
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
                        <RepairRow m={m} open={open} onToggle={() => toggleExpand(m.id)} onDelete={() => setDeleteRecord(m)} job={sentJobByMaint.get(m.id) ?? submittedJobByMaint.get(m.id)} />
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
                        <Label className="text-[11px]">Diagnosis (becomes the ticket title)</Label>
                        <Textarea
                          className="mt-1 min-h-[44px] text-xs"
                          placeholder="What's actually wrong, e.g. Worn front brake pads & warped rotors"
                          value={d.diagnosis}
                          onChange={(e) => setDiag(m.id, { diagnosis: e.target.value })}
                        />
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Reported issue: {m.issueDescription ?? m.serviceType ?? "—"}
                        </p>
                      </div>
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
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Label className="text-[11px]">Diagnosing mechanic</Label>
                          <Input className="mt-1 h-8 text-xs" placeholder="e.g. Jose"
                            value={d.mechanicName} onChange={(e) => setDiag(m.id, { mechanicName: e.target.value })} />
                        </div>
                        <div className="flex-1">
                          <Label className="text-[11px]">Parts source</Label>
                          <Input className="mt-1 h-8 text-xs" placeholder="Where did the part come from?"
                            value={d.partsSupplier} onChange={(e) => setDiag(m.id, { partsSupplier: e.target.value })} />
                        </div>
                      </div>
                      <div className="flex justify-between rounded bg-muted/40 px-2 py-1 text-xs font-medium">
                        <span>Total</span><span>{fmtMoney(total)}</span>
                      </div>
                      {/* Multiple problems → split into separate repair tickets */}
                      <label className="flex items-center gap-2 pt-1 text-[11px] text-foreground">
                        <Checkbox
                          checked={d.splitEnabled}
                          onCheckedChange={(c: boolean | "indeterminate") =>
                            setDiag(m.id, {
                              splitEnabled: !!c,
                              extraSplits: c && d.extraSplits.length === 0 ? [emptySplit()] : d.extraSplits,
                            })
                          }
                        />
                        Multiple problems — split into separate repair tickets
                      </label>
                      {d.splitEnabled && (
                        <div className="space-y-2 rounded-md border border-dashed border-blue-500/40 bg-blue-500/5 p-2">
                          <div className="flex flex-col gap-1 rounded border border-border bg-card p-2 text-[11px]">
                            <label className="flex items-center gap-2">
                              <input type="radio" checked={!d.oneTicket} onChange={() => setDiag(m.id, { oneTicket: false })} />
                              Separate tickets (one per problem)
                            </label>
                            <label className="flex items-center gap-2">
                              <input type="radio" checked={d.oneTicket} onChange={() => setDiag(m.id, { oneTicket: true })} />
                              One ticket — multiple items (complete individually)
                            </label>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {d.oneTicket
                              ? "All problems stay on this single ticket. Each item is priced and completed individually."
                              : "Each extra repair keeps the same reported issue and gets its own diagnosis, parts & costs."}
                          </p>
                          {d.extraSplits.map((s, i) => (
                            <div key={i} className="space-y-1.5 rounded border border-border bg-card p-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-medium text-muted-foreground">{d.oneTicket ? `Item ${i + 2}` : `Repair ${i + 2}`}</span>
                                <Button size="sm" variant="ghost" className="h-6 px-1 text-[10px]"
                                  onClick={() => setDiag(m.id, { extraSplits: d.extraSplits.filter((_, j) => j !== i) })}>
                                  Remove
                                </Button>
                              </div>
                              <Textarea className="min-h-[36px] text-xs" placeholder="Diagnosis (title)"
                                value={s.diagnosis} onChange={(e) => setSplit(m.id, i, { diagnosis: e.target.value })} />
                              <Textarea className="min-h-[36px] text-xs" placeholder="Parts needed"
                                value={s.partsNeeded} onChange={(e) => setSplit(m.id, i, { partsNeeded: e.target.value })} />
                              <div className="flex gap-2">
                                <Input className="h-8 flex-1" type="number" min="0" step="0.01" placeholder="Parts $"
                                  value={s.partsCost} onChange={(e) => setSplit(m.id, i, { partsCost: e.target.value })} />
                                <Input className="h-8 flex-1" type="number" min="0" step="0.01" placeholder="Labour $"
                                  value={s.laborCost} onChange={(e) => setSplit(m.id, i, { laborCost: e.target.value })} />
                              </div>
                              <div className="flex gap-2">
                                <Input className="h-8 flex-1 text-xs" placeholder="Mechanic"
                                  value={s.mechanicName} onChange={(e) => setSplit(m.id, i, { mechanicName: e.target.value })} />
                                <Input className="h-8 flex-1 text-xs" placeholder="Parts source"
                                  value={s.partsSupplier} onChange={(e) => setSplit(m.id, i, { partsSupplier: e.target.value })} />
                              </div>
                            </div>
                          ))}
                          <Button size="sm" variant="outline" className="w-full text-xs"
                            onClick={() => setDiag(m.id, { extraSplits: [...d.extraSplits, emptySplit()] })}>
                            {d.oneTicket ? "+ Add another item" : "+ Add another repair"}
                          </Button>
                        </div>
                      )}
                            <Button size="sm" className="w-full" onClick={() => handleSaveDiagnosis(m)}>
                              {d.splitEnabled && d.extraSplits.length > 0 ? (d.oneTicket ? "Save Items →" : "Save & Split →") : "Save Diagnosis →"}
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
                    Phase 3 · Complete Pending Approval
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
                    const total = effectiveRepairCost(m);
                    const paid = m.amountPaid ?? 0;
                    const balance = Math.max(0, total - paid);
                    const open = expandedId === m.id;
                    return (
                      <li key={m.id} className="border-l-[3px] border-l-green-600">
                        <RepairRow m={m} open={open} onToggle={() => toggleExpand(m.id)} onDelete={() => setDeleteRecord(m)} job={sentJobByMaint.get(m.id) ?? submittedJobByMaint.get(m.id)} />
                        {open && (
                          <div className="space-y-2 px-3 pb-3">
                    {m.lineItems && m.lineItems.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span>Repair items</span>
                          <span className="text-muted-foreground">
                            {m.lineItems.filter(it => it.status === "complete").length} of {m.lineItems.length} done
                          </span>
                        </div>
                        {m.lineItems.map(item => {
                          const dr = itemDraftFor(item);
                          return (
                            <div key={item.id} className={`rounded-md border p-2 ${item.status === "complete" ? "border-green-600/40 bg-green-500/5" : "border-border"}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium">{item.title}</span>
                                {item.status === "complete" ? (
                                  <span className="flex items-center gap-1 text-[11px] text-green-600">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Done
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">{fmtMoney((Number(item.partsCost) || 0) + (Number(item.laborCost) || 0))}</span>
                                )}
                              </div>
                              {item.status === "complete" ? (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  {fmtMoney((Number(item.partsCost) || 0) + (Number(item.laborCost) || 0))}
                                  {item.completedAt ? ` · ${new Date(item.completedAt).toLocaleString("en-US")}` : ""}
                                  {item.mechanicName ? ` · ${item.mechanicName}` : ""}
                                </p>
                              ) : (
                                <div className="mt-2 space-y-1.5">
                                  <div className="flex gap-2">
                                    <Input className="h-7 flex-1 text-xs" type="number" min="0" step="0.01" placeholder="Parts $"
                                      value={dr.partsCost} onChange={(e) => setItemDraft(prev => ({ ...prev, [item.id]: { ...itemDraftFor(item), ...prev[item.id], partsCost: e.target.value } }))} />
                                    <Input className="h-7 flex-1 text-xs" type="number" min="0" step="0.01" placeholder="Labour $"
                                      value={dr.laborCost} onChange={(e) => setItemDraft(prev => ({ ...prev, [item.id]: { ...itemDraftFor(item), ...prev[item.id], laborCost: e.target.value } }))} />
                                  </div>
                                  <Input className="h-7 text-xs" placeholder="Mechanic (optional)"
                                    value={dr.mechanicName} onChange={(e) => setItemDraft(prev => ({ ...prev, [item.id]: { ...itemDraftFor(item), ...prev[item.id], mechanicName: e.target.value } }))} />
                                  <Input className="h-7 text-xs" placeholder="Notes (optional)"
                                    value={dr.notes} onChange={(e) => setItemDraft(prev => ({ ...prev, [item.id]: { ...itemDraftFor(item), ...prev[item.id], notes: e.target.value } }))} />
                                  <Button size="sm" className="w-full" onClick={() => handleCompleteItem(m, item)}>
                                    Mark item complete
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <div className="flex justify-between rounded bg-muted/40 px-2 py-1 text-xs font-medium">
                          <span>Ticket total</span><span>{fmtMoney(lineItemTotals(m.lineItems).total)}</span>
                        </div>
                      </div>
                    ) : (
                    <>
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
                    </>
                    )}
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
                          {repairDisplayTitle(m)} · {fmtDate((m.completionDate ?? m.dateCompleted)?.slice(0, 10))}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-medium">{fmtMoney(effectiveRepairCost(m))}</span>
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
                              <td className="px-4 py-2">{repairDisplayTitle(m)}</td>
                              <td className="px-4 py-2">{m.completedBy || m.vendor || "—"}</td>
                              <td className="px-4 py-2 text-right font-medium">{fmtMoney(effectiveRepairCost(m))}</td>
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
            prefillItems={(sendForRecord.lineItems ?? []).filter(it => it.status !== "complete").map(it => it.title)}
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

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) { setCreateVehicleId(""); setCreateIssue(""); setCreateCategory(""); setCreateTakeOffRental(true); setCreateExtraItems([]); setCreateRoutineItems([]); } }}>
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
                  {activeVehicles().map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.year} {v.make} {v.model} · {v.plate}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createVehicleId && (() => {
              const veh = vehicles.find(v => v.id === createVehicleId);
              const routine = veh ? computeScheduledItems(veh) : [];
              if (routine.length === 0) return null;
              const statusLabel = (s: string) =>
                s === "overdue" ? "overdue" : s === "due_soon" ? "due soon" : "upcoming";
              return (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <Label>Routine maintenance for this vehicle</Label>
                  <p className="text-xs text-muted-foreground">Tap to add a scheduled task as an editable repair item.</p>
                  <div className="space-y-1.5">
                    {routine.map(item => (
                      <label key={item.key} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={createRoutineItems.includes(item.label)}
                          onCheckedChange={() => toggleRoutineItem(item.label)}
                        />
                        <span className="flex-1">{item.label}</span>
                        <span className={`text-xs ${item.status === "overdue" ? "text-destructive" : "text-muted-foreground"}`}>
                          {statusLabel(item.status)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="space-y-2">
              <Label htmlFor="create-issue">Issue</Label>
              <Input id="create-issue" value={createIssue} maxLength={200}
                onChange={(e) => setCreateIssue(e.target.value)} placeholder="What's wrong?" />
              {createExtraItems.map((val, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={val} maxLength={200} placeholder={`Additional item ${i + 2}`}
                    onChange={(e) => setCreateExtraItems(prev => prev.map((v, j) => (j === i ? e.target.value : v)))} />
                  <Button variant="ghost" size="icon" className="shrink-0 text-destructive"
                    onClick={() => setCreateExtraItems(prev => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-fit"
                onClick={() => setCreateExtraItems(prev => [...prev, ""])}>
                <Plus className="mr-1 h-4 w-4" /> Add another item
              </Button>
              <p className="text-xs text-muted-foreground">Add every problem on this car under one ticket.</p>
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

const REPAIR_STATUS_LABEL: Record<string, string> = {
  reported: "Reported",
  diagnosing: "Diagnosing",
  open: "Open",
  pending_deposit: "Pending deposit",
  pending_complete: "Pending complete",
  in_progress: "In progress",
  complete: "Complete",
};

/** Display-only total: prefers explicit cost, falls back to parts+labor. */
function totalCostFor(m: Maintenance): number {
  return effectiveRepairCost(m);
}

function RepairRow({ m, open, onToggle, onDelete, job }: { m: Maintenance; open: boolean; onToggle: () => void; onDelete: () => void; job?: MechanicJobRow }) {
  const v = vehicleById(m.vehicleId);
  const name = v ? `${v.year} ${v.make} ${v.model}` : m.vehicleId;
  const title = repairDisplayTitle(m);
  const reported = repairReportedIssue(m);
  const hasDiagnosis = !!(m.diagnosisTitle ?? "").trim();
  const splitLabel = repairSplitLabel(m);
  const statusLabel = m.status ? (REPAIR_STATUS_LABEL[m.status] ?? m.status) : null;
  const total = totalCostFor(m);
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="w-full">
      {/* ===== CARD FACE (essentials only) ===== */}
      <div className="flex w-full items-start gap-1 pr-1 hover:bg-muted/40">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left"
        >
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium">{name}</span>
              {v?.plate && <span className="text-xs text-muted-foreground">{v.plate}</span>}
              {m.problemCategory && (
                <Badge variant="outline" className="text-[10px]">{m.problemCategory}</Badge>
              )}
              {splitLabel && (
                <Badge variant="secondary" className="text-[10px]">🔗 {splitLabel}</Badge>
              )}
              {m.isRentalBlocking && (
                <Badge variant="destructive" className="text-[10px]">Off road</Badge>
              )}
            </span>
            <span className="block truncate text-xs font-medium text-foreground">{title}</span>
            {hasDiagnosis && reported && reported !== title && (
              <span className="block truncate text-[11px] text-muted-foreground">Reported: {reported}</span>
            )}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {statusLabel && <span className="font-medium text-foreground">{statusLabel}</span>}
              {total > 0 && <span>{fmtMoney(total)}</span>}
              {m.mechanicName && <span>🔧 {m.mechanicName}</span>}
            </span>
          </span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="mt-1 h-7 w-7 shrink-0 text-muted-foreground/60 hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete repair</TooltipContent>
        </Tooltip>
      </div>

      {/* ===== DETAILS (collapsed by default) ===== */}
      <div className="px-3 pb-1">
        <button
          type="button"
          onClick={() => setDetailsOpen(o => !o)}
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Details
        </button>
        {detailsOpen && <RepairDetails m={m} job={job} />}
      </div>
    </div>
  );
}

function RepairDetails({ m, job }: { m: Maintenance; job?: MechanicJobRow }) {
  const rows: Array<[string, ReactNode]> = [];
  if (m.vendor) rows.push(["Vendor", m.vendor]);
  if (job?.mechanic_phone) rows.push(["Mechanic phone", job.mechanic_phone]);
  if (job?.mechanic_shop) rows.push(["Mechanic shop", job.mechanic_shop]);
  if (m.diagnosisNotes) rows.push(["Parts list", m.diagnosisNotes]);
  if (m.downPayment != null && m.downPayment > 0) rows.push(["Down payment", fmtMoney(m.downPayment)]);
  if (m.amountPaid != null && m.amountPaid > 0) rows.push(["Amount paid", fmtMoney(m.amountPaid)]);
  if (m.balance != null && m.balance > 0) rows.push(["Balance", fmtMoney(m.balance)]);
  if (m.depositRequired != null && m.depositRequired > 0) rows.push(["Deposit required", fmtMoney(m.depositRequired)]);
  if (m.depositAmount != null && m.depositAmount > 0) rows.push(["Deposit received", fmtMoney(m.depositAmount)]);
  if (m.nextServiceDue) rows.push(["Next service due", fmtDate(m.nextServiceDue.slice(0, 10))]);
  if (m.mileageAtService) rows.push(["Mileage at service", m.mileageAtService.toLocaleString()]);

  return (
    <div className="mt-2 space-y-2 rounded-md border border-dashed bg-muted/20 p-2">
      {(job?.status === "sent" || job?.status === "submitted") && (
        <div className="flex flex-wrap gap-1.5">
          {job.status === "sent" && (
            <Badge variant="secondary" className="text-[10px]">📤 Sent to {job.mechanic_name}{job.sent_at ? ` · ${fmtDate(job.sent_at.slice(0, 10))}` : ""}</Badge>
          )}
          {job.status === "submitted" && (
            <Badge variant="secondary" className="text-[10px]">📋 Submitted by {job.mechanic_name}{job.submitted_at ? ` · ${fmtDate(job.submitted_at.slice(0, 10))}` : ""}</Badge>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No additional details.</p>
      ) : (
        <dl className="space-y-1 text-[11px]">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words text-right text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
