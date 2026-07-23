import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { updateVehicle, deleteVehicle, isVehicleBookable, uploadVehiclePhoto, updateVehicleImage } from "@/lib/mock/store";
import type { Vehicle, VehicleStatus } from "@/lib/mock/data";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { syncVehicleAvailability } from "@/lib/ghl-vehicle-sync.functions";

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
  const syncVehicleAvailabilityFn = useServerFn(syncVehicleAvailability);
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
  const [color, setColor] = useState("");
  const [transmission, setTransmission] = useState<"Automatic" | "Manual" | "CVT" | "Other">("Automatic");
  const [fuelType, setFuelType] = useState<"Gas" | "Hybrid" | "Diesel" | "Electric">("Gas");
  const [seats, setSeats] = useState<string>("");
  const [fuelLevelPickup, setFuelLevelPickup] = useState<"Full" | "3/4" | "1/2" | "1/4" | "Empty">("Full");
  const [ezPassTag, setEzPassTag] = useState("");
  const [registrationExpiry, setRegistrationExpiry] = useState("");
  const [insuranceExpiry, setInsuranceExpiry] = useState("");
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
    setColor(vehicle.color ?? "");
    setTransmission((vehicle.transmission as typeof transmission) ?? "Automatic");
    setFuelType((vehicle.fuelType as typeof fuelType) ?? "Gas");
    setSeats(vehicle.seats != null ? String(vehicle.seats) : "");
    setFuelLevelPickup((vehicle.fuelLevelPickup as typeof fuelLevelPickup) ?? "Full");
    setEzPassTag(vehicle.ezPassTag ?? "");
    setRegistrationExpiry(vehicle.registrationExpiry ?? "");
    setInsuranceExpiry(vehicle.insuranceExpiry ?? "");
    setPhotoFile(null);
  }, [open, vehicle]);

  if (!vehicle) return null;

  const hasActiveRental = !isVehicleBookable(vehicle.id);

  async function save() {
    if (!vehicle) return;
    if (!make.trim() || !model.trim() || !plate.trim()) {
      toast.error("Make, model, and plate are required");
      return;
    }
    setSaving(true);
    try {
      const previousStatus = vehicle.status;
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
        color: color.trim() || undefined,
        transmission,
        fuelType,
        seats: Number(seats) || undefined,
        fuelLevelPickup,
        ezPassTag: ezPassTag.trim() || undefined,
        registrationExpiry: registrationExpiry || undefined,
        insuranceExpiry: insuranceExpiry || undefined,
      });
      if (photoFile) {
        const url = await uploadVehiclePhoto(vehicle.id, photoFile);
        await updateVehicleImage(vehicle.id, url);
      }
      if (status !== previousStatus) {
        try {
          const syncResult = await syncVehicleAvailabilityFn({ data: { vehicleId: vehicle.id } });
          if (syncResult.skipped || !syncResult.ok) {
            console.warn("[ghl-sync] vehicle availability sync did not complete", syncResult);
          }
        } catch (err) {
          console.error("[ghl-sync] failed from EditVehicleDialog", err);
        }
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
      <DialogContent className="flex max-h-[90vh] max-w-xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-3">
          <DialogTitle className="text-base">Edit vehicle · {vehicle.id}</DialogTitle>
        </DialogHeader>
        <div className="grid flex-1 gap-3 overflow-y-auto px-6 py-4 sm:grid-cols-2">
          <div><Label>Make *</Label><Input value={make} onChange={e => setMake(e.target.value)} /></div>
          <div><Label>Model *</Label><Input value={model} onChange={e => setModel(e.target.value)} /></div>
          <div><Label>Year</Label><Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} /></div>
          <div><Label>Color</Label><Input value={color} onChange={e => setColor(e.target.value)} placeholder="Silver" /></div>
          <div><Label>Plate *</Label><Input value={plate} onChange={e => setPlate(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>VIN</Label><Input value={vin} onChange={e => setVin(e.target.value)} /></div>
          <div><Label>Mileage</Label><Input type="number" inputMode="numeric" value={mileage} onChange={e => setMileage(e.target.value)} /></div>
          <div><Label>Seats</Label><Input type="number" inputMode="numeric" value={seats} onChange={e => setSeats(e.target.value)} /></div>
          <div>
            <Label>Transmission</Label>
            <Select value={transmission} onValueChange={(v) => setTransmission(v as typeof transmission)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Automatic">Automatic</SelectItem>
                <SelectItem value="Manual">Manual</SelectItem>
                <SelectItem value="CVT">CVT</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fuel type</Label>
            <Select value={fuelType} onValueChange={(v) => setFuelType(v as typeof fuelType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Gas">Gas</SelectItem>
                <SelectItem value="Hybrid">Hybrid</SelectItem>
                <SelectItem value="Diesel">Diesel</SelectItem>
                <SelectItem value="Electric">Electric</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fuel level at pickup</Label>
            <Select value={fuelLevelPickup} onValueChange={(v) => setFuelLevelPickup(v as typeof fuelLevelPickup)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Full">Full</SelectItem>
                <SelectItem value="3/4">3/4</SelectItem>
                <SelectItem value="1/2">1/2</SelectItem>
                <SelectItem value="1/4">1/4</SelectItem>
                <SelectItem value="Empty">Empty</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>EZ-Pass tag #</Label><Input value={ezPassTag} onChange={e => setEzPassTag(e.target.value)} /></div>
          <div><Label>Registration expiry</Label><Input type="date" value={registrationExpiry} onChange={e => setRegistrationExpiry(e.target.value)} /></div>
          <div><Label>Insurance expiry</Label><Input type="date" value={insuranceExpiry} onChange={e => setInsuranceExpiry(e.target.value)} /></div>
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
        <DialogFooter className="flex-col-reverse gap-2 border-t bg-background px-6 py-3 sm:flex-row sm:justify-between">
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