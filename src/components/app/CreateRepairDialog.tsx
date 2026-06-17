import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProblemCategorySelect } from "@/components/app/ProblemCategorySelect";
import { vehicles, fmtMoney, type RepairSolution } from "@/lib/mock/data";
import { createRepair } from "@/lib/mock/store";
import { sendNewRepairAlert } from "@/lib/repair-alert.functions";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialVehicleId?: string;
  lockVehicle?: boolean;
}

interface IssueRow {
  key: string;
  issue: string;
  partsCost: string;
  laborCost: string;
}

function emptyRow(): IssueRow {
  return { key: Math.random().toString(36).slice(2), issue: "", partsCost: "", laborCost: "" };
}

export function CreateRepairDialog({ open, onOpenChange, initialVehicleId, lockVehicle }: Props) {
  const [vehicleId, setVehicleId] = useState(initialVehicleId ?? "");
  const [rows, setRows] = useState<IssueRow[]>([emptyRow()]);
  const [category, setCategory] = useState("");

  const lockedVehicle = lockVehicle && initialVehicleId ? vehicles.find(x => x.id === initialVehicleId) : undefined;

  const reset = () => {
    setVehicleId(initialVehicleId ?? "");
    setRows([emptyRow()]);
    setCategory("");
  };

  const totalOf = (r: IssueRow) => (Number(r.partsCost) || 0) + (Number(r.laborCost) || 0);
  const grandTotal = rows.reduce((s, r) => s + totalOf(r), 0);
  const update = (key: string, patch: Partial<IssueRow>) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const submit = () => {
    if (!vehicleId) return toast.error("Select a vehicle");
    if (!category) return toast.error("Select a problem category");
    const valid = rows.filter(r => r.issue.trim());
    if (valid.length === 0) return toast.error("Add at least one issue");
    const issueDescription = valid.map(r => r.issue.trim()).join("; ");
    const solutions: RepairSolution[] = valid.map(r => ({
      name: r.issue.trim(),
      partsCost: Number(r.partsCost) || 0,
      laborCost: Number(r.laborCost) || 0,
      totalCost: totalOf(r),
    }));
    const rec = createRepair({ vehicleId, issueDescription, solutions, problemCategory: category });
    toast.success(`Repair ${rec.id} created`);
    const v = vehicles.find(x => x.id === vehicleId);
    const vehicleLabel = v ? `${v.year} ${v.make} ${v.model}` : vehicleId;
    // Fire-and-forget real-time admin alert for the new issue.
    sendNewRepairAlert({ data: { vehicle: vehicleLabel, issue: issueDescription } }).catch(() => {});
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New repair</DialogTitle>
          <DialogDescription>Log an issue with one or more solution options. It will appear in the Open column.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Vehicle</Label>
            {lockedVehicle ? (
              <Input value={`${lockedVehicle.year} ${lockedVehicle.make} ${lockedVehicle.model} · ${lockedVehicle.plate}`} readOnly disabled />
            ) : (
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                <SelectContent>
                  {vehicles.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.year} {v.make} {v.model} · {v.plate}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-2">
            <Label>Issues</Label>
            {rows.map((r, i) => (
              <div key={r.key} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Issue {i + 1}</span>
                  {rows.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                      onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid gap-2">
                  <Textarea rows={2} value={r.issue} onChange={e => update(r.key, { issue: e.target.value })} placeholder="Describe the issue (e.g. Grinding noise from front brakes)" />
                  <div className="grid grid-cols-3 gap-2">
                    <div className="grid gap-1">
                      <Label className="text-xs">Part ($)</Label>
                      <Input type="number" min={0} step="0.01" value={r.partsCost} onChange={e => update(r.key, { partsCost: e.target.value })} placeholder="0" />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Labor ($)</Label>
                      <Input type="number" min={0} step="0.01" value={r.laborCost} onChange={e => update(r.key, { laborCost: e.target.value })} placeholder="0" />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Amount</Label>
                      <Input value={fmtMoney(totalOf(r))} readOnly disabled />
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setRows(rs => [...rs, emptyRow()])}>
              <Plus className="mr-1 h-4 w-4" /> Add another issue
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3 text-sm">
            <span className="text-muted-foreground">Total amount</span>
            <span className="font-semibold">{fmtMoney(grandTotal)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>Create Repair</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}