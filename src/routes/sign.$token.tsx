
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getRentalForSigning, submitSigningPackage } from "@/lib/sign.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/app/SignaturePad";
import { RentalAgreement } from "@/components/app/RentalAgreement";
import { toast } from "sonner";
import { CheckCircle2, Loader2, ArrowLeft, ArrowRight } from "lucide-react";

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
  const [step, setStep] = useState<"identity" | "agreement">("identity");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetchInfo({ data: { token } })
      .then((r) => {
        setInfo(r);
        if (r.driverName) setSignedBy(r.driverName);
        if (r.alreadySigned) setDone(true);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [token, fetchInfo]);

  // Auto-advance to agreement step once both ID and selfie are uploaded.
  useEffect(() => {
    if (step !== "identity") return;
    if (!licenseUrl || !selfieUrl) return;
    setVerifying(true);
    const t = setTimeout(() => {
      setVerifying(false);
      setStep("agreement");
    }, 900);
    return () => clearTimeout(t);
  }, [licenseUrl, selfieUrl, step]);

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
          <p className="mt-2 text-sm text-muted-foreground">
            Please contact Camauto Rentals if you believe this is a mistake.
          </p>
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
          <div className="mt-4 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-foreground">
            📱 A payment link will be texted to your phone in the next minute.
            Please complete payment to confirm your reservation.
          </div>
        </Card>
      </div>
    );
  }

  // Build props for RentalAgreement from what the server returns
  const agreementDriver = {
    fullName: info.driverName ?? "",
    dateOfBirth: (info as any).dateOfBirth ?? null,
    licenseNumber: (info as any).licenseNumber ?? "",
    licenseExpiry: (info as any).licenseExpiry ?? "",
    phone: (info as any).phone ?? "",
    email: (info as any).email ?? "",
    address: (info as any).address ?? "",
  };

  const agreementVehicle = {
    year: info.vehicle?.year ?? "",
    make: info.vehicle?.make ?? "",
    model: info.vehicle?.model ?? "",
    color: (info.vehicle as any)?.color ?? "",
    plate: info.vehicle?.plate ?? "",
    vin: (info.vehicle as any)?.vin ?? "",
    mileage: (info.vehicle as any)?.mileage ?? 0,
    fuelLevelPickup: (info.vehicle as any)?.fuelLevelPickup ?? null,
    ezPassTag: (info.vehicle as any)?.ezPassTag ?? null,
  };

  const agreementRental = {
    billingPeriod: info.billingPeriod ?? "weekly",
    rate: info.rate,
    weeklyRate: info.rate,
    startDate: info.startDate,
    endDate: (info as any).endDate ?? null,
    depositPaid: (info as any).depositPaid ?? null,
    extensions: (info as any).extensions ?? [],
    signatureDataUrl: null,
    signedBy: null,
    signedAt: null,
    agreementVersion: (info as any).agreementVersion ?? null,
  };

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6 space-y-6">
      <div className="text-center text-xs text-muted-foreground">
        Step {step === "identity" ? "1" : "2"} of 2
      </div>

      {step === "identity" ? (
        <>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2db84b] text-xs font-bold text-white">1</span>
              <h2 className="font-semibold text-sm">Upload your driver's license</h2>
              {licenseUrl && <CheckCircle2 className="h-4 w-4 text-emerald-600 ml-auto" />}
            </div>
            <Card className="p-4">
              <PhotoCapture label="Upload license" onChange={setLicenseUrl} value={licenseUrl} />
            </Card>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2db84b] text-xs font-bold text-white">2</span>
              <h2 className="font-semibold text-sm">Take a selfie</h2>
              {selfieUrl && <CheckCircle2 className="h-4 w-4 text-emerald-600 ml-auto" />}
            </div>
            <Card className="p-4">
              <PhotoCapture label="Take selfie" onChange={setSelfieUrl} value={selfieUrl} useCamera />
            </Card>
          </div>

          <Button
            className="w-full bg-[#2db84b] hover:bg-[#27a341] text-white"
            size="lg"
            disabled={!licenseUrl || !selfieUrl || verifying}
            onClick={() => setStep("agreement")}
          >
            {verifying ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…</>
            ) : (
              <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>
            )}
          </Button>
        </>
      ) : (
        <>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2db84b] text-xs font-bold text-white">3</span>
              <h2 className="font-semibold text-sm">Read your rental agreement</h2>
            </div>
            <div className="rounded-lg border shadow-sm overflow-hidden">
              <RentalAgreement
                rental={agreementRental as any}
                driver={agreementDriver as any}
                vehicle={agreementVehicle as any}
              />
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2db84b] text-xs font-bold text-white">4</span>
              <h2 className="font-semibold text-sm">Sign the agreement</h2>
              {sig && <CheckCircle2 className="h-4 w-4 text-emerald-600 ml-auto" />}
            </div>
            <Card className="p-4 space-y-4">
              <div>
                <Label htmlFor="signedBy">Your full legal name</Label>
                <Input
                  id="signedBy"
                  value={signedBy}
                  onChange={(e) => setSignedBy(e.target.value)}
                  className="mt-1"
                  placeholder="As it appears on your license"
                />
              </div>
              <SignaturePad value={sig ?? undefined} onChange={setSig} />
            </Card>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="lg" onClick={() => setStep("identity")} disabled={submitting}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <Button
              className="flex-1 bg-[#2db84b] hover:bg-[#27a341] text-white"
              size="lg"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
                : "Submit & complete reservation"}
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground pb-4">
            By submitting you confirm you have read and agree to the rental agreement above.
          </p>
        </>
      )}
    </div>
  );
}

