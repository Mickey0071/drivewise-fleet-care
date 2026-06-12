import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SignaturePad } from "@/components/app/SignaturePad";
import { getRetroAgreement, submitRetroAgreement } from "@/lib/retro-agreement.functions";
import { DEFAULT_SETTINGS, renderClauseBody } from "@/lib/agreementSettings";

export const Route = createFileRoute("/sign-agreement-retro/$token")({
  head: () => ({ meta: [{ title: "Retroactive Rental Agreement — Camauto Rentals" }] }),
  component: RetroSignPage,
});

type Info = Awaited<ReturnType<typeof getRetroAgreement>>;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function RetroSignPage() {
  const { token } = Route.useParams();
  const fetchInfo = useServerFn(getRetroAgreement);
  const submit = useServerFn(submitRetroAgreement);

  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [dlState, setDlState] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const [ack3, setAck3] = useState(false);
  const [ack4, setAck4] = useState(false);

  useEffect(() => {
    let active = true;
    fetchInfo({ data: { token } })
      .then((d) => {
        if (!active) return;
        setInfo(d);
        setFullName(d.renter_name || "");
        setAddress(d.address || "");
        setLicenseNumber(d.dl_number || "");
        setDlState(d.dl_state || "");
        setDateOfBirth(d.dob || "");
        setPhone(d.phone || "");
        setEmail(d.email || "");
        if (d.retro_signed_at) setDone(true);
      })
      .catch((e) => active && setLoadError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      active = false;
    };
  }, [token, fetchInfo]);

  const allAck = ack1 && ack2 && ack3 && ack4;
  const canSubmit = fullName.trim().length > 1 && sig && allAck && !submitting;

  const handleSubmit = async () => {
    if (!sig) {
      toast.error("Please sign before submitting");
      return;
    }
    if (!allAck) {
      toast.error("Please check all acknowledgements");
      return;
    }
    setSubmitting(true);
    try {
      await submit({
        data: {
          token,
          fullName: fullName.trim(),
          address,
          licenseNumber,
          dlState,
          dateOfBirth,
          phone,
          email,
          signatureDataUrl: sig,
          ack1: true,
          ack2: true,
          ack3: true,
          ack4: true,
        },
      });
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center p-6">
        <Card>
          <CardContent className="space-y-2 p-8 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
            <p className="font-medium">{loadError}</p>
            <p className="text-sm text-muted-foreground">
              Please contact Camauto Rentals at 1-866-625-5550.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center p-6">
        <Card>
          <CardContent className="space-y-2 p-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <h1 className="text-xl font-semibold">Agreement Signed</h1>
            <p className="text-sm text-muted-foreground">
              Thank you. Your signed rental agreement has been recorded.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const vehicleLabel = [info.year, info.vehicle].filter(Boolean).join(" ") || "Vehicle on file";

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-emerald-700">Retroactive Rental Agreement</h1>
        <p className="text-sm text-muted-foreground">Camauto Rentals</p>
        <p className="mt-1 text-sm">
          Please sign for your past rental on <strong>{fmtDate(info.start_datetime)}</strong>
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-1 p-4 text-sm">
          <div>
            <span className="text-muted-foreground">Vehicle: </span>
            {vehicleLabel}
            {info.plate ? ` — Plate ${info.plate}` : ""}
          </div>
          <div>
            <span className="text-muted-foreground">Rental period: </span>
            {fmtDate(info.start_datetime)} to {fmtDate(info.end_datetime)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-2 font-semibold">Rental Agreement Terms</h2>
          <ScrollArea className="h-64 rounded-md border p-3 text-xs leading-relaxed">
            {DEFAULT_SETTINGS.clauses.map((c) => (
              <div key={c.title} className="mb-3">
                <p className="font-semibold">{c.title}</p>
                <p className="text-muted-foreground">{renderClauseBody(c.body, DEFAULT_SETTINGS)}</p>
              </div>
            ))}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4">
          <h2 className="font-semibold">Your Information</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>Full Name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Date of Birth</Label>
              <Input value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} placeholder="MM/DD/YYYY" />
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label>Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Driver's License #</Label>
              <Input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>License State</Label>
              <Input value={dlState} onChange={(e) => setDlState(e.target.value.toUpperCase().slice(0, 2))} placeholder="NJ" />
            </div>
            <div className="grid gap-1">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4">
          <h2 className="font-semibold">Signature</h2>
          <SignaturePad value={sig ?? undefined} onChange={setSig} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4 text-sm">
          {[
            { c: ack1, set: setAck1, label: "I confirm I rented this vehicle on the dates shown" },
            { c: ack2, set: setAck2, label: "I accept all terms of this rental agreement" },
            { c: ack3, set: setAck3, label: "I authorize charges for any violations during this rental period" },
            { c: ack4, set: setAck4, label: "I understand my electronic signature is legally binding" },
          ].map((row, i) => (
            <label key={i} className="flex items-start gap-2">
              <Checkbox checked={row.c} onCheckedChange={(v) => row.set(Boolean(v))} className="mt-0.5" />
              <span>{row.label}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full bg-emerald-600 hover:bg-emerald-700"
        size="lg"
      >
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Submit Signed Agreement
      </Button>
    </div>
  );
}