import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getViolationForCustomer,
  getAffidavitPdfUrl,
  signViolationAffidavit,
} from "@/lib/violation-resolution.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/app/SignaturePad";
import { Loader2, FileSignature, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import logoUrl from "@/assets/camauto-logo-full.jpeg";

export const Route = createFileRoute("/violation/$token_/affidavit")({
  head: () => ({ meta: [{ title: "Liability Transfer Affidavit — Camauto Rentals" }] }),
  component: AffidavitPage,
});

const ACKS = [
  "I have read and understand the affidavit",
  "I confirm I was driving the vehicle at the time of the violation",
  "I accept responsibility and agree to resolve with EZPass directly",
  "I authorize Camauto Rentals to transfer my information to the appropriate authority",
];

function AffidavitPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const loadFn = useServerFn(getViolationForCustomer);
  const pdfFn = useServerFn(getAffidavitPdfUrl);
  const signFn = useServerFn(signViolationAffidavit);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [driverName, setDriverName] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await loadFn({ data: { token } });
        if (cancelled) return;
        if (!v.found) {
          setErr("This link is invalid or has expired.");
          return;
        }
        if (v.resolved) {
          navigate({ to: "/violation/$token", params: { token } });
          return;
        }
        setDriverName(v.driverName);
        const { url } = await pdfFn({ data: { token } });
        if (!cancelled) setPdfUrl(url);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load affidavit");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, loadFn, pdfFn, navigate]);

  const allChecked = checks.every(Boolean);
  const canSubmit = allChecked && !!sig && name.trim().length > 1;

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await signFn({
        data: { token, signatureDataUrl: sig!, signedName: name.trim(), acknowledgements: checks },
      });
      navigate({ to: "/violation/$token", params: { token }, search: { signed: "1" } });
    } catch (e: any) {
      toast.error(e?.message || "Could not submit affidavit");
      setSubmitting(false);
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
            Loading affidavit…
          </Card>
        )}

        {!loading && err && (
          <Card className="p-8 text-center space-y-2">
            <div className="text-lg font-semibold">Affidavit unavailable</div>
            <p className="text-sm text-muted-foreground">{err}</p>
          </Card>
        )}

        {!loading && !err && (
          <Card className="p-6 space-y-6">
            <div>
              <button
                onClick={() => navigate({ to: "/violation/$token", params: { token } })}
                className="mb-2 inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="mr-1 h-3 w-3" /> Back
              </button>
              <h1 className="text-xl font-bold">Liability Transfer Affidavit</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Review and sign to transfer responsibility
              </p>
            </div>

            <div className="rounded-md border overflow-hidden bg-muted/30">
              {pdfUrl ? (
                <iframe
                  src={pdfUrl}
                  title="Affidavit"
                  className="h-[480px] w-full"
                />
              ) : (
                <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                  Preparing document…
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Acknowledgements</Label>
              {ACKS.map((label, i) => (
                <label key={i} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={checks[i]}
                    onChange={(e) =>
                      setChecks((prev) => prev.map((c, idx) => (idx === i ? e.target.checked : c)))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div>
              <Label htmlFor="aff-name">Type Full Name</Label>
              <Input
                id="aff-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={driverName ? `Must match: ${driverName}` : "Full legal name"}
              />
            </div>

            <div>
              <Label className="mb-1 block">Signature</Label>
              <SignaturePad value={sig ?? undefined} onChange={setSig} />
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={onSubmit}
              disabled={!canSubmit || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…
                </>
              ) : (
                <>
                  <FileSignature className="mr-2 h-4 w-4" /> Submit Signed Affidavit
                </>
              )}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
