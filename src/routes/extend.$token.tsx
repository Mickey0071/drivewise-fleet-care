import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getExtensionLinkPublic,
  signAndPayExtension,
} from "@/lib/extension-link.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/app/SignaturePad";
import { CheckCircle2, CalendarPlus, FileSignature, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import logoUrl from "@/assets/camauto-logo-full.jpeg";

const AGREEMENT_VERSION = "v1.0";

export const Route = createFileRoute("/extend/$token")({
  head: () => ({ meta: [{ title: "Sign Extension — Camauto Rentals" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    paid: typeof s.paid === "string" ? s.paid : undefined,
  }),
  component: ExtendPage,
});

function fmtMoney(n: number) {
  return `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return s; }
}

type Summary = Awaited<ReturnType<typeof getExtensionLinkPublic>>;

function ExtendPage() {
  const { token } = Route.useParams();
  const { paid } = Route.useSearch();
  const fetchSummary = useServerFn(getExtensionLinkPublic);
  const signFn = useServerFn(signAndPayExtension);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cardInName, setCardInName] = useState<null | "yes" | "no">(null);
  const [payerIdDataUrl, setPayerIdDataUrl] = useState<string | null>(null);
  const [payerPhone, setPayerPhone] = useState("");
  const [uploadingId, setUploadingId] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchSummary({ data: { token } });
        if (cancelled) return;
        setSummary(r);
        if (r && r.found && r.driverFullName) setName(r.driverFullName);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load extension");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, fetchSummary]);

  async function onSubmit() {
    if (!summary || !summary.found) return;
    if (!accepted) { toast.error("Please confirm you agree to the extension"); return; }
    if (!sig) { toast.error("Signature is required"); return; }
    if (!name.trim()) { toast.error("Please enter your full name"); return; }
    if (cardInName === null) { toast.error("Please answer the payment card question"); return; }
    if (cardInName === "no" && !payerIdDataUrl) {
      toast.error("Please upload the cardholder's driver's license");
      return;
    }
    setSubmitting(true);
    try {
      const { paymentUrl } = await signFn({
        data: {
          token,
          signatureDataUrl: sig,
          signedBy: name.trim(),
          thirdPartyPayer: cardInName === "no",
          payerIdDataUrl: cardInName === "no" ? payerIdDataUrl ?? undefined : undefined,
          payerPhone: cardInName === "no" ? payerPhone.trim() || undefined : undefined,
        },
      });
      window.location.href = paymentUrl;
    } catch (e: any) {
      toast.error(e?.message || "Could not submit extension");
      setSubmitting(false);
    }
  }

  async function onPickPayerId(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image"); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("File must be under 8MB"); return; }
    setUploadingId(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
      setPayerIdDataUrl(dataUrl);
    } catch (e: any) {
      toast.error(e?.message || "Could not load image");
    } finally {
      setUploadingId(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-center mb-6">
          <img src={logoUrl} alt="Camauto Rentals" className="h-12" />
        </div>

        {loading && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
            Loading extension details…
          </Card>
        )}

        {!loading && (err || !summary || !summary.found) && (
          <Card className="p-8 text-center space-y-2">
            <div className="text-lg font-semibold">Extension link unavailable</div>
            <p className="text-sm text-muted-foreground">
              {err || "This link is invalid or has expired. Please contact Camauto Rentals at 1-866-625-5550."}
            </p>
          </Card>
        )}

        {!loading && summary && summary.found && (
          <Card className="p-6 space-y-6">
            <div>
              <h1 className="text-xl font-bold">Rental Extension Agreement</h1>
              <p className="text-xs text-muted-foreground mt-1">Agreement {AGREEMENT_VERSION}</p>
            </div>

            {(summary.status === "paid" || summary.paidAt || paid === "1") ? (
              <div className="rounded-md border bg-green-50 dark:bg-green-950/30 p-4 text-sm">
                <div className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-300">
                  <CheckCircle2 className="h-5 w-5" />
                  Extension complete
                </div>
                <p className="mt-2 text-muted-foreground">
                  Your rental has been extended through {fmtDate(summary.newEndDate)}. A confirmation
                  has been sent to your phone. Thank you!
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-md border bg-card p-4 text-sm space-y-1">
                  <div className="font-medium">
                    {summary.vehicle.year} {summary.vehicle.make} {summary.vehicle.model}
                    {summary.vehicle.plate ? ` · ${summary.vehicle.plate}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">Renter: {summary.driverFullName || "—"}</div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">Current end date</div>
                    <div className="font-medium mt-1">{fmtDate(summary.previousEndDate)}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">New end date</div>
                    <div className="font-medium mt-1">{fmtDate(summary.newEndDate)}</div>
                  </div>
                </div>

                <div className="rounded-md border bg-primary/5 p-4">
                  <div className="text-xs uppercase text-muted-foreground">Amount due today</div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-sm">
                      {summary.periods} additional {summary.periodLabel}{summary.periods === 1 ? "" : "s"} × {fmtMoney(summary.rate)}
                    </span>
                    <span className="text-2xl font-bold">{fmtMoney(summary.additionalAmount)}</span>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground max-h-48 overflow-y-auto">
                  <div className="font-semibold text-foreground">EXTENSION ADDENDUM TO RENTAL AGREEMENT {AGREEMENT_VERSION}</div>
                  <p className="mt-2">
                    This addendum extends the rental of the{" "}
                    <span className="font-medium text-foreground">
                      {summary.vehicle.year} {summary.vehicle.make} {summary.vehicle.model}
                      {summary.vehicle.plate ? ` (Plate ${summary.vehicle.plate})` : ""}
                    </span>{" "}
                    by{" "}
                    <span className="font-medium text-foreground">
                      {summary.periods} {summary.periodLabel}{summary.periods === 1 ? "" : "s"}
                    </span>
                    {summary.previousEndDate ? <> from {fmtDate(summary.previousEndDate)}</> : null}{" "}
                    through <span className="font-medium text-foreground">{fmtDate(summary.newEndDate)}</span>.
                    Renter agrees to pay an additional{" "}
                    <span className="font-medium text-foreground">{fmtMoney(summary.additionalAmount)}</span>{" "}
                    at the contracted rate of {fmtMoney(summary.rate)}/{summary.periodLabel}.
                    All other terms of the original rental agreement remain in full force and effect.
                  </p>
                </div>

                <div>
                  <Label htmlFor="ext-name">Full legal name</Label>
                  <Input
                    id="ext-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name as on driver's license"
                  />
                </div>

                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  <span>
                    I, <span className="font-medium">{name || "the renter"}</span>, agree to the extension
                    and authorize the additional charge above.
                  </span>
                </label>

                <div>
                  <Label className="mb-1 block">Signature</Label>
                  <SignaturePad value={sig ?? undefined} onChange={setSig} />
                </div>

                <div className="rounded-md border p-4 space-y-3">
                  <Label className="text-sm font-semibold">
                    Is the payment card in your name?
                  </Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={cardInName === "yes" ? "default" : "outline"}
                      size="sm"
                      onClick={() => { setCardInName("yes"); setPayerIdDataUrl(null); }}
                    >Yes</Button>
                    <Button
                      type="button"
                      variant={cardInName === "no" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCardInName("no")}
                    >No</Button>
                  </div>
                  {cardInName === "no" && (
                    <div className="space-y-2 pt-2 border-t">
                      <Label htmlFor="payer-id" className="text-xs">
                        Upload cardholder's driver's license
                      </Label>
                      <Input
                        id="payer-id"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={uploadingId}
                        onChange={(e) => onPickPayerId(e.target.files?.[0] ?? null)}
                      />
                      {payerIdDataUrl && (
                        <div className="flex items-center gap-2 text-xs text-green-700">
                          <CheckCircle2 className="h-4 w-4" /> ID uploaded
                        </div>
                      )}
                      <Label htmlFor="payer-phone" className="text-xs">
                        Cardholder's phone (optional)
                      </Label>
                      <Input
                        id="payer-phone"
                        type="tel"
                        placeholder="(555) 555-5555"
                        value={payerPhone}
                        onChange={(e) => setPayerPhone(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <Button
                  className="w-full"
                  size="lg"
                  onClick={onSubmit}
                  disabled={
                    submitting || !accepted || !sig || !name.trim() || cardInName === null ||
                    (cardInName === "no" && !payerIdDataUrl)
                  }
                >
                  {submitting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirecting to payment…</>
                  ) : (
                    <><FileSignature className="mr-2 h-4 w-4" /> Sign &amp; Pay {fmtMoney(summary.additionalAmount)}</>
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  Payment is processed securely by Stripe. Your rental end date will be updated immediately
                  after payment is received.
                </p>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}