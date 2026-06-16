import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getShareLinkPublic, submitShareApplication } from "@/lib/share-rental.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/app/SignaturePad";
import { RentalAgreement } from "@/components/app/RentalAgreement";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Camera, FileSignature, IdCard, User, ArrowLeft, ArrowRight } from "lucide-react";
import { US_STATES, formatFullName, formatAddressBlock } from "@/lib/us-states";
import { getStripeEnvironment } from "@/lib/stripe";

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

  const [firstName, setFirstName] = useState("");
  const [middleInitial, setMiddleInitial] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [dlState, setDlState] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [address, setAddress] = useState("");
  const [aptUnit, setAptUnit] = useState("");
  const [city, setCity] = useState("");
  const [stateRegion, setStateRegion] = useState("");
  const [zip, setZip] = useState("");
  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [step, setStep] = useState<"details" | "agreement" | "sign">("details");

  useEffect(() => {
    fetchInfo({ data: { token } })
      .then(setInfo)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleSubmit() {
    if (!firstName.trim() || !lastName.trim()) return toast.error("Enter your first and last name");
    if (!phone.trim()) return toast.error("Enter your phone");
    if (!email.trim()) return toast.error("Email is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return toast.error("Enter a valid email address");
    if (!dateOfBirth) return toast.error("Enter your date of birth");
    if (!address.trim()) return toast.error("Enter your street address");
    if (!city.trim()) return toast.error("Enter your city");
    if (!stateRegion.trim()) return toast.error("Enter your state");
    if (!licenseNumber.trim()) return toast.error("Enter your license number");
    if (!licenseUrl) return toast.error("Upload your driver's license");
    if (!selfieUrl) return toast.error("Take a selfie");
    if (!sig) return toast.error("Sign the agreement");
    setSubmitting(true);
    try {
      const fullName = formatFullName({ firstName, middleInitial, lastName });
      let environment: "sandbox" | "live" | undefined;
      try {
        environment = getStripeEnvironment();
      } catch {
        environment = undefined;
      }
      const res = await submit({
        data: {
          token,
          fullName: fullName.trim(),
          firstName: firstName.trim(),
          middleInitial: middleInitial.trim() || undefined,
          lastName: lastName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          licenseNumber: licenseNumber.trim(),
          licenseExpiry: licenseExpiry || undefined,
          dlState: dlState || undefined,
          dateOfBirth: dateOfBirth || undefined,
          address: address.trim() || undefined,
          streetAddress: address.trim() || undefined,
          aptUnit: aptUnit.trim() || undefined,
          city: city.trim() || undefined,
          state: stateRegion.trim() || undefined,
          zip: zip.trim() || undefined,
          licenseDataUrl: licenseUrl,
          selfieDataUrl: selfieUrl,
          signatureDataUrl: sig,
          environment,
        },
      });
      if (res?.paymentUrl) {
        setRedirecting(true);
        toast.success("Almost done — redirecting to secure payment…");
        window.location.href = res.paymentUrl;
        return;
      }
      setDone(true);
      toast.success("Thank you for choosing Camauto");
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
          <h1 className="text-xl font-semibold">Thank you for choosing Camauto</h1>
          <p className="text-sm text-muted-foreground">
            We received your information, ID, and signed agreement. We'll be in touch shortly to confirm pickup.
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

      <div className="text-center text-xs text-muted-foreground">
        Step {step === "details" ? "1" : step === "agreement" ? "2" : "3"} of 3
      </div>

      {step === "details" && (
        <>
          <Card className="p-4 space-y-3">
            <SectionHeader icon={<User className="h-4 w-4" />} title="Your info" done={!!firstName && !!lastName && !!phone && !!email && !!licenseNumber && !!dateOfBirth && !!address && !!city && !!stateRegion} />
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-3">
                <Label htmlFor="fn">First name</Label>
                <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="sm:col-span-1">
                <Label htmlFor="mi">M.I.</Label>
                <Input id="mi" maxLength={2} value={middleInitial} onChange={(e) => setMiddleInitial(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="ln2">Last name</Label>
                <Input id="ln2" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="ph">Phone</Label>
                <Input id="ph" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="em">Email</Label>
                <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="dob">Date of birth</Label>
                <Input id="dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="ln">DL number</Label>
                <Input id="ln" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="dlst">DL state</Label>
                <select id="dlst" className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={dlState} onChange={(e) => setDlState(e.target.value)}>
                  <option value="">—</option>
                  {US_STATES.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}
                </select>
              </div>
              <div className="sm:col-span-4">
                <Label htmlFor="lex">DL expiration</Label>
                <Input id="lex" type="date" value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} />
              </div>
              <div className="sm:col-span-4">
                <Label htmlFor="ad">Street address</Label>
                <Input id="ad" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="apt">Apt / Unit</Label>
                <Input id="apt" value={aptUnit} onChange={(e) => setAptUnit(e.target.value)} placeholder="4B" />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="city">City</Label>
                <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Camden" />
              </div>
              <div className="sm:col-span-1">
                <Label htmlFor="st">State</Label>
                <select id="st" className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={stateRegion} onChange={(e) => setStateRegion(e.target.value)}>
                  <option value="">—</option>
                  {US_STATES.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="zip">ZIP</Label>
                <Input id="zip" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="08104" maxLength={10} />
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

          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              if (!firstName.trim() || !lastName.trim() || !phone.trim() || !email.trim() || !dateOfBirth || !address.trim() || !city.trim() || !stateRegion.trim() || !licenseNumber.trim() || !licenseUrl || !selfieUrl) {
                return toast.error("Complete all fields, license photo, and selfie first");
              }
              setStep("agreement");
            }}
          >
            Review rental agreement <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </>
      )}

      {step === "agreement" && (
        <>
          <Card className="p-2 overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              <RentalAgreement
                rental={{
                  billingPeriod: info.billingPeriod ?? "weekly",
                  rate: info.rate,
                  weeklyRate: info.rate,
                  startDate: info.startDate,
                  endDate: null,
                  depositPaid: null,
                  extensions: [],
                  signatureDataUrl: null,
                  signedBy: null,
                  signedAt: null,
                  agreementVersion: null,
                } as any}
                driver={{
                  fullName: formatFullName({ firstName, middleInitial, lastName }),
                  firstName,
                  middleInitial,
                  lastName,
                  dateOfBirth: dateOfBirth || null,
                  licenseNumber,
                  licenseExpiry: licenseExpiry || "",
                  dlState,
                  phone,
                  email,
                  address: formatAddressBlock({ streetAddress: address, aptUnit, city, state: stateRegion, zipCode: zip }),
                  streetAddress: address,
                  aptUnit,
                  city,
                  state: stateRegion,
                  zipCode: zip,
                } as any}
                vehicle={{
                  year: info.vehicle?.year ?? "",
                  make: info.vehicle?.make ?? "",
                  model: info.vehicle?.model ?? "",
                  color: "",
                  plate: "",
                  vin: "",
                  mileage: 0,
                  fuelLevelPickup: null,
                  ezPassTag: null,
                } as any}
              />
            </div>
          </Card>
          <div className="flex gap-2">
            <Button variant="outline" size="lg" onClick={() => setStep("details")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <Button className="flex-1" size="lg" onClick={() => setStep("sign")}>
              I&rsquo;ve read it &mdash; continue to sign <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {step === "sign" && (
        <>
          <Card className="p-4 space-y-3">
            <SectionHeader icon={<FileSignature className="h-4 w-4" />} title="Sign rental agreement" done={!!sig} />
            <p className="text-xs text-muted-foreground">
              By signing below, you agree to the rental agreement you just reviewed,
              authorize the listed payment method, and certify the uploaded license
              and selfie are your own.
            </p>
            <SignaturePad value={sig ?? undefined} onChange={setSig} />
          </Card>
          <div className="flex gap-2">
            <Button variant="outline" size="lg" onClick={() => setStep("agreement")} disabled={submitting}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <Button className="flex-1" size="lg" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</> : "Submit application"}
            </Button>
          </div>
        </>
      )}
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
    // Reset so selecting the same file again still fires onChange
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image too large (max 8MB)");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("Could not read photo — try again");
    reader.onload = () => {
      const rawDataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { onChange(rawDataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        try {
          onChange(canvas.toDataURL("image/jpeg", 0.85));
        } catch {
          // Cross-origin / tainted canvas — fall back to raw
          onChange(rawDataUrl);
        }
      };
      img.onerror = () => {
        // Browser can't decode (e.g. iPhone HEIC) — keep the original so it still saves
        onChange(rawDataUrl);
        toast.message("Photo saved (preview may not render in this browser)");
      };
      img.src = rawDataUrl;
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
        // iOS Safari ignores .click() on display:none inputs.
        // Use visually-hidden positioning instead so the camera/file picker opens reliably.
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", overflow: "hidden" }}
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