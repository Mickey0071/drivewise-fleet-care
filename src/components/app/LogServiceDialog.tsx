import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { vehicles } from "@/lib/mock/data";
import { addMaintenance, useStoreVersion } from "@/lib/mock/store";
import { ServiceTypeCombobox } from "@/components/app/ServiceTypeCombobox";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialVehicleId?: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export function LogServiceDialog({ open, onOpenChange, initialVehicleId }: Props) {
  useStoreVersion();
  const [vehicleId, setVehicleId] = useState<string>(initialVehicleId ?? "");
  const [serviceType, setServiceType] = useState("");
  const [vendor, setVendor] = useState("");
  const [dateCompleted, setDateCompleted] = useState(today());
  const [completedBy, setCompletedBy] = useState("");
  const [mileage, setMileage] = useState<string>("");
  const [cost, setCost] = useState<string>("");
  const [nextServiceDue, setNextServiceDue] = useState(plusDays(90));
  const [notes, setNotes] = useState("");

  const reset = () => {
    setVehicleId(initialVehicleId ?? "");
    setServiceType(""); setVendor(""); setDateCompleted(today());
    setMileage(""); setCost(""); setNextServiceDue(plusDays(90)); setNotes(""); setCompletedBy("");
  };

  const submit = () => {
    if (!vehicleId) return toast.error("Select a vehicle");
    const resolvedType = serviceType.trim();
    if (!resolvedType) return toast.error("Service type is required");
    if (!vendor.trim()) return toast.error("Vendor is required");
    const costNum = Number(cost);
    const mileageNum = Number(mileage);
    if (!Number.isFinite(costNum) || costNum < 0) return toast.error("Valid cost required");
    if (!Number.isFinite(mileageNum) || mileageNum < 0) return toast.error("Valid mileage required");
    const rec = addMaintenance({
      vehicleId,
      serviceType: resolvedType,
      vendor: vendor.trim(),
      dateCompleted,
      mileageAtService: mileageNum,
      cost: costNum,
      nextServiceDue,
      notes: notes.trim() || undefined,
      completedBy: completedBy.trim() || undefined,
    });
    toast.success(`Logged ${rec.id}`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log service</DialogTitle>
          <DialogDescription>Record a maintenance event for a vehicle.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Vehicle</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
              <SelectContent>
                {vehicles.map(v => (
                  <SelectItem key={v.id} value={v.id}>{v.year} {v.make} {v.model} · {v.plate}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Service type</Label>
            <ServiceTypeCombobox value={serviceType} onChange={setServiceType} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Vendor</Label>
              <Input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. Midas" />
            </div>
            <div className="grid gap-1.5">
              <Label>Date completed</Label>
              <Input type="date" value={dateCompleted} onChange={e => setDateCompleted(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Mileage</Label>
              <Input type="number" min={0} value={mileage} onChange={e => setMileage(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Cost ($)</Label>
              <Input type="number" min={0} step="0.01" value={cost} onChange={e => setCost(e.target.value)} />
            </div>
            <div className="col-span-2 grid gap-1.5">
              <Label>Completed by</Label>
              <Input value={completedBy} onChange={e => setCompletedBy(e.target.value)} placeholder="e.g. JR" />
            </div>
            <div className="col-span-2 grid gap-1.5">
              <Label>Next service due</Label>
              <Input type="date" value={nextServiceDue} onChange={e => setNextServiceDue(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}