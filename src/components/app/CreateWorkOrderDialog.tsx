import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VendorCombobox } from "@/components/app/VendorCombobox";
import { addWorkOrder, useStoreVersion } from "@/lib/mock/store";
import type { Vehicle, WorkOrderPriority } from "@/lib/mock/data";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vehicle: Vehicle;
  onCreated?: (id: string) => void;
}

const SERVICE_TYPES = ["Oil Change", "Inspection", "Battery Check", "Alternator Check", "Other"];
const today = () => new Date().toISOString().slice(0, 10);

export function CreateWorkOrderDialog({ open, onOpenChange, vehicle, onCreated }: Props) {
  useStoreVersion();
  const [serviceType, setServiceType] = useState("Oil Change");
  const [customType, setCustomType] = useState("");
  const [scheduledDate, setScheduledDate] = useState(today());
  const [estimatedCost, setEstimatedCost] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState<WorkOrderPriority>("medium");

  const reset = () => {
    setServiceType("Oil Change");
    setCustomType("");
    setScheduledDate(today());
    setEstimatedCost("");
    setDescription("");
    setAssignedTo("");
    setPriority("medium");
  };

  const submit = () => {
    const finalType = serviceType === "Other" ? customType.trim() : serviceType;
    if (!finalType) return toast.error("Enter a service type");
    if (!scheduledDate) return toast.error("Pick a scheduled date");
    const rec = addWorkOrder({
      vehicleId: vehicle.id,
      serviceType: finalType,
      scheduledDate,
      estimatedCost: Number(estimatedCost) || 0,
      description: description.trim(),
      assignedTo: assignedTo.trim() || undefined,
      priority,
    });
    toast.success(`Created work order ${rec.id}`);
    reset();
    onOpenChange(false);
    onCreated?.(rec.id);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Maintenance Schedule</DialogTitle>
          <DialogDescription>Schedule a preventive maintenance work order for this vehicle.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Vehicle</Label>
            <Input value={`${vehicle.year} ${vehicle.make} ${vehicle.model} · ${vehicle.plate}`} readOnly disabled />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Service Type</Label>
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Scheduled Date</Label>
              <Input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
            </div>
          </div>

          {serviceType === "Other" && (
            <div className="grid gap-1.5">
              <Label>Custom Service Type</Label>
              <Input value={customType} onChange={e => setCustomType(e.target.value)} placeholder="e.g. Tire Rotation" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Estimated Cost ($)</Label>
              <Input type="number" min={0} step="0.01" value={estimatedCost}
                onChange={e => setEstimatedCost(e.target.value)} placeholder="0" />
            </div>
            <div className="grid gap-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as WorkOrderPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Assigned To (Mechanic / Vendor)</Label>
            <VendorCombobox value={assignedTo} onChange={setAssignedTo} />
          </div>

          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Replace oil and filter, check fluid levels" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>Create Work Order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}