import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProblemCategorySelect } from "@/components/app/ProblemCategorySelect";
import { CompletedRepairDetailDialog } from "@/components/app/CompletedRepairDetailDialog";
import { maintenance as maintenanceList, fmtMoney, fmtDate, vehicles, type Maintenance } from "@/lib/mock/data";
import {
  useStoreVersion,
  setRepairRentalBlocking,
  createManualRepair,
  moveRepairToDiagnose,
  saveRepairDiagnosis,
  completeRepair,
  completeRepairLineItem,
  updateMaintenance,
  lineItemTotals,
} from "@/lib/mock/store";
import { repairDisplayTitle, repairReportedIssue, effectiveRepairCost } from "@/lib/maintenance-utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Wrench, Plus, StickyNote, ChevronRight } from "lucide-react";

interface Props {
  vehicleId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function VehicleRepairPanelDialog({ vehicleId, open, onOpenChange }: Props) {
  useStoreVersion();
  const v = vehicleId ? vehicles.find(x => x.id === vehicleId) : null;

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

  const records = useMemo(
    () =>
      vehicleId
        ? maintenanceList
            .filter(m => m.vehicleId === vehicleId && !!m.status && m.approvalStatus !== "pending" && m.approvalStatus !== "rejected")
            .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id))
        : [],
    [vehicleId],
  );

  const reported = records.filter(m => m.status === "reported" || m.status === "open");
  const diagnosing = records.filter(m => m.status === "diagnosing");
  const readyToComplete = records.filter(m => m.status === "pending_complete" || m.status === "in_progress" || m.status === "pending_deposit");
  const completed = records
    .filter(m => m.status === "complete")
    .sort((a, b) => (b.completionDate ?? b.dateCompleted ?? "").localeCompare(a.completionDate ?? a.dateCompleted ?? ""));

  const openRecords = [...reported, ...diagnosing, ...readyToComplete];
  const anyBlocking = openRecords.some(m => m.isRentalBlocking);

  const [completedRepair, setCompletedRepair] = useState<Maintenance | null>(null);
  const [newIssueOpen, setNewIssueOpen] = useState(false);

  function toggleMasterRental(blocking: boolean) {
    openRecords.forEach(m => setRepairRentalBlocking(m.id, blocking));
    toast.success(blocking ? "Vehicle taken off rental" : "Vehicle marked rentable — issues stay noted");
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              {v ? `${v.year} ${v.make} ${v.model}` : "Repairs"}
            </DialogTitle>
            {v && <DialogDescription>{v.id} · Tag #{v.plate} — repair timeline & actions</DialogDescription>}
          </DialogHeader>

          {v && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
              <div className="text-sm">
                <div className="font-medium">{anyBlocking ? "🔴 Off road" : openRecords.length > 0 ? "⚠️ Rentable (issues noted)" : "✅ Rentable"}</div>
                <div className="text-xs text-muted-foreground">
                  {anyBlocking ? "Blocked from new rentals" : "Available for new bookings"}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Off road</span>
                <Switch checked={!anyBlocking} onCheckedChange={(c) => toggleMasterRental(!c)} disabled={openRecords.length === 0} />
                <span className="text-muted-foreground">Rentable</span>
              </div>
            </div>
          )}

          <ScrollArea className="max-h-[55vh] pr-3">
            <div className="space-y-4">
              <Section title="Open issues / in repair" count={reported.length}>
                {reported.length === 0 ? <Empty /> : reported.map(m => (
                  <ReportedCard key={m.id} m={m} adminName={adminName} />
                ))}
              </Section>

              <Section title="In diagnosis" count={diagnosing.length}>
                {diagnosing.length === 0 ? <Empty /> : diagnosing.map(m => (
                  <DiagnosingCard key={m.id} m={m} />
                ))}
              </Section>

              <Section title="Ready to complete" count={readyToComplete.length}>
                {readyToComplete.length === 0 ? <Empty /> : readyToComplete.map(m => (
                  <CompleteCard key={m.id} m={m} adminName={adminName} />
                ))}
              </Section>

              <Section title="Completed" count={completed.length}>
                {completed.length === 0 ? <Empty /> : completed.map(m => (
                  <div key={m.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{repairDisplayTitle(m)}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(m.completionDate ?? m.dateCompleted)} · {fmtMoney(effectiveRepairCost(m))}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setCompletedRepair(m)}>View details</Button>
                  </div>
                ))}
              </Section>
            </div>
          </ScrollArea>

          <Separator />
          {v && !newIssueOpen && (
            <Button variant="outline" onClick={() => setNewIssueOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Log new issue
            </Button>
          )}
          {v && newIssueOpen && (
            <NewIssueForm vehicleId={v.id} onDone={() => setNewIssueOpen(false)} />
          )}
        </DialogContent>
      </Dialog>

      <CompletedRepairDetailDialog
        open={!!completedRepair}
        onOpenChange={(o) => { if (!o) setCompletedRepair(null); }}
        record={completedRepair}
      />
    </>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({count})
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground">None.</p>;
}

