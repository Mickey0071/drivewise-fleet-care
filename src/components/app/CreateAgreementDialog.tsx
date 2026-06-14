import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { SignaturePad } from "@/components/app/SignaturePad";
import { createViolationAgreement } from "@/lib/violation-retro.functions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  violationId: string;
  /** Violation date (YYYY-MM-DD) the agreement dates must cover. */
  violationDate: string;
  defaults?: { fullName?: string | null; phone?: string | null };
  onDone: () => void;
}

export function CreateAgreementDialog({
  open,
  onOpenChange,
  violationId,
  violationDate,
  defaults,
  onDone,
}: Props) {
  const create = useServerFn(createViolationAgreement);
  const vDate = (violationDate || "").slice(0, 10);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [fullName, setFullName] = useState(defaults?.fullName ?? "");
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [dlState, setDlState] = useState("");
  const [dob, setDob] = useState("");
  const [method, setMethod] = useState<"link" | "admin">("link");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startValid = Boolean(startDate) && startDate <= vDate;
  const endValid = Boolean(endDate) && endDate >= vDate;
  const datesCover = startValid && endValid && endDate >= startDate;

  const requiredOk = useMemo(
    () =>
      fullName.trim().length >= 2 &&
      phone.trim().length >= 7 &&
      address.trim().length >= 3 &&
      licenseNumber.trim().length >= 2 &&
      dob.trim().length >= 4,
    [fullName, phone, address, licenseNumber, dob],
  );

  const canSubmit = datesCover && requiredOk && !busy;

  const submit = async () => {
    if (!datesCover) {
      toast.error(`Agreement dates must cover the violation date (${vDate})`);
      return;
    }
    if (!requiredOk) {
      toast.error("Fill in all required renter fields (name, phone, address, license #, DOB)");
      return;
    }
    setBusy(true);
    try {
      const res = await create({
        data: {
          violationId,
          startDate,
          endDate,
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          licenseNumber: licenseNumber.trim(),
          dlState: dlState.trim(),
          dateOfBirth: dob.trim(),
          signingMethod: method,
          signatureDataUrl: method === "admin" ? signature ?? "" : "",
        },
      });
      if (res.method === "link") {
        toast.success("Sign link sent to customer — awaiting signature");
      } else {
        toast.success("Agreement created and signed — ready to mail");
        if (res.agreementUrl) window.open(res.agreementUrl, "_blank");
      }
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create agreement");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Agreement</DialogTitle>
        </DialogHeader>

        {/* Date validation banner */}
        <Alert variant={datesCover ? "default" : "destructive"}>
          {datesCover ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <AlertTitle>
            {datesCover ? "Dates cover the violation date" : "Agreement must cover the violation date"}
          </AlertTitle>
          <AlertDescription>
            The agreement period must include the violation date <strong>{vDate}</strong>. Start must
            be on or before, and end on or after, that date.
          </AlertDescription>
        </Alert>

        {/* Agreement dates */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>
              Rental Start{" "}
              {startDate ? (
                startValid ? (
                  <span className="text-success">✅ ≤ {vDate}</span>
                ) : (
                  <span className="text-destructive">❌ must be ≤ {vDate}</span>
                )
              ) : null}
            </Label>
            <Input type="date" max={vDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>
              Rental End{" "}
              {endDate ? (
                endValid ? (
                  <span className="text-success">✅ ≥ {vDate}</span>
                ) : (
                  <span className="text-destructive">❌ must be ≥ {vDate}</span>
                )
              ) : null}
            </Label>
            <Input type="date" min={vDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        {/* Renter info */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Renter information</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Name *</Label>
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
            <div className="space-y-1">
              <Label>Date of Birth *</Label>
              <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Address *</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City, State ZIP" />
            </div>
            <div className="space-y-1">
              <Label>License # *</Label>
              <Input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>License State</Label>
              <Input value={dlState} onChange={(e) => setDlState(e.target.value.toUpperCase())} maxLength={2} placeholder="NJ" />
            </div>
          </div>
        </div>

        {/* Signing method */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Signing method</p>
          <RadioGroup value={method} onValueChange={(val) => setMethod(val as "link" | "admin")}>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
              <RadioGroupItem value="link" id="m-link" className="mt-1" />
              <div>
                <p className="font-medium">Send Sign Link to Customer <span className="text-xs text-muted-foreground">(recommended)</span></p>
                <p className="text-xs text-muted-foreground">
                  Texts the customer a link (via SMS) to confirm details and sign at
                  /sign-agreement-retro. Status becomes “Awaiting signature”.
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
              <RadioGroupItem value="admin" id="m-admin" className="mt-1" />
              <div>
                <p className="font-medium">Admin Sign on Behalf</p>
                <p className="text-xs text-muted-foreground">
                  Capture the customer's signature in person, or proceed with their typed name.
                  Generates the signed agreement immediately.
                </p>
              </div>
            </label>
          </RadioGroup>

          {method === "admin" && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <Label>Customer signature (optional — typed name is used if left blank)</Label>
              <SignaturePad value={signature ?? undefined} onChange={setSignature} height={140} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy
              ? "Working…"
              : method === "link"
                ? "Create & Send Sign Link"
                : "Create & Sign Agreement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}