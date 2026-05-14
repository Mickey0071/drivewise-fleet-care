import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getRentalForSigning, submitSigningPackage } from "@/lib/sign.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/app/SignaturePad";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Camera, FileSignature, IdCard } from "lucide-react";

export const Route = createFileRoute("/sign/$token")({
  head: () => ({ meta: [{ title: "Complete your reservation — Camauto Rentals" }] }),
  component: SignPage,
});

type RentalInfo = Awaited<ReturnType<typeof getRentalForSigning>>;

function SignPage() {
  const { token } = Route.useParams();
  const fetchInfo = useServerFn(getRentalForSigning);
  const submit = useServerFn(submitSigningPackage);
  const [info, setInfo] = useState<RentalInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signedBy, setSignedBy] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchInfo({ data: { token } })
      .then((r) => {
        setInfo(r);
        if (r.driverName) setSignedBy(r.driverName);
        if (r.alreadySigned) setDone(true);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [token, fetchInfo]);

  async function handleSubmit() {
    if (!sig) return toast.error("Please sign the agreement");
    if (!licenseUrl) return toast.error("Please upload your driver's license");
    if (!selfieUrl) return toast.error("Please take a selfie");
    if (!signedBy.trim()) return toast.error("Please type your full name");
    setSubmitting(true);
    try {
      await submit({
        data: {
          token,
          signatureDataUrl: sig,
          licenseDataUrl: licenseUrl,
          selfieDataUrl: selfieUrl,
          signedBy: signedBy.trim(),
        },
      });
      setDone(true);
      toast.success("All set — thank you!");
    } catch (e) {
      toast.error("Submission failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card className="p-6 text-center">
          <p className="text-destructive font-medium">{loadError}</p>
          <p className="mt-2 text-sm text-muted-foreground">Please contact Camauto Rentals if you believe this is a mistake.</p>
        </Card>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="mx-auto max-w-lg p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (done) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card className="p-8 text-center space-y-3">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <h1 className="text-xl font-semibold">All set!</h1>
          <p className="text-sm text-muted-foreground">
            Your signed agreement, driver's license, and selfie were received.
            We'll be in touch shortly to coordinate vehicle delivery.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Complete your reservation</h1>
        <p className="text-sm text-muted-foreground">
          {info.vehicle ? `${info.vehicle.year} ${info.vehicle.make} ${info.vehicle.model} · Plate ${info.vehicle.plate}` : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {info.billingPeriod === "daily" ? "Daily" : info.billingPeriod === "monthly" ? "Monthly" : "Weekly"} rate ${info.rate} · Starts {info.startDate}
        </p>
      </header>

      <Card className="p-4 space-y-3">
        <SectionHeader icon={<IdCard className="h-4 w-4" />} title="Driver's license photo" done={!!licenseUrl} />
        <PhotoCapture label="Upload license" onChange={setLicenseUrl} value={licenseUrl} />
      </Card>

      <Card className="p-4 space-y-3">
        <SectionHeader icon={<Camera className="h-4 w-4" />} title="Selfie" done={!!selfieUrl} />
        <PhotoCapture label="Take selfie" onChange={setSelfieUrl} value={selfieUrl} useCamera />
      </Card>

      <Card className="p-4 space-y-3">
        <SectionHeader icon={<FileSignature className="h-4 w-4" />} title="Sign rental agreement" done={!!sig} />
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground max-h-40 overflow-y-auto">
          By signing below, you agree to the Camauto Rentals rental agreement,
          authorize the listed payment method, certify the uploaded license and
          selfie are your own, and acknowledge the deposit and rental terms.
        </div>
        <div>
          <Label htmlFor="signedBy">Your full legal name</Label>
          <Input id="signedBy" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} className="mt-1" />
        </div>
        <SignaturePad value={sig ?? undefined} onChange={setSig} />
      </Card>

      <Button className="w-full" size="lg" onClick={handleSubmit} disabled={submitting}>
        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</> : "Submit & complete reservation"}
      </Button>
    </div>
  );
}

function SectionHeader({ icon, title, done }: { icon: React.ReactNode; title: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 font-medium text-sm">{icon}{title}</div>
      {done && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
    </div>
  );
}

function PhotoCapture({ label, onChange, value, useCamera }: {
  label: string;
  onChange: (dataUrl: string | null) => void;
  value: string | null;
  useCamera?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image too large (max 8MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // Downscale to keep payload small
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { onChange(reader.result as string); return; }
        ctx.drawImage(img, 0, 0, w, h);
        onChange(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture={useCamera ? "user" : undefined}
        className="hidden"
        onChange={onFile}
      />
      {value ? (
        <div className="space-y-2">
          <img src={value} alt={label} className="max-h-48 w-full rounded border object-contain bg-muted/30" />
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>Replace</Button>
        </div>
      ) : (
        <Button type="button" variant="outline" className="w-full" onClick={() => inputRef.current?.click()}>
          {label}
        </Button>
      )}
    </div>
  );
}