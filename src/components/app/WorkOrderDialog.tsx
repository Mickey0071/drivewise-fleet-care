import { useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SignaturePad } from "@/components/app/SignaturePad";
import { useAgreementSettings } from "@/lib/agreementSettings";
import { updateWorkOrder, uploadWorkOrderDoc, ensureWorkOrderFieldToken, useStoreVersion } from "@/lib/mock/store";
import { fmtDate, fmtMoney, type Vehicle, type WorkOrder } from "@/lib/mock/data";
import { renderWorkOrderPdf, type WorkOrderPdfData } from "@/lib/work-order-pdf";
import { Printer, Download, PenLine, Mail, Upload, CheckCircle2, Smartphone } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workOrder: WorkOrder;
  vehicle: Vehicle;
}

const priorityStyles: Record<string, string> = {
  high: "border-destructive/60 bg-destructive/10 text-destructive",
  medium: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low: "border-border bg-muted text-muted-foreground",
};
const today = () => new Date().toISOString().slice(0, 10);

export function WorkOrderDialog({ open, onOpenChange, workOrder, vehicle }: Props) {
  useStoreVersion();
  const settings = useAgreementSettings();

  const [completedDate, setCompletedDate] = useState(workOrder.completedDate ?? "");
  const [actualCost, setActualCost] = useState(workOrder.actualCost != null ? String(workOrder.actualCost) : "");
  const [partsUsed, setPartsUsed] = useState(workOrder.partsUsed ?? "");
  const [completionNotes, setCompletionNotes] = useState(workOrder.completionNotes ?? "");
  const [mechanicSig, setMechanicSig] = useState<string | null>(workOrder.mechanicSignature ?? null);
  const [showMechSig, setShowMechSig] = useState(false);
  const [reviewedBy, setReviewedBy] = useState(workOrder.reviewedBy ?? "");
  const [adminSig, setAdminSig] = useState<string | null>(workOrder.adminSignature ?? null);
  const [showAdminSig, setShowAdminSig] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const data: WorkOrderPdfData = useMemo(() => ({
    workOrderNumber: workOrder.id,
    vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model, plate: vehicle.plate, vin: vehicle.vin },
    scheduledDate: fmtDate(workOrder.scheduledDate),
    priority: workOrder.priority.toUpperCase(),
    status: workOrder.status.replace("_", " ").toUpperCase(),
    serviceType: workOrder.serviceType,
    description: workOrder.description,
    estimatedCost: workOrder.estimatedCost,
    assignedTo: workOrder.assignedTo ?? "",
    completedDate: completedDate ? fmtDate(completedDate) : "",
    actualCost: actualCost ? fmtMoney(Number(actualCost)) : "",
    partsUsed,
    completionNotes,
    mechanicSignature: mechanicSig,
    mechanicSignedAt: workOrder.mechanicSignedAt ? fmtDate(workOrder.mechanicSignedAt.slice(0, 10)) : (mechanicSig ? fmtDate(today()) : ""),
    reviewedBy,
    adminSignature: adminSig,
    adminSignedAt: workOrder.adminSignedAt ? fmtDate(workOrder.adminSignedAt.slice(0, 10)) : (adminSig ? fmtDate(today()) : ""),
    generatedAt: fmtDate(today()),
    settings,
  }), [workOrder, vehicle, completedDate, actualCost, partsUsed, completionNotes, mechanicSig, reviewedBy, adminSig, settings]);

  const fileName = `work-order-${workOrder.id}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();

  function saveCompletion() {
    updateWorkOrder(workOrder.id, {
      completedDate: completedDate || undefined,
      actualCost: actualCost ? Number(actualCost) : undefined,
      partsUsed: partsUsed.trim() || undefined,
      completionNotes: completionNotes.trim() || undefined,
      mechanicSignature: mechanicSig ?? undefined,
      mechanicSignedAt: mechanicSig ? new Date().toISOString() : undefined,
      reviewedBy: reviewedBy.trim() || undefined,
      adminSignature: adminSig ?? undefined,
      adminSignedAt: adminSig ? new Date().toISOString() : undefined,
      status: completedDate ? "completed" : workOrder.status,
    });
    toast.success("Work order saved");
  }

  async function downloadPdf() {
    setBusy(true);
    try {
      const blob = await renderWorkOrderPdf(data);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${fileName}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Work order downloaded");
    } catch (e: any) {
      toast.error("Could not generate PDF", { description: e?.message ?? "Try again" });
    } finally { setBusy(false); }
  }

  async function printOrder() {
    setBusy(true);
    try {
      const blob = await renderWorkOrderPdf(data);
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (w) w.addEventListener("load", () => setTimeout(() => w.print(), 400));
      else toast.error("Pop-up blocked", { description: "Allow pop-ups to print." });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) {
      toast.error("Could not open print view", { description: e?.message ?? "Try again" });
    } finally { setBusy(false); }
  }

  function emailMechanic() {
    const to = window.prompt("Email work order to mechanic:", workOrder.assignedTo ? "" : "");
    if (!to) return;
    const body = [
      `Maintenance Work Order ${workOrder.id}`,
      `Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} (Tag #${vehicle.plate})`,
      `Scheduled: ${fmtDate(workOrder.scheduledDate)}`,
      `Priority: ${workOrder.priority.toUpperCase()}`,
      `Service: ${workOrder.serviceType}`,
      `Description: ${workOrder.description || "—"}`,
      `Estimated cost: ${fmtMoney(workOrder.estimatedCost)}`,
      `Assigned to: ${workOrder.assignedTo || "—"}`,
      ``,
      `Please complete the work and sign the attached work order. Download the full PDF from the Fleet system.`,
    ].join("\n");
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`Work Order ${workOrder.id} — ${vehicle.year} ${vehicle.make} ${vehicle.model}`)}&body=${encodeURIComponent(body)}`;
  }

  async function uploadSigned(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await uploadWorkOrderDoc(workOrder.id, file);
      toast.success("Signed copy uploaded");
    } catch (err: any) {
      toast.error("Upload failed", { description: err?.message ?? "Try again" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function copyFieldLink() {
    const token = workOrder.fieldToken ?? ensureWorkOrderFieldToken(workOrder.id);
    if (!token) { toast.error("Could not create field link"); return; }
    const url = `${window.location.origin}/work-order/${token}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Field link copied", { description: "Send to the mechanic's phone." }),
      () => toast.error("Could not copy link", { description: url }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Work Order {workOrder.id}
            <Badge variant="outline" className={priorityStyles[workOrder.priority]}>{workOrder.priority.toUpperCase()}</Badge>
            {workOrder.status === "completed" && (
              <Badge variant="outline" className="border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Completed
              </Badge>
            )}
            {workOrder.fieldSubmittedAt && (
              <Badge variant="outline" className="border-primary/60 bg-primary/10 text-primary">
                <Smartphone className="mr-1 h-3 w-3" /> Field submission received
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {vehicle.year} {vehicle.make} {vehicle.model} · Tag #{vehicle.plate} · Scheduled {fmtDate(workOrder.scheduledDate)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 border-b pb-3">
          <Button size="sm" variant="outline" onClick={printOrder} disabled={busy}><Printer className="mr-1.5 h-4 w-4" /> Print</Button>
          <Button size="sm" onClick={downloadPdf} disabled={busy}><Download className="mr-1.5 h-4 w-4" /> Download PDF</Button>
          <Button size="sm" variant="outline" onClick={emailMechanic} disabled={busy}><Mail className="mr-1.5 h-4 w-4" /> Email to Mechanic</Button>
          <Button size="sm" variant="outline" onClick={copyFieldLink} disabled={busy}><Smartphone className="mr-1.5 h-4 w-4" /> Copy Field Link</Button>
          <input ref={fileRef} type="file" className="hidden" onChange={uploadSigned} accept="image/*,application/pdf" />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}><Upload className="mr-1.5 h-4 w-4" /> Upload Signed Copy</Button>
        </div>

        {/* Work details */}
        <div className="rounded-md border bg-card p-4 text-sm">
          <div className="grid gap-1 sm:grid-cols-2">
            <Detail label="Service Type" value={workOrder.serviceType} />
            <Detail label="Assigned To" value={workOrder.assignedTo || "—"} />
            <Detail label="Estimated Cost" value={fmtMoney(workOrder.estimatedCost)} />
            <Detail label="Priority" value={workOrder.priority.toUpperCase()} />
            <div className="sm:col-span-2"><Detail label="Description" value={workOrder.description || "—"} /></div>
          </div>
          {workOrder.signedDocUrl && (
            <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">✓ A signed copy is stored on file.</p>
          )}
        </div>

        {/* Mechanic checklist */}
        <div className="grid gap-3">
          <h4 className="text-sm font-semibold">Mechanic Completion Checklist</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Work completed on</Label>
              <Input type="date" value={completedDate} onChange={e => setCompletedDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Actual cost ($)</Label>
              <Input type="number" min={0} step="0.01" value={actualCost} onChange={e => setActualCost(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Parts used</Label>
            <Textarea rows={2} value={partsUsed} onChange={e => setPartsUsed(e.target.value)} placeholder="What was installed" />
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={completionNotes} onChange={e => setCompletionNotes(e.target.value)} placeholder="Condition of vehicle, issues found" />
          </div>
          <div className="grid gap-1.5">
            <Label>Mechanic signature</Label>
            {showMechSig || mechanicSig ? (
              <SignaturePad value={mechanicSig ?? undefined} onChange={setMechanicSig} height={120} />
            ) : (
              <Button variant="outline" size="sm" className="w-fit" onClick={() => setShowMechSig(true)}>
                <PenLine className="mr-1.5 h-4 w-4" /> Add Mechanic Signature
              </Button>
            )}
          </div>
        </div>

        {/* Admin sign-off */}
        <div className="grid gap-3 border-t pt-3">
          <h4 className="text-sm font-semibold">Admin Sign-Off</h4>
          <div className="grid gap-1.5">
            <Label>Reviewed by</Label>
            <Input value={reviewedBy} onChange={e => setReviewedBy(e.target.value)} placeholder="Admin name" />
          </div>
          <div className="grid gap-1.5">
            <Label>Admin signature</Label>
            {showAdminSig || adminSig ? (
              <SignaturePad value={adminSig ?? undefined} onChange={setAdminSig} height={120} />
            ) : (
              <Button variant="outline" size="sm" className="w-fit" onClick={() => setShowAdminSig(true)}>
                <PenLine className="mr-1.5 h-4 w-4" /> Add Admin Signature
              </Button>
            )}
          </div>
          <Button onClick={saveCompletion} disabled={busy} className="w-fit">Save Work Order</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div><span className="text-muted-foreground">{label}: </span><span className="font-medium whitespace-pre-line">{value}</span></div>
  );
}