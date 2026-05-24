import { memo, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { FileText, IdCard, Camera, Send, AlertTriangle, ExternalLink, PauseCircle } from "lucide-react";
import type { Rental } from "@/lib/mock/data";
import { driverById, vehicleById, fmtDate } from "@/lib/mock/data";
import { ensureRentalSynced, refreshStoreFromCloud } from "@/lib/mock/store";
import { sendPaymentLink } from "@/lib/payment-link.functions";
import { requestAgreementResubmission, holdAgreementForReview } from "@/lib/agreement-review.functions";
import { getStripeEnvironment } from "@/lib/stripe";

type Props = {
  rental: Rental | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function AgreementReviewModalImpl({ rental, open, onOpenChange }: Props) {
  const sendPayLinkFn = useServerFn(sendPaymentLink);
  const requestResubmitFn = useServerFn(requestAgreementResubmission);
  const holdFn = useServerFn(holdAgreementForReview);

  const [tab, setTab] = useState<"docs" | "checklist">("docs");
  const [check, setCheck] = useState({ signed: false, legible: false, idMatch: false, selfie: false });
  const [notes, setNotes] = useState("");
  const [resubmitReason, setResubmitReason] = useState("");
  const [showResubmit, setShowResubmit] = useState(false);
  const [busy, setBusy] = useState<null | "approve" | "resubmit" | "hold">(null);

  // Reset state when rental changes
  useEffect(() => {
    setTab("docs");
    setCheck({ signed: false, legible: false, idMatch: false, selfie: false });
    setNotes("");
    setResubmitReason("");
    setShowResubmit(false);
    setBusy(null);
  }, [rental?.id]);

  const d = rental ? driverById(rental.driverId) : null;
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const allChecked = check.signed && check.legible && check.idMatch && check.selfie;

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

  async function handleHold() {
    if (!rental) return;
    setBusy("hold");
    try {
      await holdFn({ data: { rentalId: rental.id, note: notes.trim() || undefined } });
      toast.success("Flagged for manual review");
      await refreshStoreFromCloud();
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not flag", { description: e instanceof Error ? e.message : String(e), duration: 10000 });
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

            <Tabs value={tab} onValueChange={(v) => setTab(v as "docs" | "checklist")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="docs">Documents</TabsTrigger>
                <TabsTrigger value="checklist">
                  Review Checklist {allChecked ? "✓" : ""}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="docs" className="space-y-4 pt-2">
                <DocViewer icon={<FileText className="h-4 w-4" />} label="Signed Rental Agreement" url={rental.agreementPdfUrl} kind="pdf" />
                <DocViewer icon={<IdCard className="h-4 w-4" />} label="Driver's License" url={rental.licenseImageUrl} kind="image" />
                <DocViewer icon={<Camera className="h-4 w-4" />} label="Selfie" url={rental.selfieImageUrl} kind="image" />
              </TabsContent>

              <TabsContent value="checklist" className="space-y-3 pt-3">
                <CheckRow checked={check.signed} onChange={(v) => setCheck(s => ({ ...s, signed: v }))} label="Agreement is fully signed" />
                <CheckRow checked={check.legible} onChange={(v) => setCheck(s => ({ ...s, legible: v }))} label="Signature is legible" />
                <CheckRow checked={check.idMatch} onChange={(v) => setCheck(s => ({ ...s, idMatch: v }))} label="ID matches renter name" />
                <CheckRow checked={check.selfie} onChange={(v) => setCheck(s => ({ ...s, selfie: v }))} label="Selfie looks valid" />
                <div className="pt-2">
                  <Label htmlFor="review-notes" className="text-xs">Notes (optional)</Label>
                  <Textarea id="review-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to flag?" />
                </div>
              </TabsContent>
            </Tabs>

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
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowResubmit(s => !s)}
                  disabled={busy !== null}
                >
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  Request Resubmission
                </Button>
                <Button
                  variant="outline"
                  className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400"
                  onClick={handleHold}
                  disabled={busy !== null}
                >
                  <PauseCircle className="mr-2 h-4 w-4" />
                  {busy === "hold" ? "Holding…" : "Hold for Manual Review"}
                </Button>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Button
                  className="bg-emerald-600 text-white hover:bg-emerald-600/90"
                  onClick={handleApprove}
                  disabled={!allChecked || busy !== null}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {busy === "approve" ? "Sending…" : "Approve & Send Payment Link"}
                </Button>
                {!allChecked && (
                  <span className="text-[11px] text-muted-foreground">Complete the checklist to approve.</span>
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md border bg-muted/20 px-3 py-2 hover:bg-muted/40">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      <span className="text-sm">{label}</span>
    </label>
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