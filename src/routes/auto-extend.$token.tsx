import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getAutoExtensionOffer,
  submitAutoExtension,
  declineAutoExtension,
} from "@/lib/auto-extension.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/app/SignaturePad";
import { CheckCircle2, FileSignature, Loader2, CalendarPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import logoUrl from "@/assets/camauto-logo-full.jpeg";

export const Route = createFileRoute("/auto-extend/$token")({
  head: () => ({ meta: [{ title: "Extend Your Rental — Camauto Rentals" }] }),
  component: AutoExtendPage,
});

function fmtMoney(n: number) {
  return `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return s;
  }
}

type Offer = Awaited<ReturnType<typeof getAutoExtensionOffer>>;

function AutoExtendPage() {
  const { token } = Route.useParams();
  const fetchOffer = useServerFn(getAutoExtensionOffer);
  const submitFn = useServerFn(submitAutoExtension);
  const declineFn = useServerFn(declineAutoExtension);

  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [choice, setChoice] = useState<"daily" | "weekly" | null>(null);
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchOffer({ data: { token } });
        if (cancelled) return;
        setOffer(r);
        if (r && r.found) {
          if (r.driverFullName) setName(r.driverFullName);
          setChoice(r.offerType === "weekly" ? "weekly" : "daily");
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load extension");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, fetchOffer]);

  function priceFor(c: "daily" | "weekly", o: Extract<Offer, { found: true }>) {
    return c === "daily" ? o.dailyRate : o.weeklyRate;
  }

  async function onSubmit() {
    if (!offer || !offer.found) return;
    if (!choice) {
      toast.error("Please choose an extension option");
      return;
    }
    if (!accepted) {
      toast.error("Please confirm you agree to the extension");
      return;
    }
    if (!sig) {
      toast.error("Signature is required");
      return;
    }
    if (!name.trim()) {
      toast.error("Please enter your full name");
      return;
    }
    setSubmitting(true);
    try {
      const { paymentUrl } = await submitFn({
        data: {
          token,
          choice,
          signatureDataUrl: sig,
          signedBy: name.trim(),
        },
      });
      window.location.href = paymentUrl;
    } catch (e: any) {
      toast.error(e?.message || "Could not submit extension");
      setSubmitting(false);
    }
  }

  async function onDecline() {
    if (!offer || !offer.found) return;
    if (!window.confirm("Decline the extension? Your rental will not be extended and we'll arrange to pick up the vehicle.")) {
      return;
    }
    setDeclining(true);
    try {
      await declineFn({ data: { token } });
      setDeclined(true);
    } catch (e: any) {
      toast.error(e?.message || "Could not record your response");
    } finally {
      setDeclining(false);
    }
  }

  const total =
    offer && offer.found && choice ? priceFor(choice, offer) : 0;

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-center mb-6">
          <img src={logoUrl} alt="Camauto Rentals" className="h-12" />
        </div>

        {loading && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
            Loading your extension options…
          </Card>
        )}

        {!loading && (err || !offer || !offer.found) && (
          <Card className="p-8 text-center space-y-2">
            <div className="text-lg font-semibold">Extension link unavailable</div>
            <p className="text-sm text-muted-foreground">
              {err ||
                "This link is invalid or has expired. Please contact Camauto Rentals at 1-866-625-5550."}
            </p>
          </Card>
        )}

        {!loading && offer && offer.found && offer.status === "consumed" && (
          <Card className="p-8 text-center space-y-2">
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
            <div className="text-lg font-semibold">Extension already completed</div>
            <p className="text-sm text-muted-foreground">
              This extension link has already been used. If you need further help, contact us at
              1-866-625-5550.
            </p>
          </Card>
        )}

        {!loading && declined && (
          <Card className="p-8 text-center space-y-2">
            <XCircle className="mx-auto h-8 w-8 text-muted-foreground" />
            <div className="text-lg font-semibold">Extension declined</div>
            <p className="text-sm text-muted-foreground">
              Thanks for letting us know. We won't extend your rental. Our team will
              reach out to arrange returning the vehicle. Questions? Call 1-866-625-5550.
            </p>
          </Card>
        )}

        {!loading && !declined && offer && offer.found && offer.status !== "consumed" && (
          <Card className="p-6 space-y-6">
            <div>
              <h1 className="text-xl font-bold">Extend Your Rental</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Choose your extension, sign, and pay securely.
              </p>
            </div>

            <div className="rounded-md border bg-card p-4 text-sm space-y-1">
              <div className="font-medium">
                {offer.vehicle.year} {offer.vehicle.make} {offer.vehicle.model}
                {offer.vehicle.plate ? ` · ${offer.vehicle.plate}` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                Renter: {offer.driverFullName || "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                Current end date: {fmtDate(offer.currentEndDate)}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Choose your extension</Label>
              <button
                type="button"
                onClick={() => setChoice("daily")}
                disabled={!offer.dailyRate}
                className={`w-full flex items-center justify-between rounded-md border p-3 text-left text-sm transition ${
                  choice === "daily" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                } ${!offer.dailyRate ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span>
                  <span className="font-medium">Extend Daily</span>
                  <span className="text-muted-foreground"> — 1 day</span>
                </span>
                <span className="font-semibold">{fmtMoney(offer.dailyRate)}/day</span>
              </button>
              <button
                type="button"
                onClick={() => setChoice("weekly")}
                disabled={!offer.weeklyRate}
                className={`w-full flex items-center justify-between rounded-md border p-3 text-left text-sm transition ${
                  choice === "weekly" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                } ${!offer.weeklyRate ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span>
                  <span className="font-medium">Extend Weekly</span>
                  <span className="text-muted-foreground"> — 7 days</span>
                </span>
                <span className="font-semibold">{fmtMoney(offer.weeklyRate)}/week</span>
              </button>
            </div>

            <div className="rounded-md border bg-primary/5 p-4">
              <div className="text-xs uppercase text-muted-foreground">Total due today</div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-sm">
                  {choice === "daily"
                    ? "1 day extension"
                    : choice === "weekly"
                      ? "7 day extension"
                      : "Select an option"}
                </span>
                <span className="text-2xl font-bold">{fmtMoney(total)}</span>
              </div>
              {choice && (
                <div className="mt-1 text-xs text-muted-foreground">
                  New end date:{" "}
                  {fmtDate(
                    (() => {
                      const base = offer.currentEndDate
                        ? new Date(offer.currentEndDate + "T00:00:00")
                        : new Date();
                      base.setDate(base.getDate() + (choice === "daily" ? 1 : 7));
                      return base.toISOString().slice(0, 10);
                    })(),
                  )}
                </div>
              )}
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
                and authorize the charge above. All other terms of the original rental agreement remain
                in effect.
              </span>
            </label>

            <div>
              <Label className="mb-1 block">Signature</Label>
              <SignaturePad value={sig ?? undefined} onChange={setSig} />
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={onSubmit}
              disabled={submitting || !choice || !accepted || !sig || !name.trim()}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirecting to payment…
                </>
              ) : (
                <>
                  <FileSignature className="mr-2 h-4 w-4" /> Sign &amp; Pay {fmtMoney(total)}
                </>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              <CalendarPlus className="inline h-3 w-3 mr-1" />
              Payment is processed securely by Stripe. Your rental end date updates immediately after
              payment.
            </p>

            <div className="border-t pt-4 text-center">
              <p className="text-xs text-muted-foreground mb-2">
                Not extending this time?
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onDecline}
                disabled={declining || submitting}
              >
                {declining ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
                ) : (
                  <><XCircle className="mr-2 h-4 w-4" /> Decline extension</>
                )}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}