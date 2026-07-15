import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { submitWaitlistEntry } from "@/lib/waitlist.functions";

export const Route = createFileRoute("/waitlist")({
  head: () => ({
    meta: [
      { title: "Join the Waitlist — Camauto Rentals" },
      { name: "description", content: "Reserve your spot for the next available vehicle from Camauto Rentals." },
      { property: "og:title", content: "Join the Waitlist — Camauto Rentals" },
      { property: "og:description", content: "Reserve your spot for the next available vehicle from Camauto Rentals." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WaitlistPage,
});

function WaitlistPage() {
  const submit = useServerFn(submitWaitlistEntry);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const canSubmit =
    name.trim().length >= 2 &&
    phone.trim().length >= 7 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    !!licenseUrl &&
    !!selfieUrl &&
    !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !licenseUrl || !selfieUrl) return;
    setSubmitting(true);
    try {
      await submit({
        data: {
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          licenseDataUrl: licenseUrl,
          selfieDataUrl: selfieUrl,
        },
      });
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto min-h-screen max-w-lg px-4 py-12">
        <Card className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-semibold">You're on the list! ✅</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Your info has been received and you're officially in line for the next
            available vehicle. Someone from our team will be in contact with you shortly.
          </p>
          <p className="mt-4 text-sm font-medium">— Camauto Rentals</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 py-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold">Join the Waitlist</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reserve your spot for the next available vehicle from Camauto Rentals.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <Card className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="wl-name">Full name</Label>
            <Input
              id="wl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              autoComplete="name"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wl-phone">Phone number</Label>
            <Input
              id="wl-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              autoComplete="tel"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wl-email">Email</Label>
            <Input
              id="wl-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
        </Card>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2db84b] text-xs font-bold text-white">1</span>
            <h2 className="text-sm font-semibold">Upload your driver's license</h2>
            {licenseUrl && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" />}
          </div>
          <Card className="p-4">
            <PhotoCapture label="Upload license" onChange={setLicenseUrl} value={licenseUrl} />
          </Card>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2db84b] text-xs font-bold text-white">2</span>
            <h2 className="text-sm font-semibold">Take a selfie</h2>
            {selfieUrl && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" />}
          </div>
          <Card className="p-4">
            <PhotoCapture label="Take selfie" onChange={setSelfieUrl} value={selfieUrl} useCamera />
          </Card>
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full bg-[#2db84b] text-white hover:bg-[#27a341]"
          disabled={!canSubmit}
        >
          {submitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
          ) : (
            <>Join Waitlist <ArrowRight className="ml-2 h-4 w-4" /></>
          )}
        </Button>
      </form>
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
  const MAX_BYTES = 25 * 1024 * 1024;

  useEffect(() => {
    if (value && status !== "uploaded" && status !== "uploading") setStatus("uploaded");
  }, [value, status]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      const msg = "File too large, max 25MB";
      setErrorMsg(msg); setStatus("error"); toast.error(msg);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setErrorMsg(null); setStatus("uploading");
    const reader = new FileReader();
    reader.onerror = () => { setErrorMsg("Could not read file"); setStatus("error"); };
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => { setErrorMsg("Invalid image file"); setStatus("error"); };
      img.onload = () => {
        try {
          const max = useCamera ? 1024 : 1600;
          const quality = useCamera ? 0.75 : 0.85;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) onChange(reader.result as string);
          else {
            ctx.drawImage(img, 0, 0, w, h);
            onChange(canvas.toDataURL("image/jpeg", quality));
          }
          setStatus("uploaded");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Could not process image";
          setErrorMsg(msg); setStatus("error"); toast.error(msg);
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
        {...(useCamera ? { capture: "user" as const } : {})}
        className="hidden"
        onChange={onFile}
      />
      {value && status !== "uploading" && status !== "error" ? (
        <div className="space-y-2">
          <img src={value} alt={label} className="max-h-48 w-full rounded border bg-muted/30 object-contain" />
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Uploaded
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
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
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>
            ) : status === "error" ? `Retry — ${label}` : label}
          </Button>
          {status === "error" && errorMsg && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}
        </div>
      )}
    </div>
  );
}