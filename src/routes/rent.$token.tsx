import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getShareLinkPublic, submitShareApplication } from "@/lib/share-rental.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SignaturePad } from "@/components/app/SignaturePad";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Camera, FileSignature, IdCard, User } from "lucide-react";

export const Route = createFileRoute("/rent/$token")({
  head: () => ({ meta: [{ title: "Rent a vehicle — Camauto Rentals" }] }),
  component: RentPage,
});

type Info = Awaited<ReturnType<typeof getShareLinkPublic>>;

function RentPage() {
  const { token } = Route.useParams();
  const fetchInfo = useServerFn(getShareLinkPublic);
  const submit = useServerFn(submitShareApplication);

  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [rideshare, setRideshare] = useState<"Uber" | "Lyft" | "Both">("Uber");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [address, setAddress] = useState("");
  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchInfo({ data: { token } })
      .then(setInfo)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [token, fetchInfo]);

  async function handleSubmit() {
    if (!fullName.trim()) return toast.error("Enter your full name");
    if (!phone.trim()) return toast.error("Enter your phone");
    if (!email.trim()) return toast.error("Email is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return toast.error("Enter a valid email address");
    if (!dateOfBirth) return toast.error("Enter your date of birth");
    if (!address.trim()) return toast.error("Enter your street address");
    if (!licenseNumber.trim()) return toast.error("Enter your license number");
    if (!licenseExpiry) return toast.error("Enter your license expiry");
    if (!licenseUrl) return toast.error("Upload your driver's license");
    if (!selfieUrl) return toast.error("Take a selfie");
    if (!sig) return toast.error("Sign the agreement");
    setSubmitting(true);
    try {
      await submit({
        data: {
          token,
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          licenseNumber: licenseNumber.trim(),
          licenseExpiry,
          rideshare,
          dateOfBirth: dateOfBirth || undefined,
          address: address.trim() || undefined,
          licenseDataUrl: licenseUrl,
          selfieDataUrl: selfieUrl,
          signatureDataUrl: sig,
        },
      });
      setDone(true);
      toast.success("Application received!");
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
          <h1 className="text-xl font-semibold">Application received</h1>
          <p className="text-sm text-muted-foreground">
            Thanks! We received your information, ID, and signed agreement.
            We'll be in touch shortly to confirm pickup.
          </p>
        </Card>
      </div>
    );
  }

  const periodLabel = info.billingPeriod === "daily" ? "day" : info.billingPeriod === "monthly" ? "month" : "week";

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6 space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Rent your vehicle</h1>
        {info.vehicle.imageUrl && (
          <img src={info.vehicle.imageUrl} alt="vehicle" className="aspect-[16/10] w-full rounded-lg border object-cover" />
        )}
        <p className="text-sm text-muted-foreground">
          {info.vehicle.year} {info.vehicle.make} {info.vehicle.model}
        </p>
        <p className="text-sm font-medium">${info.rate}/{periodLabel} · Starts {info.startDate}</p>
      </header>

      <Card className="p-4 space-y-3">
        <SectionHeader icon={<User className="h-4 w-4" />} title="Your info" done={!!fullName && !!phone && !!email && !!licenseNumber && !!licenseExpiry && !!dateOfBirth && !!address} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="fn">Full legal name</Label>
            <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ph">Phone</Label>
            <Input id="ph" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="dob">Date of birth</Label>
            <Input id="dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ad">Street address, city, state, ZIP</Label>
            <Input id="ad" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, Camden, NJ 08104" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="em">Email <span className="text-destructive">*</span></Label>
            <Input id="em" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ln">License number</Label>
            <Input id="ln" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="le">License expiry</Label>
            <Input id="le" type="date" value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rs">Rideshare platform</Label>
            <Select value={rideshare} onValueChange={(v) => setRideshare(v as "Uber" | "Lyft" | "Both")}>
              <SelectTrigger id="rs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Uber">Uber</SelectItem>
                <SelectItem value="Lyft">Lyft</SelectItem>
                <SelectItem value="Both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

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
        <SignaturePad value={sig ?? undefined} onChange={setSig} />
      </Card>

      <Button className="w-full" size="lg" onClick={handleSubmit} disabled={submitting}>
        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</> : "Submit application"}
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