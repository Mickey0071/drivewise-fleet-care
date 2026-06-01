import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { vehicles, drivers, vehicleById, fmtMoney, fmtDate, maintenance } from "@/lib/mock/data";
import { addRental, hasConflict, addDriver, getActiveRentalForDriver, isVehicleBookable, markReturnedAwaitingInspection, awaitingPostReturnInspection, useStoreVersion, checkVehicleOverlapInDb } from "@/lib/mock/store";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { sendSigningLink } from "@/lib/sign.functions";
import { sendAgreementToCustomer } from "@/lib/agreement-delivery.functions";
import { Check, ArrowLeft, ArrowRight, Car, User, CalendarDays, ClipboardCheck, Search, UserPlus, Repeat, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { US_STATES, formatAddressBlock, formatFullName } from "@/lib/us-states";
import { openIssueFor, summarizeOpenIssue } from "@/lib/maintenance-utils";
import { VehicleAvailabilityCalendar } from "@/components/app/VehicleAvailabilityCalendar";
import { getVehicleBlocks, rangeOverlapsBlocks } from "@/lib/vehicle-blocks";

const STEPS = ["Dates", "Vehicle", "Client", "Review"] as const;
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
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const sendSignLinkFn = useServerFn(sendSigningLink);
  const sendAgreementFn = useServerFn(sendAgreementToCustomer);
  const [step, setStep] = useState<Step>(0);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [billingPeriod, setBillingPeriod] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [rate, setRate] = useState<number>(0);
  const [deposit, setDeposit] = useState<number>(300);
  const [skipDailyMin, setSkipDailyMin] = useState<boolean>(false);
  const [notes, setNotes] = useState("");
  const [vehQ, setVehQ] = useState("");
  const [drvQ, setDrvQ] = useState("");
  const [showAddDriver, setShowAddDriver] = useState(false);
  const emptyDriver = {
    firstName: "", middleInitial: "", lastName: "",
    phone: "", email: "",
    licenseNumber: "", dlState: "", licenseExpiry: "",
    rideshare: "Uber" as "Uber" | "Lyft" | "Both",
    dateOfBirth: "",
    streetAddress: "", aptUnit: "", city: "", state: "", zipCode: "",
    altContactName: "", altContactPhone: "",
  };
  const [newDriver, setNewDriver] = useState(emptyDriver);
  const [isSwap, setIsSwap] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openIssueWarning, setOpenIssueWarning] = useState(false);
  const [inspectionOverride, setInspectionOverride] = useState(false);

  useEffect(() => {
    if (open && initialVehicleId) {
      setVehicleId(initialVehicleId);
      // Still start at Dates (step 0) — vehicle is preselected and we need
      // dates entered before we can validate it.
      setStep(0);
    }
  }, [open, initialVehicleId]);

  const vehicle = vehicles.find(v => v.id === vehicleId) ?? null;
  const driver = drivers.find(d => d.id === driverId) ?? null;
  const existingRental = driver ? getActiveRentalForDriver(driver.id) : null;

  const availableVehicles = useMemo(
    () => vehicles.filter(v => {
      const bookable = startDate
        ? isVehicleBookable(v.id, startDate, endDate || null)
        : isVehicleBookable(v.id);
      // Keep blocked-for-issue and awaiting-inspection vehicles in the list so
      // the user gets an explanatory alert when they try to book them.
      if (!bookable && !awaitingPostReturnInspection(v.id) && !v.hasOpenIssues) return false;
      return (
        vehQ === "" ||
        `${v.year} ${v.make} ${v.model} ${v.plate}`.toLowerCase().includes(vehQ.toLowerCase())
      );
    }),
    [vehQ, startDate, endDate]
  );

  // If dates change after a vehicle is picked, clear stale selection.
  const [vehicleClearedNotice, setVehicleClearedNotice] = useState(false);
  useEffect(() => {
    if (!vehicleId || !startDate) return;
    const stillOk = isVehicleBookable(vehicleId, startDate, endDate || null)
      || awaitingPostReturnInspection(vehicleId)
      || (vehicles.find(v => v.id === vehicleId)?.hasOpenIssues ?? false);
    if (!stillOk) {
      setVehicleId(null);
      setVehicleClearedNotice(true);
    }
  }, [startDate, endDate, vehicleId]);

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
    setNewDriver(emptyDriver);
    setInspectionOverride(false);
  }
  async function createDriver() {
    if (!newDriver.firstName.trim() || !newDriver.lastName.trim()) {
      toast.error("First and last name are required");
      return;
    }
    const fullName = formatFullName({
      firstName: newDriver.firstName,
      middleInitial: newDriver.middleInitial,
      lastName: newDriver.lastName,
    });
    const address = formatAddressBlock({
      streetAddress: newDriver.streetAddress,
      aptUnit: newDriver.aptUnit,
      city: newDriver.city,
      state: newDriver.state,
      zipCode: newDriver.zipCode,
    });
    try {
      const d = addDriver({
        fullName,
        phone: newDriver.phone.trim() || "—",
        email: newDriver.email.trim() || "no-email@camauto.local",
        licenseNumber: newDriver.licenseNumber.trim() || "—",
        licenseExpiry: newDriver.licenseExpiry || "2030-01-01",
        rideshare: newDriver.rideshare,
        dateOfBirth: newDriver.dateOfBirth || undefined,
        address: address || undefined,
        firstName: newDriver.firstName.trim(),
        middleInitial: newDriver.middleInitial.trim() || undefined,
        lastName: newDriver.lastName.trim(),
        dlState: newDriver.dlState || undefined,
        streetAddress: newDriver.streetAddress.trim() || undefined,
        aptUnit: newDriver.aptUnit.trim() || undefined,
        city: newDriver.city.trim() || undefined,
        state: newDriver.state || undefined,
        zipCode: newDriver.zipCode.trim() || undefined,
        altContactName: newDriver.altContactName.trim() || undefined,
        altContactPhone: newDriver.altContactPhone.trim() || undefined,
      });
      await (d as { cloudReady?: Promise<unknown> }).cloudReady;
      setDriverId(d.id);
      setShowAddDriver(false);
      setNewDriver(emptyDriver);
      toast.success("Client saved", { description: d.fullName });
    } catch (e) {
      toast.error("Client was not saved", { description: e instanceof Error ? e.message : "Try again" });
    }
  }


  function close(v: boolean) {
    onOpenChange(v);
    if (!v) setTimeout(reset, 200);
  }

  const canNext =
    (step === 0 && !!startDate) ||
    (step === 1 && !!vehicle && !vehicle.hasOpenIssues) ||
    (step === 2 && !!driver && (!existingRental || isSwap)) ||
    step === 3;

  function next() {
    // Open maintenance issue is a HARD block — cannot advance past the
    // Vehicle step until the repair ticket is marked completed.
    if (step === 1 && vehicle?.hasOpenIssues) {
      setOpenIssueWarning(true);
      return;
    }
    // When leaving the Vehicle step (1), seed the default rate.
    if (step === 1 && vehicle) setRate(prev => prev || defaultRate(vehicle, billingPeriod));
    if (step < 3) setStep((step + 1) as Step);
  }

  async function confirm() {
    if (!vehicle || !driver || !startDate) return;
    if (saving) return;
    if (driver.blocked) {
      toast.error(`${driver.fullName} is blocked from renting`, {
        description: driver.blockReason ? `Reason: ${driver.blockReason}` : "Unblock the renter before booking.",
      });
      return;
    }
    if (awaitingPostReturnInspection(vehicle.id) && !(isAdmin && inspectionOverride)) {
      toast.error("Vehicle needs a runner inspection first", {
        description: "Submit a passing post-return checklist before booking this vehicle.",
      });
      return;
    }
    // Open maintenance issue is a HARD block — the vehicle cannot be rented
    // until the repair ticket is marked completed.
    if (vehicle.hasOpenIssues) {
      setOpenIssueWarning(true);
      return;
    }
    if (existingRental && !isSwap) {
      toast.error("Renter already has an active rental", { description: "Tick the swap box on the Client step to close the existing rental." });
      return;
    }
    if (hasConflict(vehicle.id, startDate, endDate || undefined)) {
      toast.error("Booking conflict", { description: `${vehicle.year} ${vehicle.make} ${vehicle.model} already has a rental overlapping these dates.` });
      return;
    }
    // Cross-session race guard — query the cloud DB before we commit.
    const dbHit = await checkVehicleOverlapInDb(vehicle.id, startDate, endDate || null);
    if (dbHit) {
      toast.error("Booking conflict", {
        description: `Another session booked ${vehicle.year} ${vehicle.make} ${vehicle.model} for an overlapping window (rental ${dbHit.conflictId}). Pick a different vehicle or dates.`,
      });
      return;
    }
    if (existingRental && isSwap) {
      markReturnedAwaitingInspection(existingRental.id, startDate);
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
      skipDailyMinimum: billingPeriod === "daily" ? skipDailyMin : false,
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
    // Auto-generate the pre-filled Rental Agreement PDF and deliver to the
    // renter via SMS + Email. Also send the signing link via SMS so they can
    // complete the e-signature step.
    {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      void (async () => {
        try {
          const driverReady = (driver as { cloudReady?: Promise<unknown> }).cloudReady;
          if (driverReady) await driverReady;
          await (newRental as { cloudReady?: Promise<unknown> }).cloudReady;

          // 1) Generate PDF and deliver via SMS + Email
          const res = await sendAgreementFn({ data: { rentalId: newRental.id, origin } });
          if (res?.ok && res.smsSent && res.emailSent) {
            toast.success("Rental Agreement sent to customer via email and text");
          } else if (res?.ok) {
            const channels = [
              res.smsSent ? "text" : null,
              res.emailSent ? "email" : null,
            ].filter(Boolean).join(" and ");
            toast.success(`Rental Agreement sent via ${channels}`, {
              description: res.errors?.length ? res.errors.join(" · ") : undefined,
            });
          } else {
            toast.error("Could not send Rental Agreement", {
              description: res?.errors?.join(" · ") ?? "Unknown error",
            });
          }

          // 2) Also text the signing link (separate short SMS for quick sign)
          if (driver.phone) {
            try {
              await sendSignLinkFn({ data: { rentalId: newRental.id, origin } });
            } catch {
              // Non-fatal — the agreement SMS already includes the sign link.
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          toast.error("Could not send Rental Agreement", { description: msg });
        }
      })();
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
    <>
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="flex h-screen w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0 sm:max-w-none"
      >
        <DialogHeader className="border-b bg-background px-4 py-2">
          <DialogTitle className="text-base">New reservation</DialogTitle>
          <DialogDescription className="text-xs">Step {step + 1} of {STEPS.length} · {STEPS[step]}</DialogDescription>
          <div className="mx-auto w-full max-w-3xl">
            <Stepper current={step} />
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto bg-muted/30 px-4 py-4">
          <div key={step} className="mx-auto w-full max-w-3xl animate-in fade-in slide-in-from-right-4 duration-200">
          {step === 1 && (
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
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  <span className="font-semibold text-foreground">{availableVehicles.length}</span>{" "}
                  vehicle{availableVehicles.length === 1 ? "" : "s"} available for{" "}
                  {startDate ? fmtDate(startDate) : "—"}
                  {endDate ? ` → ${fmtDate(endDate)}` : " · open-ended"}
                </span>
                {vehicleClearedNotice && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3" /> Your previous pick is no longer available for these dates — pick another.
                  </span>
                )}
              </div>
              {availableVehicles.length === 0 && (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No vehicles match.
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {availableVehicles.map(v => {
                  const selected = v.id === vehicleId;
                  const needsInspection = awaitingPostReturnInspection(v.id);
                  const blockedForIssue = v.hasOpenIssues;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => { setVehicleId(v.id); if (v.hasOpenIssues) setOpenIssueWarning(true); }}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition hover:border-primary/50",
                        selected && "border-primary ring-2 ring-primary/20",
                        (needsInspection || blockedForIssue) && "border-destructive/50 bg-destructive/5",
                      )}
                    >
                      <Car className="mt-0.5 h-5 w-5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          <span>{v.year} {v.make} {v.model}</span>
                          {needsInspection && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                              <AlertTriangle className="h-3 w-3" /> Needs inspection
                            </span>
                          )}
                          {blockedForIssue && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                              <AlertTriangle className="h-3 w-3" /> Open maintenance issue
                            </span>
                          )}
                        </div>
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

          {step === 2 && (
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
                    if (drvQ.trim()) {
                      const parts = drvQ.trim().split(/\s+/);
                      setNewDriver(n => ({
                        ...n,
                        firstName: parts[0] ?? "",
                        lastName: parts.slice(1).join(" ") ?? "",
                      }));
                    }
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
                  <div className="space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Personal</div>
                    <div className="grid gap-3 sm:grid-cols-6">
                      <div className="sm:col-span-3"><Label htmlFor="nd-fn">First name *</Label><Input id="nd-fn" value={newDriver.firstName} onChange={e => setNewDriver({ ...newDriver, firstName: e.target.value })} /></div>
                      <div className="sm:col-span-1"><Label htmlFor="nd-mi">M.I.</Label><Input id="nd-mi" maxLength={2} value={newDriver.middleInitial} onChange={e => setNewDriver({ ...newDriver, middleInitial: e.target.value })} /></div>
                      <div className="sm:col-span-2"><Label htmlFor="nd-ln">Last name *</Label><Input id="nd-ln" value={newDriver.lastName} onChange={e => setNewDriver({ ...newDriver, lastName: e.target.value })} /></div>
                      <div className="sm:col-span-2"><Label htmlFor="nd-phone">Phone</Label><Input id="nd-phone" value={newDriver.phone} onChange={e => setNewDriver({ ...newDriver, phone: e.target.value })} /></div>
                      <div className="sm:col-span-2"><Label htmlFor="nd-email">Email</Label><Input id="nd-email" type="email" value={newDriver.email} onChange={e => setNewDriver({ ...newDriver, email: e.target.value })} /></div>
                      <div className="sm:col-span-2"><Label htmlFor="nd-dob">Date of birth</Label><Input id="nd-dob" type="date" value={newDriver.dateOfBirth} onChange={e => setNewDriver({ ...newDriver, dateOfBirth: e.target.value })} /></div>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">License</div>
                    <div className="grid gap-3 sm:grid-cols-6">
                      <div className="sm:col-span-3"><Label htmlFor="nd-lic">DL number</Label><Input id="nd-lic" value={newDriver.licenseNumber} onChange={e => setNewDriver({ ...newDriver, licenseNumber: e.target.value })} /></div>
                      <div className="sm:col-span-1">
                        <Label htmlFor="nd-dls">DL state</Label>
                        <select id="nd-dls" className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={newDriver.dlState} onChange={e => setNewDriver({ ...newDriver, dlState: e.target.value })}>
                          <option value="">—</option>
                          {US_STATES.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}
                        </select>
                      </div>
                      <div className="sm:col-span-2"><Label htmlFor="nd-lex">DL expiration</Label><Input id="nd-lex" type="date" value={newDriver.licenseExpiry} onChange={e => setNewDriver({ ...newDriver, licenseExpiry: e.target.value })} /></div>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">Address &amp; Alternate Contact</div>
                    <div className="grid gap-3 sm:grid-cols-6">
                      <div className="sm:col-span-4"><Label htmlFor="nd-st">Street address</Label><Input id="nd-st" placeholder="123 Main St" value={newDriver.streetAddress} onChange={e => setNewDriver({ ...newDriver, streetAddress: e.target.value })} /></div>
                      <div className="sm:col-span-2"><Label htmlFor="nd-apt">Apt / Unit</Label><Input id="nd-apt" placeholder="4B" value={newDriver.aptUnit} onChange={e => setNewDriver({ ...newDriver, aptUnit: e.target.value })} /></div>
                      <div className="sm:col-span-3"><Label htmlFor="nd-city">City</Label><Input id="nd-city" value={newDriver.city} onChange={e => setNewDriver({ ...newDriver, city: e.target.value })} /></div>
                      <div className="sm:col-span-1">
                        <Label htmlFor="nd-state">State</Label>
                        <select id="nd-state" className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={newDriver.state} onChange={e => setNewDriver({ ...newDriver, state: e.target.value })}>
                          <option value="">—</option>
                          {US_STATES.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}
                        </select>
                      </div>
                      <div className="sm:col-span-2"><Label htmlFor="nd-zip">ZIP</Label><Input id="nd-zip" placeholder="08081" value={newDriver.zipCode} onChange={e => setNewDriver({ ...newDriver, zipCode: e.target.value })} /></div>
                      <div className="sm:col-span-3"><Label htmlFor="nd-altn">Alt contact name</Label><Input id="nd-altn" value={newDriver.altContactName} onChange={e => setNewDriver({ ...newDriver, altContactName: e.target.value })} /></div>
                      <div className="sm:col-span-3"><Label htmlFor="nd-altp">Alt contact phone</Label><Input id="nd-altp" placeholder="+12675551234" value={newDriver.altContactPhone} onChange={e => setNewDriver({ ...newDriver, altContactPhone: e.target.value })} /></div>
                    </div>
                    <div>
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
                      disabled={d.blocked}
                      onClick={() => setDriverId(d.id)}
                      className={cn(
                        "flex w-full items-center gap-3 p-3 text-left transition hover:bg-muted/50",
                        selected && "bg-primary/5",
                        d.blocked && "cursor-not-allowed opacity-60 hover:bg-transparent",
                      )}
                    >
                      <User className="h-5 w-5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{d.fullName}</span>
                          {d.blocked && (
                            <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                              Blocked
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{d.email} · {d.phone}</div>
                        {d.blocked && d.blockReason && (
                          <div className="text-xs text-destructive">{d.blockReason}</div>
                        )}
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

          {step === 0 && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Enter the rental window first — we'll only show vehicles that are free for these dates.
              </p>
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
                  <Input id="rate" type="number" inputMode="decimal" min={0} value={rate || ""} onChange={e => setRate(Number(e.target.value))} placeholder={vehicle ? String(defaultRate(vehicle, billingPeriod)) : "Pick a vehicle to auto-fill"} />
                </div>
                <div>
                  <Label htmlFor="dep">Deposit</Label>
                  <Input id="dep" type="number" inputMode="decimal" min={0} placeholder="Enter amount" value={deposit || ""} onChange={e => setDeposit(Number(e.target.value))} />
                </div>
              </div>
              {billingPeriod === "daily" && (
                <div className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="pr-3">
                    <Label className="block">Skip 2-day minimum (family &amp; friends)</Label>
                    <p className="text-xs text-muted-foreground">When ON, only 1 day is collected upfront. Default is 2 days.</p>
                  </div>
                  <Switch checked={skipDailyMin} onCheckedChange={setSkipDailyMin} />
                </div>
              )}
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Pickup location, condition notes…" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              {vehicle && awaitingPostReturnInspection(vehicle.id) && (
                <div className="rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div className="flex-1">
                      <div className="font-semibold text-destructive">Post-return inspection required</div>
                      <p className="mt-1 text-muted-foreground">
                        This vehicle was just returned. A runner must submit a passing checklist before it can be rented again.
                      </p>
                      <Link
                        to="/checklist"
                        className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
                      >
                        Open runner checklist →
                      </Link>
                      {isAdmin && (
                        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={inspectionOverride}
                            onChange={(e) => setInspectionOverride(e.target.checked)}
                          />
                          <span>Override — book without inspection (admin)</span>
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              )}
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
            onClick={() => {
              if (step === 0) {
                close(false);
              } else {
                setStep(((step - 1) as Step));
              }
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          {step < 3 ? (
            <Button size="sm" disabled={!canNext} onClick={next}>
              Continue <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={confirm}
              disabled={saving || (!!vehicle && awaitingPostReturnInspection(vehicle.id) && !(isAdmin && inspectionOverride))}
            >
              <Check className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save as pending"}
            </Button>
          )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={openIssueWarning} onOpenChange={setOpenIssueWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Vehicle unavailable
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {vehicle ? (
                <>
                  This vehicle has an open maintenance issue and cannot be rented
                  until the repair is completed.
                  {(() => {
                    const issue = openIssueFor(maintenance, vehicle.id);
                    if (!issue) return null;
                    const s = summarizeOpenIssue(issue);
                    return (
                      <ul className="mt-3 space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
                        <li><span className="text-muted-foreground">Issue:</span> <span className="font-medium">{s.issue}</span></li>
                        <li><span className="text-muted-foreground">Vendor:</span> <span className="font-medium">{s.vendor}</span></li>
                        {s.downPayment && <li><span className="text-muted-foreground">Down payment:</span> <span className="font-medium">{s.downPayment}</span></li>}
                        {s.balance && <li><span className="text-muted-foreground">Remaining balance:</span> <span className="font-medium">{s.balance}</span></li>}
                        {s.estimatedReturn && <li><span className="text-muted-foreground">Estimated return:</span> <span className="font-medium">{s.estimatedReturn}</span></li>}
                      </ul>
                    );
                  })()}
                </>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel rental</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
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
    <div className="mt-1.5 flex items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                done && "bg-primary text-primary-foreground",
                active && "bg-primary text-primary-foreground ring-2 ring-primary/30",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span className={cn("hidden text-xs sm:inline", active ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <div className={cn("h-px flex-1", done ? "bg-primary" : "bg-border")} />}
          </div>
        );
      })}
    </div>
  );
}