import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { drivers, rentals, payments, vehicleById, fmtDate } from "@/lib/mock/data";
import { AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDriver, useStoreVersion } from "@/lib/mock/store";
import { toast } from "sonner";

export const Route = createFileRoute("/drivers")({
  head: () => ({ meta: [{ title: "Renters — Camauto Rentals" }] }),
  component: DriversPage,
});

function DriversPage() {
  useStoreVersion();
  const [open, setOpen] = useState(false);
  const today = new Date();
  const soon = new Date(today); soon.setDate(today.getDate() + 60);

  return (
    <div>
      <PageHeader
        title="Renter Management"
        subtitle={`${drivers.length} renters · ${drivers.filter(d => d.status === "active").length} active`}
        action={<Button onClick={() => setOpen(true)}>+ Add Renter</Button>}
      />
      <div className="space-y-2">
        {drivers.map(d => {
          const rental = rentals.find(r => r.driverId === d.id);
          const veh = rental ? vehicleById(rental.vehicleId) : null;
          const lateCount = payments.filter(p => p.driverId === d.id && p.status !== "paid").length;
          const expSoon = new Date(d.licenseExpiry) < soon;

          return (
            <Card key={d.id} className="transition-colors hover:border-primary/50">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold">{d.fullName}</div>
                    <StatusBadge status={d.status} />
                    {expSoon && (
                      <span className="inline-flex items-center gap-1 text-xs text-warning-foreground">
                        <AlertCircle className="h-3 w-3" /> License expires {fmtDate(d.licenseExpiry)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {d.id} · {d.phone} · {d.rideshare}
                    {veh && ` · Driving ${veh.year} ${veh.make} ${veh.model} (${veh.plate})`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {lateCount > 0 && <StatusBadge status="late" />}
                  <Button variant="outline" size="sm">View profile</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <AddRenterDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function AddRenterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [rideshare, setRideshare] = useState<"Uber" | "Lyft" | "Both">("Uber");

  function reset() {
    setFullName(""); setPhone(""); setEmail(""); setLicenseNumber(""); setLicenseExpiry(""); setRideshare("Uber");
  }
  function save() {
    if (!fullName || !phone) { toast.error("Name and phone are required"); return; }
    const d = addDriver({ fullName, phone, email, licenseNumber, licenseExpiry: licenseExpiry || "2030-01-01", rideshare });
    toast.success("Renter added", { description: `${d.fullName} (${d.id})` });
    reset(); onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add renter</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Full name *</Label><Input value={fullName} onChange={e => setFullName(e.target.value)} /></div>
          <div><Label>Phone *</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+12675551234" /></div>
          <div><Label>Email</Label><Input value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div><Label>License #</Label><Input value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} /></div>
          <div><Label>License expiry</Label><Input type="date" value={licenseExpiry} onChange={e => setLicenseExpiry(e.target.value)} /></div>
          <div className="sm:col-span-2">
            <Label>Rideshare</Label>
            <Select value={rideshare} onValueChange={(v) => setRideshare(v as "Uber" | "Lyft" | "Both")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Uber">Uber</SelectItem>
                <SelectItem value="Lyft">Lyft</SelectItem>
                <SelectItem value="Both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={save}>Add renter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
