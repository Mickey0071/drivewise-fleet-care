import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProblemCategorySelect } from "@/components/app/ProblemCategorySelect";
import { addMaintenance } from "@/lib/mock/store";
import { fmtMoney } from "@/lib/mock/data";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vehicleId: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function LogPastRepairDialog({ open, onOpenChange, vehicleId }: Props) {
  const [dateCompleted, setDateCompleted] = useState(today());
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [partsCost, setPartsCost] = useState("");
  const [laborCost, setLaborCost] = useState("");
  const [mileage, setMileage] = useState("");
  const [notes, setNotes] = useState("");

  const parts = Number(partsCost) || 0;
  const labor = Number(laborCost) || 0;
  const total = parts + labor;

  const reset = () => {
    setDateCompleted(today()); setCategory(""); setDescription("");
    setVendor(""); setPartsCost(""); setLaborCost(""); setMileage(""); setNotes("");
  };

  const submit = () => {
    if (!description.trim()) return toast.error("Description is required");
    if (!category) return toast.error("Select a problem category");
    if (!vendor.trim()) return toast.error("Vendor / mechanic is required");
    if (total <= 0) return toast.error("Enter parts and/or labor cost");
    const nowIso = new Date().toISOString();
    const rec = addMaintenance({
      vehicleId,
      serviceType: description.trim(),
      vendor: vendor.trim(),
      dateCompleted,
      completionDate: dateCompleted,
      status: "complete",
      issueDescription: description.trim(),
      problemCategory: category,
      partsCost: parts,
      laborCost: labor,
      cost: total,
      mileageAtService: Number(mileage) || 0,
      notes: notes.trim() || undefined,
      historyPostedAt: nowIso,
      completedBy: vendor.trim(),
    });
    toast.success(`Repair ${rec.id} logged to history`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log past repair</DialogTitle>
          <DialogDescription>
            Record a repair that's already been done. Posts directly to repair history and expenses — no ticket or mechanic dispatch.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Front brake pads & rotors" />
          </div>
          <div className="grid gap-1.5">
            <Label>Problem category</Label>
            <ProblemCategorySelect value={category} onChange={setCategory} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Vendor / mechanic</Label>
              <Input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. Midas" />
            </div>
            <div className="grid gap-1.5">
              <Label>Date completed</Label>
              <Input type="date" value={dateCompleted} onChange={e => setDateCompleted(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Parts ($)</Label>
              <Input type="number" min={0} step="0.01" value={partsCost} onChange={e => setPartsCost(e.target.value)} placeholder="0" />
            </div>
            <div className="grid gap-1.5">
              <Label>Labor ($)</Label>
              <Input type="number" min={0} step="0.01" value={laborCost} onChange={e => setLaborCost(e.target.value)} placeholder="0" />
            </div>
            <div className="grid gap-1.5">
              <Label>Total</Label>
              <Input value={fmtMoney(total)} readOnly disabled />
            </div>
            <div className="grid gap-1.5">
              <Label>Mileage (optional)</Label>
              <Input type="number" min={0} value={mileage} onChange={e => setMileage(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>Save to history</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}