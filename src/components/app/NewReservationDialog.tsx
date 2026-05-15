import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { vehicles, drivers, vehicleById, fmtMoney, fmtDate } from "@/lib/mock/data";
import { addRental, hasConflict, addDriver, getActiveRentalForDriver, markReturned, useStoreVersion } from "@/lib/mock/store";
import { useServerFn } from "@tanstack/react-start";
import { sendSigningLink } from "@/lib/sign.functions";
import { Check, ArrowLeft, ArrowRight, Car, User, CalendarDays, ClipboardCheck, Search, UserPlus, Repeat, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STEPS = ["Vehicle", "Client", "Dates", "Review"] as const;
type Step = 0 | 1 | 2 | 3;

type BillingPeriod = "daily" | "weekly" | "monthly";
function rateSuffix(p: BillingPeriod) { return p === "daily" ? "day" : p === "weekly" ? "wk" : "mo"; }
function defaultRate(v: { dailyRate: number; weeklyRate: number }, p: BillingPeriod) {
  if (p === "daily") return v.dailyRate;
  if (p === "weekly") return v.weeklyRate;
  return Math.round(v.weeklyRate * 4.345);
}
function toWeekly(rate: number, p: BillingPeriod) {
  if (p === "weekly") return rate;
  if (p === "daily") return Math.round(rate * 7);
  return Math.round(rate / 4.345);
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialVehicleId?: string;
}

export function NewReservationDialog({ open, onOpenChange, initialVehicleId }: Props) {
  useStoreVersion();
  const sendSignLinkFn = useServerFn(sendSigningLink);
  const [step, setStep] = useState<Step>(0);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [billingPeriod, setBillingPeriod] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [rate, setRate] = useState<number>(0);
  const [deposit, setDeposit] = useState<number>(300);
  const [notes, setNotes] = useState("");
  const [vehQ, setVehQ] = useState("");
  const [drvQ, setDrvQ] = useState("");
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [newDriver, setNewDriver] = useState({ fullName: "", phone: "", email: "", licenseNumber: "", rideshare: "Uber" as "Uber" | "Lyft" | "Both" });
  const [isSwap, setIsSwap] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && initialVehicleId) {
      setVehicleId(initialVehicleId);
      setStep(1);
    }
  }, [open, initialVehicleId]);

  const vehicle = vehicles.find(v => v.id === vehicleId) ?? null;
  const driver = drivers.find(d => d.id === driverId) ?? null;
  const existingRental = driver ? getActiveRentalForDriver(driver.id) : null;

  const availableVehicles = useMemo(
    () => vehicles.filter(v => v.status === "available" && (
      vehQ === "" ||
      `${v.year} ${v.make} ${v.model} ${v.plate}`.toLowerCase().includes(vehQ.toLowerCase())
    )),
    [vehQ]
  );

  const filteredDrivers = useMemo(
    () => drivers.filter(d => d.status !== "suspended" && (
      drvQ === "" ||
      `${d.fullName} ${d.email} ${d.phone}`.toLowerCase().includes(drvQ.toLowerCase())
    )),
    [drvQ]
  );

  function reset() {
    setStep(0); setVehicleId(null); setDriverId(null);
    setStartDate(""); setEndDate(""); setRate(0); setBillingPeriod("weekly");
    setDeposit(300); setNotes(""); setVehQ(""); setDrvQ("");
    setShowAddDriver(false);
    setIsSwap(false);
    setNewDriver({ fullName: "", phone: "", email: "", licenseNumber: "", rideshare: "Uber" });
  }
  function createDriver() {
    if (!newDriver.fullName.trim()) {
      toast.error("Name required");
      return;
    }
    const d = addDriver({
      fullName: newDriver.fullName.trim(),
      phone: newDriver.phone.trim(),
      email: newDriver.email.trim(),
      licenseNumber: newDriver.licenseNumber.trim() || "—",
      licenseExpiry: "",
      rideshare: newDriver.rideshare,
    });
    setDriverId(d.id);
    setShowAddDriver(false);
    setNewDriver({ fullName: "", phone: "", email: "", licenseNumber: "", rideshare: "Uber" });
    toast.success("Client added", { description: d.fullName });
  }


  function close(v: boolean) {
    onOpenChange(v);
    if (!v) setTimeout(reset, 200);
  }

  const canNext =
    (step === 0 && !!vehicle) ||
    (step === 1 && !!driver && (!existingRental || isSwap)) ||
    (step === 2 && !!startDate && rate > 0) ||
    step === 3;

  function next() {
    if (step === 0 && vehicle) setRate(prev => prev || defaultRate(vehicle, billingPeriod));
    if (step < 3) setStep((step + 1) as Step);
  }

  async function confirm() {
    if (!vehicle || !driver || !startDate) return;
    if (saving) return;
    if (existingRental && !isSwap) {
      toast.error("Renter already has an active rental", { description: "Tick the swap box on the Client step to close the existing rental." });
      return;
    }
    if (hasConflict(vehicle.id, startDate, endDate || undefined)) {
      toast.error("Booking conflict", { description: `${vehicle.year} ${vehicle.make} ${vehicle.model} already has a rental overlapping these dates.` });
      return;
    }
    if (existingRental && isSwap) {
      markReturned(existingRental.id, startDate);
    }
    setSaving(true);
    try {
      const driverReady = (driver as { cloudReady?: Promise<unknown> }).cloudReady;
      if (driverReady) await driverReady;
    const newRental = addRental({
      vehicleId: vehicle.id,
      driverId: driver.id,
      startDate,
      endDate: endDate || undefined,
      weeklyRate: toWeekly(rate, billingPeriod),
      billingPeriod,
      rate,
      depositPaid: deposit,
      notes: isSwap && existingRental
        ? `Vehicle swap from rental ${existingRental.id}.${notes ? ` ${notes}` : ""}`
        : (notes || undefined),
    });
    await (newRental as { cloudReady?: Promise<unknown> }).cloudReady;
    if (isSwap && existingRental) {
      const oldV = vehicleById(existingRental.vehicleId);
      toast.success("Swap reservation created", {
        description: `${driver.fullName} swapped ${oldV ? `${oldV.year} ${oldV.make} ${oldV.model}` : "previous vehicle"} → ${vehicle.year} ${vehicle.make} ${vehicle.model}. Old rental closed.`,
      });
    } else {
      toast.success("Reservation pending", {
        description: `${driver.fullName} · ${vehicle.year} ${vehicle.make} ${vehicle.model} — vehicle held 24h until signature + payment`,
      });
    }
    // Auto-text the renter the signing link — wait for the cloud insert to land first
    if (driver.phone) {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      void (async () => {
        try {
          // Make sure the rental (and driver, if just created) exist in the cloud DB
          // before the server function tries to look them up.
          const driverReady = (driver as { cloudReady?: Promise<unknown> }).cloudReady;
          if (driverReady) await driverReady;
          await (newRental as { cloudReady?: Promise<unknown> }).cloudReady;
          await sendSignLinkFn({ data: { rentalId: newRental.id, origin } });
          toast.success("Signing link texted to renter", { description: driver.phone });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          toast.error("Could not text signing link", { description: msg });
        }
      })();
    } else {
      toast.warning("No phone on file — signing link not sent", {
        description: "Add a phone number to the renter to enable auto-text.",
      });
    }
    close(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Try again";
      toast.error("Reservation was not saved to cloud", { description: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="flex h-screen w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0 sm:max-w-none"
      >
        <DialogHeader className="border-b bg-background p-4">
          <DialogTitle>New reservation</DialogTitle>
          <DialogDescription>Step {step + 1} of {STEPS.length} · {STEPS[step]}</DialogDescription>
          <div className="mx-auto w-full max-w-3xl">
            <Stepper current={step} />
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto bg-muted/30 px-4 py-8">
          <div key={step} className="mx-auto w-full max-w-3xl animate-in fade-in slide-in-from-right-4 duration-200">
          {step === 0 && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by make, model, plate…"
                  value={vehQ}
                  onChange={e => setVehQ(e.target.value)}
                />
              </div>
              {availableVehicles.length === 0 && (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No vehicles match.
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {availableVehicles.map(v => {
                  const selected = v.id === vehicleId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVehicleId(v.id)}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition hover:border-primary/50",
                        selected && "border-primary ring-2 ring-primary/20",
                      )}
                    >
                      <Car className="mt-0.5 h-5 w-5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{v.year} {v.make} {v.model}</div>
                        <div className="text-xs text-muted-foreground">{v.plate} · {v.mileage.toLocaleString()} mi · Tier {v.riskTier}</div>
                        <div className="mt-1 text-sm font-semibold">{fmtMoney(v.weeklyRate)}/wk</div>
                      </div>
                      {selected && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by name, email, phone…"
                  value={drvQ}
                  onChange={e => setDrvQ(e.target.value)}
                />
              </div>
              {!showAddDriver && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAddDriver(true);
                    if (drvQ.trim()) setNewDriver(n => ({ ...n, fullName: drvQ.trim() }));
                  }}
                  className="flex w-full items-center gap-3 rounded-lg border border-dashed bg-card p-3 text-left text-sm transition hover:border-primary/50 hover:bg-muted/50"
                >
                  <UserPlus className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">Add new client{drvQ.trim() ? `: "${drvQ.trim()}"` : ""}</div>
                    <div className="text-xs text-muted-foreground">Create a contact you can rent to right now</div>
                  </div>
                </button>
              )}
              {showAddDriver && (
                <div className="space-y-3 rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">New client</div>
                    <button type="button" onClick={() => setShowAddDriver(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><Label htmlFor="nd-name">Full name</Label><Input id="nd-name" value={newDriver.fullName} onChange={e => setNewDriver({ ...newDriver, fullName: e.target.value })} /></div>
                    <div><Label htmlFor="nd-phone">Phone</Label><Input id="nd-phone" value={newDriver.phone} onChange={e => setNewDriver({ ...newDriver, phone: e.target.value })} /></div>
                    <div><Label htmlFor="nd-email">Email</Label><Input id="nd-email" type="email" value={newDriver.email} onChange={e => setNewDriver({ ...newDriver, email: e.target.value })} /></div>
                    <div><Label htmlFor="nd-lic">License #</Label><Input id="nd-lic" value={newDriver.licenseNumber} onChange={e => setNewDriver({ ...newDriver, licenseNumber: e.target.value })} /></div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="nd-rs">Rideshare</Label>
                      <select id="nd-rs" className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={newDriver.rideshare} onChange={e => setNewDriver({ ...newDriver, rideshare: e.target.value as "Uber" | "Lyft" | "Both" })}>
                        <option value="Uber">Uber</option>
                        <option value="Lyft">Lyft</option>
                        <option value="Both">Both</option>
                      </select>
                    </div>
                  </div>
                  <Button size="sm" onClick={createDriver}><UserPlus className="mr-1 h-4 w-4" /> Save client</Button>
                </div>
              )}
              <div className="divide-y rounded-lg border bg-card">
                {filteredDrivers.map(d => {
                  const selected = d.id === driverId;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDriverId(d.id)}
                      className={cn(
                        "flex w-full items-center gap-3 p-3 text-left transition hover:bg-muted/50",
                        selected && "bg-primary/5",
                      )}
                    >
                      <User className="h-5 w-5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{d.fullName}</div>
                        <div className="text-xs text-muted-foreground">{d.email} · {d.phone}</div>
                      </div>
                      <span className="text-xs text-muted-foreground">{d.rideshare}</span>
                      {selected && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
              {existingRental && (() => {
                const oldV = vehicleById(existingRental.vehicleId);
                return (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <div className="flex-1 space-y-2">
                        <div>
                          <div className="font-medium">{driver?.fullName} already has an active rental</div>
                          <div className="text-xs text-muted-foreground">
                            {oldV ? `${oldV.year} ${oldV.make} ${oldV.model} · ${oldV.plate}` : existingRental.vehicleId} · started {fmtDate(existingRental.startDate)}
                          </div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-background p-2 text-sm">
                          <input
                            type="checkbox"
                            checked={isSwap}
                            onChange={e => setIsSwap(e.target.checked)}
                            className="h-4 w-4"
                          />
                          <Repeat className="h-4 w-4 text-muted-foreground" />
                          <span>This is a vehicle swap — close the existing rental and start this one.</span>
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-card p-3 text-sm">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Vehicle</div>
                <div className="font-medium">{vehicle?.year} {vehicle?.make} {vehicle?.model} · {vehicle?.plate}</div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="start">Start date</Label>
                  <Input id="start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="end">End date <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
                <div>
                  <Label>Billing period</Label>
                  <div className="mt-1 grid grid-cols-3 gap-1 rounded-md border p-1">
                    {(["daily", "weekly", "monthly"] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setBillingPeriod(p);
                          if (vehicle) setRate(defaultRate(vehicle, p));
                        }}
                        className={cn(
                          "rounded px-2 py-1 text-xs capitalize transition",
                          billingPeriod === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="rate">Rate ({rateSuffix(billingPeriod)})</Label>
                  <Input id="rate" type="number" min={0} value={rate} onChange={e => setRate(Number(e.target.value))} />
                </div>
                <div>
                  <Label htmlFor="dep">Deposit</Label>
                  <Input id="dep" type="number" min={0} value={deposit} onChange={e => setDeposit(Number(e.target.value))} />
                </div>
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Pickup location, condition notes…" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <ReviewRow icon={<Car className="h-4 w-4" />} label="Vehicle" value={vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model} · ${vehicle.plate}` : "—"} />
              <ReviewRow icon={<User className="h-4 w-4" />} label="Client" value={driver ? `${driver.fullName} · ${driver.phone}` : "—"} />
              <ReviewRow icon={<CalendarDays className="h-4 w-4" />} label="Dates" value={`${startDate ? fmtDate(startDate) : "—"}${endDate ? ` → ${fmtDate(endDate)}` : " · open-ended"}`} />
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs uppercase text-muted-foreground">Rate</div>
                  <div className="text-lg font-bold">{fmtMoney(rate)}<span className="text-xs font-normal text-muted-foreground">/{rateSuffix(billingPeriod)}</span></div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs uppercase text-muted-foreground">Deposit</div>
                  <div className="text-lg font-bold">{fmtMoney(deposit)}</div>
                </div>
              </div>
              {notes && (
                <div className="rounded-lg border bg-card p-3 text-sm">
                  <div className="text-xs uppercase text-muted-foreground">Notes</div>
                  <div className="mt-1">{notes}</div>
                </div>
              )}
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ClipboardCheck className="h-4 w-4" /> Saves as Pending. Vehicle is held for 24h until the client signs the agreement and payment is received.
              </p>
            </div>
          )}
          </div>
        </div>

        <div className="border-t bg-background p-3">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={step === 0}
            onClick={() => setStep(((step - 1) as Step))}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          {step < 3 ? (
            <Button size="sm" disabled={!canNext} onClick={next}>
              Continue <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" onClick={confirm}>
              <Check className="mr-1 h-4 w-4" /> Save as pending
            </Button>
          )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="truncate font-medium">{value}</div>
      </div>
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                done && "bg-primary text-primary-foreground",
                active && "bg-primary text-primary-foreground ring-2 ring-primary/30",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={cn("hidden text-xs sm:inline", active ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <div className={cn("h-px flex-1", done ? "bg-primary" : "bg-border")} />}
          </div>
        );
      })}
    </div>
  );
}