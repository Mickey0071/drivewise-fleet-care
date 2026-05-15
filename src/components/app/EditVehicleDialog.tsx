import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { updateVehicle, deleteVehicle, uploadVehiclePhoto, updateVehicleImage } from "@/lib/mock/store";
import { rentals } from "@/lib/mock/data";
import type { Vehicle, VehicleStatus } from "@/lib/mock/data";
import { useNavigate } from "@tanstack/react-router";

export function EditVehicleDialog({
  vehicle,
  open,
  onOpenChange,
  onDeleted,
}: {
  vehicle: Vehicle | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeleted?: () => void;
}) {
  const navigate = useNavigate();
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [mileage, setMileage] = useState<string>("");
  const [dailyRate, setDailyRate] = useState<string>("");
  const [weeklyRate, setWeeklyRate] = useState<string>("");
  const [riskTier, setRiskTier] = useState<"A" | "B" | "C">("A");
  const [status, setStatus] = useState<VehicleStatus>("available");
  const [nextServiceDue, setNextServiceDue] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open || !vehicle) return;
    setMake(vehicle.make);
    setModel(vehicle.model);
    setYear(vehicle.year);
    setVin(vehicle.vin);
    setPlate(vehicle.plate);
    setMileage(String(vehicle.mileage ?? ""));
    setDailyRate(String(vehicle.dailyRate ?? ""));
    setWeeklyRate(String(vehicle.weeklyRate ?? ""));
    setRiskTier(vehicle.riskTier);
    setStatus(vehicle.status);
    setNextServiceDue(vehicle.nextServiceDue ?? "");
    setNotes(vehicle.notes ?? "");
    setPhotoFile(null);
  }, [open, vehicle]);

  if (!vehicle) return null;

  const hasActiveRental = rentals.some(r => r.vehicleId === vehicle.id && !r.endDate);

  async function save() {
    if (!vehicle) return;
    if (!make.trim() || !model.trim() || !plate.trim()) {
      toast.error("Make, model, and plate are required");
      return;
    }
    setSaving(true);
    try {
      await updateVehicle(vehicle.id, {
        make: make.trim(),
        model: model.trim(),
        year: Number(year) || vehicle.year,
        vin: vin.trim(),
        plate: plate.trim(),
        mileage: Number(mileage) || 0,
        dailyRate: Number(dailyRate) || 0,
        weeklyRate: Number(weeklyRate) || 0,
        riskTier,
        status,
        nextServiceDue: nextServiceDue || undefined,
        notes: notes.trim() || undefined,
      });
      if (photoFile) {
        const url = await uploadVehiclePhoto(vehicle.id, photoFile);
        await updateVehicleImage(vehicle.id, url);
      }
      toast.success("Vehicle updated");
      onOpenChange(false);
    } catch (e) {
      toast.error("Update failed", { description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!vehicle) return;
    if (hasActiveRental) {
      toast.error("Cannot delete — vehicle has an active rental");
      return;
    }
    if (!window.confirm(`Delete ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteVehicle(vehicle.id);
      toast.success("Vehicle deleted");
      onOpenChange(false);
      if (onDeleted) onDeleted();
      else navigate({ to: "/fleet" });
    } catch (e) {
      toast.error("Delete failed", { description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit vehicle · {vehicle.id}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Make *</Label><Input value={make} onChange={e => setMake(e.target.value)} /></div>
          <div><Label>Model *</Label><Input value={model} onChange={e => setModel(e.target.value)} /></div>
          <div><Label>Year</Label><Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} /></div>
          <div><Label>Plate *</Label><Input value={plate} onChange={e => setPlate(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>VIN</Label><Input value={vin} onChange={e => setVin(e.target.value)} /></div>
          <div><Label>Mileage</Label><Input type="number" inputMode="numeric" value={mileage} onChange={e => setMileage(e.target.value)} /></div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as VehicleStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="rented">Rented</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="impound">Impound</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Daily rate ($)</Label><Input type="number" inputMode="decimal" value={dailyRate} onChange={e => setDailyRate(e.target.value)} /></div>
          <div><Label>Weekly rate ($)</Label><Input type="number" inputMode="decimal" value={weeklyRate} onChange={e => setWeeklyRate(e.target.value)} /></div>
          <div>
            <Label>Risk tier</Label>
            <Select value={riskTier} onValueChange={(v) => setRiskTier(v as "A" | "B" | "C")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="A">A</SelectItem>
                <SelectItem value="B">B</SelectItem>
                <SelectItem value="C">C</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Next service due</Label><Input type="date" value={nextServiceDue} onChange={e => setNextServiceDue(e.target.value)} /></div>
          <div className="sm:col-span-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="sm:col-span-2">
            <Label>Replace photo</Label>
            <Input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
            {photoFile && <p className="mt-1 text-xs text-muted-foreground">Will upload {photoFile.name} on save.</p>}
          </div>
        </div>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting || saving || hasActiveRental}
            title={hasActiveRental ? "Vehicle has an active rental" : "Delete vehicle"}
          >
            {deleting ? "Deleting…" : "Delete vehicle"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}