import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { vehicles, drivers, fmtMoney, fmtDate } from "@/lib/mock/data";
import { Check, ArrowLeft, ArrowRight, Car, User, CalendarDays, ClipboardCheck, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STEPS = ["Vehicle", "Client", "Dates", "Review"] as const;
type Step = 0 | 1 | 2 | 3;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function NewReservationDialog({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<Step>(0);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [weeklyRate, setWeeklyRate] = useState<number>(0);
  const [deposit, setDeposit] = useState<number>(300);
  const [notes, setNotes] = useState("");
  const [vehQ, setVehQ] = useState("");
  const [drvQ, setDrvQ] = useState("");

  const vehicle = vehicles.find(v => v.id === vehicleId) ?? null;
  const driver = drivers.find(d => d.id === driverId) ?? null;

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
    setStartDate(""); setEndDate(""); setWeeklyRate(0);
    setDeposit(300); setNotes(""); setVehQ(""); setDrvQ("");
  }

  function close(v: boolean) {
    onOpenChange(v);
    if (!v) setTimeout(reset, 200);
  }

  const canNext =
    (step === 0 && !!vehicle) ||
    (step === 1 && !!driver) ||
    (step === 2 && !!startDate && weeklyRate > 0) ||
    step === 3;

  function next() {
    if (step === 0 && vehicle) setWeeklyRate(prev => prev || vehicle.weeklyRate);
    if (step < 3) setStep((step + 1) as Step);
  }

  function confirm() {
    toast.success("Reservation created", {
      description: `${driver?.fullName} · ${vehicle?.year} ${vehicle?.make} ${vehicle?.model} starting ${fmtDate(startDate)}`,
    });
    close(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b p-4">
          <DialogTitle>New reservation</DialogTitle>
          <DialogDescription>Step {step + 1} of {STEPS.length} · {STEPS[step]}</DialogDescription>
          <Stepper current={step} />
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto bg-muted/30 p-5">
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
                  <Label htmlFor="rate">Weekly rate</Label>
                  <Input id="rate" type="number" min={0} value={weeklyRate} onChange={e => setWeeklyRate(Number(e.target.value))} />
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
                  <div className="text-xs uppercase text-muted-foreground">Weekly rate</div>
                  <div className="text-lg font-bold">{fmtMoney(weeklyRate)}</div>
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
                <ClipboardCheck className="h-4 w-4" /> Confirming creates the rental and sends a check-in link to the client.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-background p-3">
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
              <Check className="mr-1 h-4 w-4" /> Confirm reservation
            </Button>
          )}
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