function NoteBox({ m }: { m: Maintenance }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  function save() {
    const t = text.trim();
    if (!t) { setOpen(false); return; }
    const stamped = `${new Date().toLocaleString()}: ${t}`;
    updateMaintenance(m.id, { notes: m.notes ? `${m.notes}\n${stamped}` : stamped });
    setText("");
    setOpen(false);
    toast.success("Note added");
  }
  return (
    <div className="mt-2">
      {m.notes && (
        <div className="mb-2 whitespace-pre-wrap rounded bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">{m.notes}</div>
      )}
      {!open ? (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
          <StickyNote className="mr-1 h-3.5 w-3.5" /> Add note
        </Button>
      ) : (
        <div className="space-y-1">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Add a note about this issue…" className="text-sm" />
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>Save note</Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setText(""); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportedCard({ m, adminName }: { m: Maintenance; adminName: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{repairDisplayTitle(m)}</div>
          <div className="text-xs text-muted-foreground">Reported {fmtDate(m.createdAt)} · no diagnosis yet</div>
        </div>
        <Badge variant={m.isRentalBlocking ? "destructive" : "outline"} className={m.isRentalBlocking ? "" : "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"}>
          {m.isRentalBlocking ? <><AlertTriangle className="mr-1 h-3 w-3" /> Off road</> : "Noted"}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          <Switch checked={!!m.isRentalBlocking} onCheckedChange={(c) => { setRepairRentalBlocking(m.id, c); toast.success(c ? "Off rental" : "Kept rentable"); }} />
          <span className="text-muted-foreground">Take off rental</span>
        </div>
        <Button size="sm" onClick={() => { moveRepairToDiagnose(m.id); toast.success("Moved to diagnosis"); }}>
          Diagnose <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
        </Button>
      </div>
      <NoteBox m={m} />
    </div>
  );
}

function DiagnosingCard({ m }: { m: Maintenance }) {
  const [diagnosis, setDiagnosis] = useState(m.diagnosisTitle ?? "");
  const [partsNeeded, setPartsNeeded] = useState(m.diagnosisNotes ?? "");
  const [partsCost, setPartsCost] = useState(m.partsCost ? String(m.partsCost) : "");
  const [laborCost, setLaborCost] = useState(m.laborCost ? String(m.laborCost) : "");
  const [mileage, setMileage] = useState(m.mileageAtService ? String(m.mileageAtService) : "");

  function save() {
    const parts = parseFloat(partsCost) || 0;
    const labour = parseFloat(laborCost) || 0;
    if (!partsNeeded.trim() || (!(parts > 0) && !(labour > 0))) {
      toast.error("Add parts/labour details to save the diagnosis");
      return;
    }
    saveRepairDiagnosis(m.id, {
      diagnosis,
      partsNeeded,
      partsCost: parts,
      laborCost: labour,
      mileageAtService: parseInt(mileage, 10) || undefined,
    });
    toast.success("Diagnosis saved — moved to Complete");
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-sm font-medium">{repairReportedIssue(m) || repairDisplayTitle(m)}</div>
      <div className="mt-2 grid gap-2">
        <div>
          <Label className="text-xs">Diagnosis</Label>
          <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="What was found" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs">Parts needed / notes</Label>
          <Textarea value={partsNeeded} onChange={(e) => setPartsNeeded(e.target.value)} rows={2} className="text-sm" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Parts $</Label>
            <Input type="number" value={partsCost} onChange={(e) => setPartsCost(e.target.value)} className="text-sm" />
          </div>
          <div>
            <Label className="text-xs">Labour $</Label>
            <Input type="number" value={laborCost} onChange={(e) => setLaborCost(e.target.value)} className="text-sm" />
          </div>
          <div>
            <Label className="text-xs">Mileage</Label>
            <Input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} className="text-sm" />
          </div>
        </div>
        <Button size="sm" onClick={save}>Save diagnosis</Button>
      </div>
      <NoteBox m={m} />
    </div>
  );
}

function CompleteCard({ m, adminName }: { m: Maintenance; adminName: string }) {
  const items = m.lineItems ?? [];
  const hasItems = items.length > 0;
  const [mechanicName, setMechanicName] = useState(m.mechanicName ?? "");
  const [notes, setNotes] = useState("");

  function complete() {
    const summary = completeRepair(m.id, {
      completedBy: adminName,
      mechanicName: mechanicName.trim() || undefined,
      mechanicNotes: notes.trim() || undefined,
    });
    if (summary) toast.success(`Repair completed — ${fmtMoney(summary.total)} posted to P&L`);
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{repairDisplayTitle(m)}</div>
          <div className="text-xs text-muted-foreground">Est. {fmtMoney(effectiveRepairCost(m))}</div>
        </div>
        <Badge variant={m.isRentalBlocking ? "destructive" : "outline"} className={m.isRentalBlocking ? "" : "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"}>
          {m.isRentalBlocking ? "Off road" : "Noted"}
        </Badge>
      </div>

      {hasItems ? (
        <div className="mt-2 space-y-2">
          {items.map(it => (
            <LineItemRow key={it.id} m={m} itemId={it.id} adminName={adminName} />
          ))}
          <div className="text-right text-xs text-muted-foreground">
            Total {fmtMoney(lineItemTotals(items).total)}
          </div>
        </div>
      ) : (
        <div className="mt-2 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Mechanic</Label>
              <Input value={mechanicName} onChange={(e) => setMechanicName(e.target.value)} className="text-sm" />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <Switch checked={!!m.isRentalBlocking} onCheckedChange={(c) => setRepairRentalBlocking(m.id, c)} />
              <span className="text-muted-foreground">Off rental</span>
            </div>
            <Button size="sm" onClick={complete}>Mark complete</Button>
          </div>
        </div>
      )}
      <NoteBox m={m} />
    </div>
  );
}

function LineItemRow({ m, itemId, adminName }: { m: Maintenance; itemId: string; adminName: string }) {
  const item = (m.lineItems ?? []).find(x => x.id === itemId);
  const [partsCost, setPartsCost] = useState(item?.partsCost ? String(item.partsCost) : "");
  const [laborCost, setLaborCost] = useState(item?.laborCost ? String(item.laborCost) : "");
  if (!item) return null;
  const done = item.status === "complete";
  return (
    <div className="rounded border border-border/70 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm ${done ? "text-muted-foreground line-through" : "font-medium"}`}>{item.title}</span>
        {done && <Badge variant="outline" className="text-[10px]">Done · {fmtMoney((item.partsCost ?? 0) + (item.laborCost ?? 0))}</Badge>}
      </div>
      {!done && (
        <div className="mt-1.5 flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-[10px]">Parts $</Label>
            <Input type="number" value={partsCost} onChange={(e) => setPartsCost(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="flex-1">
            <Label className="text-[10px]">Labour $</Label>
            <Input type="number" value={laborCost} onChange={(e) => setLaborCost(e.target.value)} className="h-8 text-sm" />
          </div>
          <Button
            size="sm"
            onClick={() => {
              const res = completeRepairLineItem(m.id, item.id, {
                partsCost: parseFloat(partsCost) || 0,
                laborCost: parseFloat(laborCost) || 0,
                completedBy: adminName,
              });
              if (res?.allComplete) toast.success("✓ All items complete — repair closed");
              else toast.success("✓ Item completed & logged");
            }}
          >
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

function NewIssueForm({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const [issue, setIssue] = useState("");
  const [category, setCategory] = useState("");
  const [takeOffRental, setTakeOffRental] = useState(true);

  function submit() {
    if (!issue.trim()) { toast.error("Describe the issue"); return; }
    if (!category) { toast.error("Select a problem category"); return; }
    createManualRepair(vehicleId, issue.trim(), takeOffRental, category);
    toast.success("Issue logged");
    setIssue("");
    setCategory("");
    setTakeOffRental(true);
    onDone();
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div>
        <Label className="text-xs">Issue</Label>
        <Input value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="Describe the problem" className="text-sm" />
      </div>
      <div>
        <Label className="text-xs">Problem category</Label>
        <ProblemCategorySelect value={category} onChange={setCategory} />
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <Switch checked={takeOffRental} onCheckedChange={setTakeOffRental} />
        <span className="text-muted-foreground">Take off rental now</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit}>Log issue</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}