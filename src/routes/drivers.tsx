import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { drivers, rentals, payments, vehicleById, fmtDate } from "@/lib/mock/data";
import { AlertCircle, Ban, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDriver, useStoreVersion } from "@/lib/mock/store";
import { updateDriver } from "@/lib/mock/store";
import { rentalPastDueDays } from "@/lib/mock/store";
import type { Driver } from "@/lib/mock/data";
import { toast } from "sonner";
import { US_STATES, formatAddressBlock, formatFullName } from "@/lib/us-states";
import { RenterDetailDialog } from "@/components/app/RenterDetailDialog";

export const Route = createFileRoute("/drivers")({
  head: () => ({ meta: [{ title: "Renters — Camauto Rentals" }] }),
  component: DriversPage,
});

function DriversPage() {
  useStoreVersion();
  const [open, setOpen] = useState(false);
  const [editDriver, setEditDriver] = useState<Driver | null>(null);
  const [blockDriver, setBlockDriver] = useState<Driver | null>(null);
  const [detailDriver, setDetailDriver] = useState<Driver | null>(null);
  const [query, setQuery] = useState("");
  const today = new Date();
  const soon = new Date(today); soon.setDate(today.getDate() + 60);

  const normalizedQuery = query.trim().toLowerCase();
  const digitsQuery = query.replace(/\D/g, "");
  const filteredDrivers = drivers.filter((d) => {
    if (!normalizedQuery) return true;
    const nameMatch = d.fullName.toLowerCase().includes(normalizedQuery);
    const phoneDigits = (d.phone ?? "").replace(/\D/g, "");
    const phoneMatch = digitsQuery.length > 0 && phoneDigits.includes(digitsQuery);
    return nameMatch || phoneMatch;
  });

  return (
    <div>
      <PageHeader
        title="Renter Management"
        subtitle={`${drivers.length} renters · ${drivers.filter(d => d.status === "active").length} active`}
        action={<Button onClick={() => setOpen(true)}>+ Add Renter</Button>}
      />
      <div className="mb-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search renters by name or phone number…"
          aria-label="Search renters by name or phone number"
        />
      </div>
      <div className="space-y-2">
        {filteredDrivers.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No renters match “{query}”.
          </p>
        )}
        {filteredDrivers.map(d => {
          const rental = rentals.find(r => r.driverId === d.id);
          const veh = rental ? vehicleById(rental.vehicleId) : null;
          // Late only when an active rental's current period is past due (canonical engine).
          const lateCount = rentals.filter(
            r => r.driverId === d.id
              && (r.reservationStatus ?? "active") === "active"
              && rentalPastDueDays(r) > 0,
          ).length;
          const expSoon = new Date(d.licenseExpiry) < soon;

          return (
            <Card key={d.id} className={`transition-colors hover:border-primary/50 ${d.blocked ? "border-destructive/60" : ""}`}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDetailDriver(d)}
                      className="rounded font-semibold text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title="View renter details"
                    >
                      {d.fullName}
                    </button>
                    <StatusBadge status={d.status} />
                    {d.blocked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                        <Ban className="h-3 w-3" /> Blocked from renting
                      </span>
                    )}
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
                  {d.blocked && d.blockReason && (
                    <div className="mt-1 text-xs font-medium text-destructive">Reason: {d.blockReason}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {lateCount > 0 && <StatusBadge status="late" />}
                  <Button
                    variant={d.blocked ? "outline" : "destructive"}
                    size="sm"
                    onClick={() => setBlockDriver(d)}
                  >
                    {d.blocked ? <><ShieldCheck className="h-4 w-4" /> Unblock</> : <><Ban className="h-4 w-4" /> Block</>}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditDriver(d)}>Edit</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <AddRenterDialog open={open} onClose={() => setOpen(false)} />
      <EditRenterDialog driver={editDriver} onClose={() => setEditDriver(null)} />
      <BlockRenterDialog driver={blockDriver} onClose={() => setBlockDriver(null)} />
      <RenterDetailDialog driver={detailDriver} onClose={() => setDetailDriver(null)} />
    </div>
  );
}

function EditRenterDialog({ driver, onClose }: { driver: Driver | null; onClose: () => void }) {
  return <EditRenterInner driver={driver} onClose={onClose} />;
}

function BlockRenterDialog({ driver, onClose }: { driver: Driver | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const open = !!driver;
  const isBlocked = !!driver?.blocked;

  useEffect(() => {
    if (driver) setReason(driver.blockReason ?? "");
  }, [driver]);

  async function submit() {
    if (!driver) return;
    if (!isBlocked && !reason.trim()) { toast.error("A reason is required to block a renter"); return; }
    setSaving(true);
    try {
      if (isBlocked) {
        await updateDriver(driver.id, { blocked: false, blockReason: undefined, blockedAt: undefined });
        toast.success(`${driver.fullName} can rent again`);
      } else {
        await updateDriver(driver.id, { blocked: true, blockReason: reason.trim(), blockedAt: new Date().toISOString() });
        toast.success(`${driver.fullName} blocked from renting`);
      }
      onClose();
    } catch (e: any) {
      toast.error("Update failed", { description: e?.message ?? "Try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isBlocked ? `Unblock ${driver?.fullName}?` : `Block ${driver?.fullName} from renting`}</DialogTitle>
        </DialogHeader>
        {isBlocked ? (
          <div className="space-y-2 text-sm">
            <p>This renter is currently blocked from new rentals.</p>
            {driver?.blockReason && <p className="text-muted-foreground">Reason: {driver.blockReason}</p>}
            <p>Unblocking will allow them to be added to new reservations again.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label>Reason *</Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Unpaid balance"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">A blocked renter cannot be added to new reservations until unblocked.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant={isBlocked ? "default" : "destructive"} onClick={submit} disabled={saving}>
            {saving ? "Saving…" : isBlocked ? "Unblock renter" : "Block renter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditRenterInner({ driver, onClose }: { driver: Driver | null; onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const open = !!driver;
  useEffect(() => {
    if (driver) {
      setPhone(driver.phone ?? "");
      setEmail(driver.email ?? "");
    }
  }, [driver]);

  async function save() {
    if (!driver) return;
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    if (!trimmedPhone) { toast.error("Phone is required"); return; }
    if (!/^\+?[1-9]\d{6,14}$/.test(trimmedPhone.replace(/[\s().-]/g, ""))) {
      toast.error("Phone must be E.164 format (e.g. +12675551234)"); return;
    }
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error("Invalid email"); return;
    }
    setSaving(true);
    try {
      await updateDriver(driver.id, { phone: trimmedPhone, email: trimmedEmail });
      toast.success("Renter updated");
      onClose();
    } catch (e: any) {
      toast.error("Update failed", { description: e?.message ?? "Try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {driver?.fullName ?? "renter"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Phone (E.164) *</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+12675551234" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function AddRenterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Personal
  const [firstName, setFirstName] = useState("");
  const [middleInitial, setMiddleInitial] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // License
  const [licenseNumber, setLicenseNumber] = useState("");
  const [dlState, setDlState] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  // Address
  const [streetAddress, setStreetAddress] = useState("");
  const [aptUnit, setAptUnit] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  // Alt contact
  const [altContactName, setAltContactName] = useState("");
  const [altContactPhone, setAltContactPhone] = useState("");
  // Rideshare (kept)
  const [rideshare, setRideshare] = useState<"Uber" | "Lyft" | "Both">("Uber");

  function reset() {
    setFirstName(""); setMiddleInitial(""); setLastName(""); setDateOfBirth("");
    setEmail(""); setPhone("");
    setLicenseNumber(""); setDlState(""); setLicenseExpiry("");
    setStreetAddress(""); setAptUnit(""); setCity(""); setState(""); setZipCode("");
    setAltContactName(""); setAltContactPhone("");
    setRideshare("Uber");
  }

  async function save() {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First and last name are required"); return;
    }
    if (!phone.trim()) { toast.error("Phone is required"); return; }
    if (phone && !/^\+?[1-9]\d{6,14}$/.test(phone.replace(/[\s().-]/g, ""))) {
      toast.error("Phone must be E.164 format (e.g. +12675551234)"); return;
    }
    const fullName = formatFullName({ firstName, middleInitial, lastName });
    const address = formatAddressBlock({ streetAddress, aptUnit, city, state, zipCode });
    try {
      const d = addDriver({
        fullName, phone: phone.trim(), email: email.trim(),
        licenseNumber: licenseNumber.trim(),
        licenseExpiry: licenseExpiry || "2030-01-01",
        rideshare,
        dateOfBirth: dateOfBirth || undefined,
        address: address || undefined,
        firstName: firstName.trim(),
        middleInitial: middleInitial.trim() || undefined,
        lastName: lastName.trim(),
        dlState: dlState || undefined,
        streetAddress: streetAddress.trim() || undefined,
        aptUnit: aptUnit.trim() || undefined,
        city: city.trim() || undefined,
        state: state || undefined,
        zipCode: zipCode.trim() || undefined,
        altContactName: altContactName.trim() || undefined,
        altContactPhone: altContactPhone.trim() || undefined,
      });
      await (d as { cloudReady?: Promise<unknown> }).cloudReady;
      toast.success("Renter added", { description: `${d.fullName} (${d.id})` });
      reset(); onClose();
    } catch (e: any) {
      toast.error("Renter was not saved to cloud", { description: e?.message ?? "Try again" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Add renter</DialogTitle></DialogHeader>

        <Section title="Personal Info">
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-3"><Label>First name *</Label><Input value={firstName} onChange={e => setFirstName(e.target.value)} /></div>
            <div className="sm:col-span-1"><Label>M.I.</Label><Input maxLength={2} value={middleInitial} onChange={e => setMiddleInitial(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Last name *</Label><Input value={lastName} onChange={e => setLastName(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Date of birth</Label><Input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Phone (E.164) *</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+12675551234" /></div>
          </div>
        </Section>

        <Section title="License Info">
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-3"><Label>DL number</Label><Input value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} /></div>
            <div className="sm:col-span-1">
              <Label>DL state</Label>
              <Select value={dlState} onValueChange={setDlState}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => <SelectItem key={s.code} value={s.code}>{s.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2"><Label>DL expiration</Label><Input type="date" value={licenseExpiry} onChange={e => setLicenseExpiry(e.target.value)} /></div>
            <div className="sm:col-span-3">
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
        </Section>

        <Section title="Address & Alternate Contact">
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-4"><Label>Street address</Label><Input value={streetAddress} onChange={e => setStreetAddress(e.target.value)} placeholder="123 Main St" /></div>
            <div className="sm:col-span-2"><Label>Apt / Unit</Label><Input value={aptUnit} onChange={e => setAptUnit(e.target.value)} placeholder="4B" /></div>
            <div className="sm:col-span-3"><Label>City</Label><Input value={city} onChange={e => setCity(e.target.value)} /></div>
            <div className="sm:col-span-1">
              <Label>State</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => <SelectItem key={s.code} value={s.code}>{s.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2"><Label>ZIP</Label><Input value={zipCode} onChange={e => setZipCode(e.target.value)} placeholder="08081" /></div>
            <div className="sm:col-span-3"><Label>Alt contact name</Label><Input value={altContactName} onChange={e => setAltContactName(e.target.value)} /></div>
            <div className="sm:col-span-3"><Label>Alt contact phone</Label><Input value={altContactPhone} onChange={e => setAltContactPhone(e.target.value)} placeholder="+12675551234" /></div>
          </div>
        </Section>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={save}>Add renter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
