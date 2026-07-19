import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { getWaitlistEntryByToken, submitWaitlistDocsByToken } from "@/lib/waitlist.functions";

export const Route = createFileRoute("/waitlist/upload/$token")({
  head: () => ({
    meta: [
      { title: "Upload your info — Camauto Rentals" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WaitlistUploadPage,
});

function WaitlistUploadPage() {
  const { token } = Route.useParams();
  const getEntry = useServerFn(getWaitlistEntryByToken);
  const submit = useServerFn(submitWaitlistDocsByToken);

  const { data: entry, isLoading, error, refetch } = useQuery({
    queryKey: ["waitlist-token", token],
    queryFn: () => getEntry({ data: { token } }),
    retry: false,
  });

  const [licenseFrontUrl, setLicenseFrontUrl] = useState<string | null>(null);
  const [licenseBackUrl, setLicenseBackUrl] = useState<string | null>(null);
  const [rideshareUrl, setRideshareUrl] = useState<string | null>(null);
  const [pref, setPref] = useState<string>("");
  const [cadence, setCadence] = useState<"Daily" | "Weekly" | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (entry) {
      setPref(entry.vehiclePreference || "");
      setCadence((entry.rentalCadence as "Daily" | "Weekly") || "");
    }
  }, [entry]);

  const needsFront = entry ? !entry.hasLicenseFront : true;
  const needsBack = entry ? !entry.hasLicenseBack : true;
  const needsRideshare = entry ? !entry.hasRideshareProof : true;

  const canSubmit =
    !submitting &&
    ((!needsFront || !!licenseFrontUrl) &&
      (!needsBack || !!licenseBackUrl) &&
      (!needsRideshare || !!rideshareUrl));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await submit({
        data: {
          token,
          licenseFrontDataUrl: licenseFrontUrl ?? undefined,
          licenseBackDataUrl: licenseBackUrl ?? undefined,
          rideshareProofDataUrl: rideshareUrl ?? undefined,
          vehiclePreference: pref || undefined,
          rentalCadence: cadence || undefined,
        },
      });
      setDone(true);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto min-h-screen max-w-lg px-4 py-16 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
        Loading…
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="mx-auto min-h-screen max-w-lg px-4 py-12">
        <Card className="p-6 text-center">
          <h1 className="text-lg font-semibold">Link unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "This upload link is not valid."}
          </p>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto min-h-screen max-w-lg px-4 py-12">
        <Card className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-semibold">Thanks{entry.name ? `, ${entry.name.split(/\s+/)[0]}` : ""}! ✅</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            We got your info. You're all set — we'll text you as soon as a vehicle opens up.
          </p>
          <p className="mt-4 text-sm font-medium">— Camauto Rentals</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 py-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold">Upload your info</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {entry.name ? `Hi ${entry.name.split(/\s+/)[0]} — ` : ""}
          just a few quick uploads so we're ready when a vehicle opens up.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        {needsFront && (
          <DocSection step={1} title="Driver's license — front" done={!!licenseFrontUrl}>
            <PhotoCapture label="Upload license (front)" onChange={setLicenseFrontUrl} value={licenseFrontUrl} />
          </DocSection>
        )}
        {needsBack && (
          <DocSection step={2} title="Driver's license — back" done={!!licenseBackUrl}>
            <PhotoCapture label="Upload license (back)" onChange={setLicenseBackUrl} value={licenseBackUrl} />
          </DocSection>
        )}
        {needsRideshare && (
          <DocSection step={3} title="Rideshare proof (Uber/Lyft driver app screenshot)" done={!!rideshareUrl}>
            <PhotoCapture label="Upload rideshare screenshot" onChange={setRideshareUrl} value={rideshareUrl} />
          </DocSection>
        )}

        <Card className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label>Vehicle preference (optional)</Label>
            <Select value={pref || "No preference"} onValueChange={(v) => setPref(v === "No preference" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="No preference">No preference</SelectItem>
                <SelectItem value="Sedan">Sedan</SelectItem>
                <SelectItem value="SUV">SUV</SelectItem>
                <SelectItem value="Minivan">Minivan</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Rental cadence</Label>
            <RadioGroup value={cadence} onValueChange={(v) => setCadence(v as "Daily" | "Weekly")} className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="Daily" id="cadence-daily" /> Daily
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="Weekly" id="cadence-weekly" /> Weekly
              </label>
            </RadioGroup>
          </div>
        </Card>

        <Button
          type="submit"
          size="lg"
          className="w-full bg-[#2db84b] text-white hover:bg-[#27a341]"
          disabled={!canSubmit}
        >
          {submitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
          ) : (
            <>Submit <ArrowRight className="ml-2 h-4 w-4" /></>
          )}
        </Button>
      </form>
    </div>
  );
}

function DocSection({ step, title, done, children }: { step: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2db84b] text-xs font-bold text-white">{step}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
        {done && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" />}
      </div>
      <Card className="p-4">{children}</Card>
    </div>
  );
}

function PhotoCapture({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (dataUrl: string | null) => void;
  value: string | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "uploaded" | "error">(value ? "uploaded" : "idle");
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
          const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) onChange(reader.result as string);
          else {
            ctx.drawImage(img, 0, 0, w, h);
            onChange(canvas.toDataURL("image/jpeg", 0.85));
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
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      {value && status !== "uploading" && status !== "error" ? (
        <div className="space-y-2">
          <img src={value} alt={label} className="max-h-48 w-full rounded border bg-muted/30 object-contain" />
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Uploaded
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>Replace</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Button type="button" variant="outline" className="w-full" disabled={status === "uploading"} onClick={() => inputRef.current?.click()}>
            {status === "uploading" ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>) : status === "error" ? `Retry — ${label}` : label}
          </Button>
          {status === "error" && errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
        </div>
      )}
    </div>
  );
}