import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, Upload, ArrowLeft } from "lucide-react";
import { createHistoricRental } from "@/lib/historic-rental.functions";
import { listFleetVehicles } from "@/lib/violations.functions";
import { compressImage } from "@/lib/image-compress";

const search = z.object({
  violationId: z.string().optional(),
  plate: z.string().optional(),
  date: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/admin/historic-reservation" as never)({
  validateSearch: (raw) => search.parse(raw),
  head: () => ({
    meta: [
      { title: "Historic Reservation | Camauto" },
      {
        name: "description",
        content:
          "Manually enter a past rental (Fleet Finesse era, cash deal, informal rental) so it becomes searchable and linkable to violations.",
      },
    ],
  }),
  component: HistoricReservationPage,
});

function toDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function HistoricReservationPage() {
  // Search params for prefill from Violations page. TanStack routing types
  // are generated after `.gen.ts` refresh; use loose access to keep this file
  // self-contained.
  const sp = (Route as unknown as { useSearch: () => z.infer<typeof search> }).useSearch();
  const navigate = useNavigate();
  const createFn = useServerFn(createHistoricRental);
  const vehiclesFn = useServerFn(listFleetVehicles);

  const { data: vehicles = [] } = useQuery({
    queryKey: ["fleet-vehicles"],
    queryFn: () => vehiclesFn(),
  });

  // Prefill vehicle from violation plate.
  const prefilledVehicleId = useMemo(() => {
    if (!sp.plate) return "";
    const p = sp.plate.replace(/\s+/g, "").toUpperCase();
    const hit = vehicles.find(
      (v) => (v.plate || "").replace(/\s+/g, "").toUpperCase() === p,
    );
    return hit?.id ?? "";
  }, [sp.plate, vehicles]);

  // Prefill dates from violation date (± 1 day window).
  const violationDate = (sp.date || "").slice(0, 10);
  const prefilledStart = useMemo(() => {
    if (!violationDate) return "";
    const d = new Date(violationDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }, [violationDate]);
  const prefilledEnd = useMemo(() => {
    if (!violationDate) return "";
    const d = new Date(violationDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [violationDate]);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [dlState, setDlState] = useState("");
  const [dob, setDob] = useState("");

  const [vehicleId, setVehicleId] = useState<string>("");
  const [plateOverride, setPlateOverride] = useState<string>(sp.plate || "");
  const [useManualPlate, setUseManualPlate] = useState<boolean>(false);

  const [startDate, setStartDate] = useState(prefilledStart);
  const [endDate, setEndDate] = useState(prefilledEnd);
  const [rateType, setRateType] = useState<"daily" | "weekly">("daily");
  const [rateAmount, setRateAmount] = useState<string>("");
  const [totalAmount, setTotalAmount] = useState<string>("");

  const [amountPaid, setAmountPaid] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "check" | "other">("cash");
  const [paymentNotes, setPaymentNotes] = useState("");

  const [licensePreview, setLicensePreview] = useState<string>("");
  const [licenseDataUrl, setLicenseDataUrl] = useState<string>("");
  const [agreementDataUrl, setAgreementDataUrl] = useState<string>("");
  const [agreementFilename, setAgreementFilename] = useState<string>("");
  const [noAgreement, setNoAgreement] = useState(false);

  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  // Sync the prefill values in once vehicles load / route mounts.
  useMemo(() => {
    if (prefilledVehicleId && !vehicleId) setVehicleId(prefilledVehicleId);
  }, [prefilledVehicleId, vehicleId]);
  useMemo(() => {
    if (prefilledStart && !startDate) setStartDate(prefilledStart);
    if (prefilledEnd && !endDate) setEndDate(prefilledEnd);
  }, [prefilledStart, prefilledEnd, startDate, endDate]);

  // Live total suggestion.
  const suggestedTotal = useMemo(() => {
    const rate = parseFloat(rateAmount);
    if (!Number.isFinite(rate) || rate <= 0) return "";
    if (!startDate || !endDate) return "";
    const start = new Date(startDate + "T00:00:00").getTime();
    const end = new Date(endDate + "T00:00:00").getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
    const days = Math.max(1, Math.round((end - start) / 86400000));
    const value = rateType === "weekly" ? rate * (days / 7) : rate * days;
    return value.toFixed(2);
  }, [rateAmount, startDate, endDate, rateType]);

  const canSubmit =
    fullName.trim().length >= 2 &&
    phone.trim().length >= 7 &&
    address.trim().length >= 3 &&
    licenseNumber.trim().length >= 2 &&
    dlState.trim().length >= 2 &&
    (vehicleId || (useManualPlate && plateOverride.trim().length >= 2)) &&
    startDate &&
    endDate &&
    !busy;

  async function onLicenseFile(f: File | null) {
    if (!f) return;
    try {
      const compressed = await compressImage(f, 2 * 1024 * 1024, 1600);
      const url = await toDataUrl(compressed);
      setLicensePreview(url);
      setLicenseDataUrl(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read license image");
    }
  }

  async function onAgreementFile(f: File | null) {
    if (!f) return;
    try {
      if (f.type.startsWith("image/")) {
        const compressed = await compressImage(f, 3 * 1024 * 1024, 2000);
        const url = await toDataUrl(compressed);
        setAgreementDataUrl(url);
        setAgreementFilename(compressed.name);
      } else {
        if (f.size > 15 * 1024 * 1024) {
          toast.error("Agreement file exceeds 15MB");
          return;
        }
        const url = await toDataUrl(f);
        setAgreementDataUrl(url);
        setAgreementFilename(f.name);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read agreement");
    }
  }

  async function onSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const total = parseFloat(totalAmount || suggestedTotal || "0");
      const rate = parseFloat(rateAmount || "0");
      const paid = parseFloat(amountPaid || "0");
      const res = await createFn({
        data: {
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          licenseNumber: licenseNumber.trim(),
          dlState: dlState.trim().toUpperCase(),
          dateOfBirth: dob.trim(),
          vehicleId: useManualPlate ? "" : vehicleId,
          plateOverride: useManualPlate ? plateOverride.trim().toUpperCase() : "",
          startDate,
          endDate,
          rateType,
          rateAmount: Number.isFinite(rate) ? rate : 0,
          totalAmount: Number.isFinite(total) ? total : 0,
          amountPaid: Number.isFinite(paid) ? paid : 0,
          paymentMethod,
          paymentNotes: paymentNotes.trim(),
          licenseImageDataUrl: licenseDataUrl,
          agreementFileDataUrl: noAgreement ? "" : agreementDataUrl,
          noAgreementAvailable: noAgreement,
          notes: notes.trim(),
          violationId: sp.violationId || "",
        },
      });
      toast.success("Historic rental saved");
      if (res.linkedViolationId) {
        toast.success("Linked to violation");
        navigate({ to: "/violations" });
      } else {
        navigate({ to: "/rentals" });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Historic Reservation</h1>
          <p className="text-sm text-muted-foreground">
            Manually record a past rental — cash deals, Fleet Finesse era, informal rentals.
            Creates a real rental record so it is fully searchable and linkable to violations.
          </p>
        </div>
        <Button variant="ghost" asChild>
          <Link to="/rentals">
            <ArrowLeft className="mr-2 h-4 w-4" /> Rentals
          </Link>
        </Button>
      </div>

      {sp.violationId ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertTitle>Linked to violation on save</AlertTitle>
          <AlertDescription>
            This entry will be attached to violation <code>{sp.violationId}</code>
            {violationDate ? ` (${violationDate})` : ""}.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>Full name *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Phone *</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Address *</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City, State ZIP" />
          </div>
          <div className="space-y-1">
            <Label>Driver license # *</Label>
            <Input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>License state *</Label>
            <Input
              value={dlState}
              maxLength={2}
              onChange={(e) => setDlState(e.target.value.toUpperCase())}
              placeholder="NJ"
            />
          </div>
          <div className="space-y-1">
            <Label>Date of birth</Label>
            <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Driver license photo (front)</Label>
            <div className="flex items-center gap-3">
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => onLicenseFile(e.target.files?.[0] ?? null)}
              />
              {licensePreview ? (
                <img src={licensePreview} alt="license preview" className="h-16 rounded border" />
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehicle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="manual-plate"
              checked={useManualPlate}
              onCheckedChange={(v) => setUseManualPlate(Boolean(v))}
            />
            <Label htmlFor="manual-plate" className="cursor-pointer">
              Enter plate manually (vehicle no longer in fleet)
            </Label>
          </div>
          {useManualPlate ? (
            <div className="space-y-1">
              <Label>Plate *</Label>
              <Input
                value={plateOverride}
                onChange={(e) => setPlateOverride(e.target.value.toUpperCase())}
              />
              <p className="text-xs text-muted-foreground">
                We'll match this plate to a fleet vehicle if it still exists.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Select vehicle *</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose from fleet…" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rental period & rate</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Start date *</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>End date *</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Rate type</Label>
            <RadioGroup
              value={rateType}
              onValueChange={(v) => setRateType(v as "daily" | "weekly")}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2">
                <RadioGroupItem value="daily" id="rt-d" /> Daily
              </label>
              <label className="flex items-center gap-2">
                <RadioGroupItem value="weekly" id="rt-w" /> Weekly
              </label>
            </RadioGroup>
          </div>
          <div className="space-y-1">
            <Label>{rateType === "weekly" ? "Weekly rate ($)" : "Daily rate ($)"}</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={rateAmount}
              onChange={(e) => setRateAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>
              Total rental amount ($)
              {suggestedTotal ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  suggested {suggestedTotal}
                </span>
              ) : null}
            </Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              placeholder={suggestedTotal || "0.00"}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Amount paid ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Payment method</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Payment notes</Label>
            <Input
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="e.g. Paid weekly in cash"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signed agreement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="no-agreement"
              checked={noAgreement}
              onCheckedChange={(v) => setNoAgreement(Boolean(v))}
            />
            <Label htmlFor="no-agreement" className="cursor-pointer">
              No agreement available for this period
            </Label>
          </div>
          {!noAgreement && (
            <div className="space-y-1">
              <Label>Upload signed agreement (PDF or image)</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => onAgreementFile(e.target.files?.[0] ?? null)}
                />
                {agreementFilename ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Upload className="h-3 w-3" /> {agreementFilename}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Uploaded agreement is marked as signed and instantly usable for
                violation dispute packets.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes about this rental"
            rows={3}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => navigate({ to: "/rentals" })} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={!canSubmit}>
          {busy ? "Saving…" : "Save Historic Rental"}
        </Button>
      </div>
    </div>
  );
}