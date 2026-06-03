import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { vehicles } from "@/lib/mock/data";
import { reportIssue } from "@/lib/mock/store";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialVehicleId?: string;
  lockVehicle?: boolean;
}

export function ReportIssueDialog({ open, onOpenChange, initialVehicleId, lockVehicle }: Props) {
  const [vehicleId, setVehicleId] = useState(initialVehicleId ?? "");
  const [issue, setIssue] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");

  const lockedVehicle = lockVehicle && initialVehicleId ? vehicles.find(x => x.id === initialVehicleId) : undefined;

  const reset = () => {
    setVehicleId(initialVehicleId ?? "");
    setIssue("");
    setCustomerNotes("");
  };

  const submit = () => {
    if (!vehicleId) return toast.error("Select a vehicle");
    if (!issue.trim()) return toast.error("Describe the issue");
    const rec = reportIssue({ vehicleId, issueDescription: issue.trim(), customerNotes });
    toast.success(`Issue ${rec.id} reported — vehicle marked unavailable`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report issue</DialogTitle>
          <DialogDescription>Log a customer-reported issue. Diagnosis and costs can be added later.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Vehicle</Label>
            {lockedVehicle ? (
              <input className="hidden" readOnly value={lockedVehicle.id} />
            ) : null}
            {lockedVehicle ? (
              <div className="rounded-md border border-input px-3 py-2 text-sm text-muted-foreground">
                {lockedVehicle.year} {lockedVehicle.make} {lockedVehicle.model} · {lockedVehicle.plate}
              </div>
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

          <div className="grid gap-1.5">
            <Label>Issue (what customer reported)</Label>
            <Textarea rows={2} value={issue} onChange={e => setIssue(e.target.value)} placeholder="e.g. Car won't start" />
          </div>

          <div className="grid gap-1.5">
            <Label>Customer notes (optional)</Label>
            <Textarea rows={3} value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} placeholder="e.g. Customer says battery light was on" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>Save Issue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}