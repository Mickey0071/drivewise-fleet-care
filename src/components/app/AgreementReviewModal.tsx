import { memo, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FileText, IdCard, Camera, Send, AlertTriangle, ExternalLink } from "lucide-react";
import type { Rental } from "@/lib/mock/data";
import { driverById, vehicleById, fmtDate } from "@/lib/mock/data";
import { ensureRentalSynced, refreshStoreFromCloud } from "@/lib/mock/store";
import { sendPaymentLink } from "@/lib/payment-link.functions";
import { requestAgreementResubmission } from "@/lib/agreement-review.functions";
import { getStripeEnvironment } from "@/lib/stripe";

type Props = {
  rental: Rental | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function AgreementReviewModalImpl({ rental, open, onOpenChange }: Props) {
  const sendPayLinkFn = useServerFn(sendPaymentLink);
  const requestResubmitFn = useServerFn(requestAgreementResubmission);

  const [resubmitReason, setResubmitReason] = useState("");
  const [showResubmit, setShowResubmit] = useState(false);
  const [busy, setBusy] = useState<null | "approve" | "resubmit">(null);

  useEffect(() => {
    setResubmitReason("");
    setShowResubmit(false);
    setBusy(null);
  }, [rental?.id]);

  const d = rental ? driverById(rental.driverId) : null;
  const v = rental ? vehicleById(rental.vehicleId) : null;

  async function handleApprove() {
    if (!rental || !d) return;
    if (!d.phone) { toast.error("No phone on file for renter"); return; }
    const amount = Number(rental.rate ?? rental.weeklyRate ?? 0);
    if (amount < 0.5) { toast.error("Set a rate on this rental before approving"); return; }
    const periodLbl = rental.billingPeriod === "daily" ? "day"
      : rental.billingPeriod === "monthly" ? "month" : "week";
    setBusy("approve");
    try {
      await ensureRentalSynced(rental.id);
      await sendPayLinkFn({ data: {
        phone: d.phone,
        name: d.fullName,
        email: d.email ?? null,
        amountCents: Math.round(amount * 100),
        description: `First ${periodLbl} — ${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim(),
        environment: getStripeEnvironment(),
        rentalId: rental.id,
      } });
      toast.success("Approved — payment link sent", { description: d.phone });
      await refreshStoreFromCloud();
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not send payment link", { description: e instanceof Error ? e.message : String(e), duration: 12000 });
    } finally { setBusy(null); }
  }

  async function handleResubmit() {
    if (!rental) return;
    const reason = resubmitReason.trim();
    if (!reason) { toast.error("Please describe what needs fixing"); return; }
    setBusy("resubmit");
    try {
      await requestResubmitFn({ data: { rentalId: rental.id, reason } });
      toast.success("Resubmission requested — renter notified");
      await refreshStoreFromCloud();
      setShowResubmit(false);
      setResubmitReason("");
    } catch (e) {
      toast.error("Could not send request", { description: e instanceof Error ? e.message : String(e), duration: 10000 });
    } finally { setBusy(null); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {rental && (
          <>
            <DialogHeader>
              <DialogTitle>
                Review Agreement — {d?.fullName ?? rental.driverId}
                {v ? ` · ${v.year} ${v.make} ${v.model}` : ""}
              </DialogTitle>
              <DialogDescription>
                {v?.plate ? `Plate ${v.plate}` : ""}
                {rental.clientSignedAt ? ` · signed ${fmtDate(rental.clientSignedAt)}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <DocViewer icon={<FileText className="h-4 w-4" />} label="Signed Rental Agreement" url={rental.agreementPdfUrl} kind="pdf" />
              <DocViewer icon={<IdCard className="h-4 w-4" />} label="Driver's License" url={rental.licenseImageUrl} kind="image" />
              <DocViewer icon={<Camera className="h-4 w-4" />} label="Selfie" url={rental.selfieImageUrl} kind="image" />
            </div>

            {showResubmit && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <Label htmlFor="resubmit-reason" className="text-xs font-semibold">Reason for resubmission</Label>
                <Textarea
                  id="resubmit-reason"
                  rows={3}
                  value={resubmitReason}
                  onChange={(e) => setResubmitReason(e.target.value)}
                  placeholder="e.g. License photo is blurry — please re-upload."
                  className="mt-1"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowResubmit(false)} disabled={busy === "resubmit"}>Cancel</Button>
                  <Button size="sm" variant="destructive" onClick={handleResubmit} disabled={busy === "resubmit" || !resubmitReason.trim()}>
                    {busy === "resubmit" ? "Sending…" : "Send to Renter"}
                  </Button>
                </div>
              </div>
            )}

            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setShowResubmit(s => !s)}
                disabled={busy !== null}
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                Reject
              </Button>
              <Button
                size="lg"
                className="bg-emerald-600 text-white hover:bg-emerald-600/90 text-base font-semibold px-6"
                onClick={handleApprove}
                disabled={busy !== null}
              >
                <Send className="mr-2 h-4 w-4" />
                {busy === "approve" ? "Sending…" : "APPROVE & SEND PAYMENT LINK"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DocViewer({ icon, label, url, kind }: { icon: React.ReactNode; label: string; url?: string | null; kind: "pdf" | "image" }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-muted-foreground">{icon}</span>
          {label}
        </div>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Open <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {!url ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">Not uploaded yet.</div>
      ) : kind === "pdf" ? (
        <iframe src={url} title={label} className="h-96 w-full rounded-md border bg-white" />
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img src={url} alt={label} className="max-h-96 w-full rounded-md border bg-muted/20 object-contain transition-transform hover:scale-[1.01]" />
        </a>
      )}
    </div>
  );
}

export const AgreementReviewModal = memo(AgreementReviewModalImpl, (prev, next) =>
  prev.open === next.open &&
  prev.rental?.id === next.rental?.id &&
  prev.onOpenChange === next.onOpenChange,
);