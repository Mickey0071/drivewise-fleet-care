import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { vehicles, fmtMoney } from "@/lib/mock/data";
import { carImage } from "@/lib/mock/carImages";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addVehicle, useStoreVersion } from "@/lib/mock/store";
import { toast } from "sonner";

export const Route = createFileRoute("/fleet")({
  head: () => ({ meta: [{ title: "Fleet — Camauto Rentals" }] }),
  component: FleetPage,
});

function FleetPage() {
  useStoreVersion();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader
        title="Fleet Manager"
        subtitle={`${vehicles.length} vehicles in service`}
        action={<Button onClick={() => setOpen(true)}>+ Add Vehicle</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vehicles.map(v => (
          <Link key={v.id} to="/fleet/$vehicleId" params={{ vehicleId: v.id }}>
            <Card className="transition-all hover:border-primary hover:shadow-md">
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-xl bg-muted">
                <img
                  src={carImage(v.model)}
                  alt={`${v.year} ${v.make} ${v.model}`}
                  loading="lazy"
                  width={800}
                  height={512}
                  className="h-full w-full object-cover"
                />
                <div className="absolute right-2 top-2">
                  <StatusBadge status={v.status} />
                </div>
              </div>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{v.id} · Tag #{v.plate}</div>
                    <div className="mt-0.5 font-semibold">{v.year} {v.make} {v.model}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{v.mileage.toLocaleString()} mi</span>
                  <span className="font-medium">{fmtMoney(v.weeklyRate)}/wk</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">Risk tier {v.riskTier}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <AddVehicleDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function AddVehicleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [mileage, setMileage] = useState<number>(0);
  const [dailyRate, setDailyRate] = useState<number>(75);
  const [weeklyRate, setWeeklyRate] = useState<number>(450);
  const [riskTier, setRiskTier] = useState<"A" | "B" | "C">("A");

  function reset() {
    setMake(""); setModel(""); setYear(new Date().getFullYear()); setVin(""); setPlate("");
    setMileage(0); setDailyRate(75); setWeeklyRate(450); setRiskTier("A");
  }
  function save() {
    if (!make || !model || !plate) { toast.error("Make, model, and plate are required"); return; }
    const v = addVehicle({ make, model, year, vin, plate, mileage, dailyRate, weeklyRate, riskTier });
    toast.success("Vehicle added", { description: `${v.year} ${v.make} ${v.model} (${v.id})` });
    reset(); onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add vehicle</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Make *</Label><Input value={make} onChange={e => setMake(e.target.value)} placeholder="Toyota" /></div>
          <div><Label>Model *</Label><Input value={model} onChange={e => setModel(e.target.value)} placeholder="Camry" /></div>
          <div><Label>Year</Label><Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} /></div>
          <div><Label>Plate *</Label><Input value={plate} onChange={e => setPlate(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>VIN</Label><Input value={vin} onChange={e => setVin(e.target.value)} /></div>
          <div><Label>Mileage</Label><Input type="number" value={mileage} onChange={e => setMileage(Number(e.target.value))} /></div>
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
          <div><Label>Daily rate ($)</Label><Input type="number" value={dailyRate} onChange={e => setDailyRate(Number(e.target.value))} /></div>
          <div><Label>Weekly rate ($)</Label><Input type="number" value={weeklyRate} onChange={e => setWeeklyRate(Number(e.target.value))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={save}>Add vehicle</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