function PhotoCapture({
  label,
  onChange,
  value,
  useCamera,
}: {
  label: string;
  onChange: (dataUrl: string | null) => void;
  value: string | null;
  useCamera?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "uploaded" | "error">(
    value ? "uploaded" : "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const MAX_BYTES = 5 * 1024 * 1024;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    console.log(`[${label}] file selected:`, file.name, `${(file.size / 1024 / 1024).toFixed(2)}MB`);
    if (file.size > MAX_BYTES) {
      const msg = "File too large, max 5MB";
      console.error(`[${label}] ${msg}`);
      setErrorMsg(msg);
      setStatus("error");
      toast.error(msg);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setErrorMsg(null);
    setStatus("uploading");
    console.log(`[${label}] uploading...`);
    const reader = new FileReader();
    reader.onerror = () => {
      console.error(`[${label}] FileReader error`);
      setErrorMsg("Could not read file");
      setStatus("error");
      toast.error("Could not read file");
    };
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => {
        console.error(`[${label}] image decode error`);
        setErrorMsg("Invalid image file");
        setStatus("error");
        toast.error("Invalid image file");
      };
      img.onload = () => {
        try {
          const max = 1600;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            onChange(reader.result as string);
          } else {
            ctx.drawImage(img, 0, 0, w, h);
            onChange(canvas.toDataURL("image/jpeg", 0.85));
          }
          console.log(`[${label}] upload complete`);
          setStatus("uploaded");
        } catch (err) {
          console.error(`[${label}] processing error`, err);
          setErrorMsg("Could not process image");
          setStatus("error");
          toast.error("Could not process image");
        }
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
      {value && status !== "uploading" && status !== "error" ? (
        <div className="space-y-2">
          <img
            src={value}
            alt={label}
            className="max-h-48 w-full rounded border object-contain bg-muted/30"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Uploaded
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              Replace
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={status === "uploading"}
            onClick={() => inputRef.current?.click()}
          >
            {status === "uploading" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…
              </>
            ) : status === "error" ? (
              `Retry — ${label}`
            ) : (
              label
            )}
          </Button>
          {status === "error" && errorMsg && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}
        </div>
      )}
    </div>
  );
}
