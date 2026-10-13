import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/camauto-logo.jpeg";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhotoCapture } from "@/components/app/PhotoCapture";
import { SignaturePad } from "@/components/app/SignaturePad";
import { US_STATES } from "@/lib/us-states";
import { DEFAULT_SETTINGS, renderClauseBody } from "@/lib/agreementSettings";
import { ACKNOWLEDGEMENTS } from "@/lib/additional-driver-addendum";
import { getAdditionalDriverInvite, submitAdditionalDriver } from "@/lib/additional-drivers.functions";

export const Route = createFileRoute("/add-driver/$token")({
  head: () => ({
    meta: [
      { title: "Add an additional driver — Camauto Rentals" },
      { name: "description", content: "Complete your additional driver application for a Camauto rental." },
      { property: "og:title", content: "Add an additional driver — Camauto Rentals" },
      { property: "og:description", content: "Verify your license and sign the additional driver addendum." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AddDriverPage,
});

const STEPS = ["Your information", "Documents", "Agreement", "Signature"];

function AddDriverPage() {
  const { token } = Route.useParams();
  const getInvite = useServerFn(getAdditionalDriverInvite);
  const submit = useServerFn(submitAdditionalDriver);
  const { data: invite, isLoading } = useQuery({
    queryKey: ["add-driver", token],
    queryFn: () => getInvite({ data: { token } }),
    retry: false,
  });

  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    fullName: "", dateOfBirth: "", phone: "", email: "",
    streetAddress: "", city: "", state: "", zipCode: "",
    licenseNumber: "", licenseState: "", licenseExpiration: "",
  });
  const [license, setLicense] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [signature, setSignature] = useState<string | null>(null);
  const [printedName, setPrintedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ paymentLink: string | null } | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  if (isLoading) {
    return <Shell><div className="py-16 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />Loading…</div></Shell>;
  }
  if (!invite || !invite.found || invite.expired || invite.used) {
    const msg = !invite || !invite.found ? "This link is not valid." : invite.used ? "This link has already been used." : "This link has expired. Ask the renter to request a new one.";
    return <Shell><Card className="p-6 text-center"><h1 className="text-lg font-semibold">Link unavailable</h1><p className="mt-2 text-sm text-muted-foreground">{msg}</p></Card></Shell>;
  }

  const veh = invite.vehicle;
  const vehLabel = veh ? `${veh.year} ${veh.make} ${veh.model}`.trim() : "Vehicle";

  if (done) {
    return (
      <Shell>
        <Card className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary"><CheckCircle2 className="h-8 w-8" /></div>
          <h1 className="text-xl font-semibold">Application received</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Thanks, {f.fullName.split(/\s+/)[0]}. We'll review it and text you. <strong>You are not authorized to drive until we approve you.</strong>
          </p>
          {done.paymentLink && (
            <Button asChild className="mt-5 w-full"><a href={done.paymentLink}>Continue to payment verification <ArrowRight className="ml-2 h-4 w-4" /></a></Button>
          )}
        </Card>
      </Shell>
    );
  }

  const step0Ok = f.fullName.trim().length > 1 && f.dateOfBirth && f.phone.trim().length >= 7 && f.streetAddress.trim() && f.city.trim() && f.state && f.zipCode.trim() && f.licenseNumber.trim().length >= 3 && f.licenseState && f.licenseExpiration;
  const step1Ok = !!license && !!selfie;
  const step2Ok = ACKNOWLEDGEMENTS.every((a) => acks[a.key]);
  const step3Ok = !!signature && printedName.trim().length > 1;
  const canNext = [step0Ok, step1Ok, step2Ok, step3Ok][step];

  async function onSubmit() {
    if (!step3Ok || !license || !selfie || !signature) return;
    setBusy(true);
    try {
      const res = await submit({
        data: {
          token, ...f, email: f.email || undefined,
          licenseDataUrl: license, selfieDataUrl: selfie, signatureDataUrl: signature,
          printedName, acks: Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, true as const])),
        },
      });
      setDone({ paymentLink: res.paymentLink });
      window.scrollTo(0, 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Card className="mb-5 p-4 text-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">You're joining</div>
        <div className="mt-1 font-semibold">{vehLabel}{veh?.plate ? ` · ${veh.plate}` : ""}</div>
        <div className="text-muted-foreground">Primary renter: {invite.renterName || "—"}</div>
        <div className="text-muted-foreground">Rental period: {invite.startDate ?? "?"} → {invite.endDate ?? "open-ended"}</div>
      </Card>

      <div className="mb-4 flex gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>
      <h2 className="mb-3 text-lg font-semibold">Step {step + 1} — {STEPS[step]}</h2>

      {step === 0 && (
        <Card className="space-y-3 p-4">
          <F label="Full legal name *"><Input value={f.fullName} onChange={set("fullName")} autoComplete="name" /></F>
          <div className="grid grid-cols-2 gap-3">
            <F label="Date of birth *"><Input type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} /></F>
            <F label="Phone *"><Input type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" /></F>
          </div>
          <F label="Email"><Input type="email" value={f.email} onChange={set("email")} autoComplete="email" /></F>
          <F label="Street address *"><Input value={f.streetAddress} onChange={set("streetAddress")} autoComplete="street-address" /></F>
          <div className="grid grid-cols-3 gap-3">
            <F label="City *"><Input value={f.city} onChange={set("city")} /></F>
            <F label="State *"><StateSelect value={f.state} onChange={(v) => setF((p) => ({ ...p, state: v }))} /></F>
            <F label="ZIP *"><Input inputMode="numeric" value={f.zipCode} onChange={set("zipCode")} /></F>
          </div>
          <F label="Driver license number *"><Input value={f.licenseNumber} onChange={set("licenseNumber")} /></F>
          <div className="grid grid-cols-2 gap-3">
            <F label="License state *"><StateSelect value={f.licenseState} onChange={(v) => setF((p) => ({ ...p, licenseState: v }))} /></F>
            <F label="License expiration *"><Input type="date" value={f.licenseExpiration} onChange={set("licenseExpiration")} /></F>
          </div>
        </Card>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <Card className="space-y-2 p-4"><Label>Driver's license — front *</Label><PhotoCapture label="Upload license (front)" value={license} onChange={setLicense} /></Card>
          <Card className="space-y-2 p-4"><Label>Selfie *</Label><PhotoCapture label="Take a selfie" value={selfie} onChange={setSelfie} /></Card>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Card className="p-0">
            <div className="border-b px-4 py-2 text-sm font-semibold">Vehicle Rental Agreement — {vehLabel}{veh?.plate ? ` (${veh.plate})` : ""}</div>
            <div className="max-h-80 space-y-2 overflow-y-auto px-4 py-3 text-xs leading-relaxed">
              <p><strong>Agreement No.:</strong> {invite.agreementNumber} · <strong>Primary renter:</strong> {invite.renterName} · <strong>Period:</strong> {invite.startDate ?? "?"} → {invite.endDate ?? "open-ended"}</p>
              {veh && <p><strong>Vehicle:</strong> {vehLabel} · Plate {veh.plate} · VIN {veh.vin}{veh.color ? ` · ${veh.color}` : ""}</p>}
              {DEFAULT_SETTINGS.clauses.map((c, i) => (
                <div key={i}><h4 className="mt-2 font-bold">{i + 1}. {c.title}</h4><p>{renderClauseBody(c.body, DEFAULT_SETTINGS)}</p></div>
              ))}
            </div>
          </Card>
          <Card className="space-y-3 p-4">
            {ACKNOWLEDGEMENTS.map((a) => (
              <label key={a.key} className="flex items-start gap-3 text-sm">
                <Checkbox className="mt-0.5" checked={!!acks[a.key]} onCheckedChange={(v) => setAcks((p) => ({ ...p, [a.key]: v === true }))} />
                <span>{a.text}</span>
              </label>
            ))}
          </Card>
        </div>
      )}

      {step === 3 && (
        <Card className="space-y-3 p-4">
          <Label>Signature *</Label>
          <div className="rounded border bg-white"><SignaturePad value={signature ?? undefined} onChange={setSignature} /></div>
          <F label="Printed name *"><Input value={printedName} onChange={(e) => setPrintedName(e.target.value)} placeholder={f.fullName} /></F>
          <p className="text-xs text-muted-foreground">Date: {new Date().toLocaleDateString()} (stamped automatically)</p>
          {invite.isAlsoPayer && <p className="text-xs text-muted-foreground">After submitting you'll continue to payment verification.</p>}
        </Card>
      )}

      <div className="mt-5 flex gap-3">
        {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)} disabled={busy}><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>}
        {step < 3 ? (
          <Button className="flex-1" disabled={!canNext} onClick={() => { setStep(step + 1); window.scrollTo(0, 0); }}>Next <ArrowRight className="ml-1 h-4 w-4" /></Button>
        ) : (
          <Button className="flex-1" disabled={!step3Ok || busy} onClick={onSubmit}>
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : "Sign & submit"}
          </Button>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 py-6">
      <div className="mb-5 flex flex-col items-center gap-1 text-center">
        <img src={logo} alt="Camauto Rentals" className="h-14 w-auto" />
        <h1 className="text-xl font-bold">Additional driver application</h1>
      </div>
      {children}
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}

function StateSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="State" /></SelectTrigger>
      <SelectContent>{US_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code}</SelectItem>)}</SelectContent>
    </Select>
  );
}
