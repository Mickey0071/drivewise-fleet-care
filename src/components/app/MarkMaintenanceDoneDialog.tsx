import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { markMaintenanceItemDone } from "@/lib/mock/store";
import type { ScheduledItem } from "@/lib/maintenance-utils";
import type { Vehicle } from "@/lib/mock/data";

export function MarkMaintenanceDoneDialog({
  open, onOpenChange, item, vehicle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ScheduledItem | null;
  vehicle: Vehicle | null;
}) {
  const [date, setDate] = useState("");
  const [mileage, setMileage] = useState("");
  const [cost, setCost] = useState("");
  const [role, setRole] = useState<"Admin" | "Mechanic" | "Runner">("Admin");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(new Date().toISOString().slice(0, 10));
    setMileage(vehicle ? String(vehicle.mileage) : "");
    setCost("");
    setRole("Admin");
    setName("");
    setNotes("");
  }, [open, vehicle]);

  if (!item || !vehicle) return null;

  async function save() {
    if (!item || !vehicle) return;
    setSaving(true);
    try {
      await markMaintenanceItemDone({
        vehicleId: vehicle.id,
        type: item.type,
        customId: item.customId,
        date,
        mileage: Number(mileage) || vehicle.mileage,
        cost: Number(cost) || 0,
        completedByRole: role,
        completedByName: name.trim() || role,
        notes: notes.trim() || undefined,
      });
      toast.success(`${item.label} marked complete`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {item.label} done</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="text-xs text-muted-foreground">
            {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.plate}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Date completed</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Mileage</Label>
              <Input type="number" inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Cost (optional)</Label>
            <Input type="number" inputMode="decimal" placeholder="0.00" value={cost} onChange={(e) => setCost(e.target.value)} />
            {Number(cost) > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Auto-logs as a Maintenance expense on this vehicle.
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">Completed by</Label>
            <RadioGroup value={role} onValueChange={(v) => setRole(v as "Admin" | "Mechanic" | "Runner")} className="mt-1 flex gap-4">
              {(["Admin", "Mechanic", "Runner"] as const).map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-sm">
                  <RadioGroupItem value={r} /> {r}
                </label>
              ))}
            </RadioGroup>
            <Input className="mt-2" placeholder={`${role} name (optional)`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Mark done"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}