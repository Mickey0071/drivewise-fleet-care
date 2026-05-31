import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { updateMaintenance } from "@/lib/mock/store";
import { vehicleById, fmtDate, type Maintenance } from "@/lib/mock/data";
import { useAuth } from "@/hooks/use-auth";
import { EditTicketCostsDialog } from "@/components/app/EditTicketCostsDialog";
import { Pencil } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record: Maintenance | null;
}

export function ResolveMaintenanceDialog({ open, onOpenChange, record }: Props) {
  const { user } = useAuth();
  const defaultName = user?.email ?? "";
  const today = new Date().toISOString().slice(0, 10);

  const [whatFixed, setWhatFixed] = useState("");
  const [cost, setCost] = useState("");
  const [dateCompleted, setDateCompleted] = useState(today);
  const [completedBy, setCompletedBy] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [editCostsOpen, setEditCostsOpen] = useState(false);

  const vendorName = record?.vendor?.trim() || defaultName;

  useEffect(() => {
    if (!open) return;
    setWhatFixed("");
    setCost("");
    setDateCompleted(today);
    setCompletedBy(vendorName);
    setSaving(false);
  }, [open, vendorName, today]);

  if (!record) return null;
  const v = vehicleById(record.vehicleId);

  const submit = () => {
    if (!whatFixed.trim()) return toast.error("Please describe what was fixed");
    if (!completedBy.trim()) return toast.error("Completed by is required");
    const costNum = cost.trim() === "" ? 0 : Number(cost);
    if (!Number.isFinite(costNum) || costNum < 0) return toast.error("Enter a valid cost");

    const resolution =
      `Resolved ${dateCompleted} by ${completedBy.trim()}: ${whatFixed.trim()}` +
      (costNum > 0 ? ` (cost $${costNum.toFixed(2)})` : "");
    const nextNotes = record.notes ? `${record.notes}\n\n${resolution}` : resolution;

    setSaving(true);
    updateMaintenance(record.id, {
      dateCompleted,
      cost: costNum,
      completedBy: completedBy.trim(),
      vendor: record.vendor?.trim() ? record.vendor : completedBy.trim(),
      notes: nextNotes,
    });
    toast.success("Issue marked as resolved");
    onOpenChange(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mark issue as resolved</DialogTitle>
          <DialogDescription>
            {v ? `${v.year} ${v.make} ${v.model} · ${v.plate}` : record.vehicleId}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium">{record.serviceType}</div>
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => setEditCostsOpen(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit Costs
            </Button>
          </div>
          {record.notes && (
            <div className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{record.notes}</div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            Opened {fmtDate(record.createdAt?.slice(0, 10))}
          </div>
        </div>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>What was fixed? *</Label>
            <Textarea
              rows={3}
              value={whatFixed}
              onChange={(e) => setWhatFixed(e.target.value)}
              placeholder="e.g. Replaced front brake pads and rotors"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Cost of repair ($)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Date completed</Label>
              <Input
                type="date"
                value={dateCompleted}
                onChange={(e) => setDateCompleted(e.target.value)}
              />
            </div>
            <div className="col-span-2 grid gap-1.5">
              <Label>Completed by *</Label>
              <Input
                value={completedBy}
                onChange={(e) => setCompletedBy(e.target.value)}
                placeholder="Your name"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Mark as Resolved"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
      <EditTicketCostsDialog open={editCostsOpen} onOpenChange={setEditCostsOpen} record={record} />
    </>
  );
}