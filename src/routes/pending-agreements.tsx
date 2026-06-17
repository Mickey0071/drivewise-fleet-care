import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { rentals, vehicleById, driverById, fmtDate } from "@/lib/mock/data";
import { useStoreVersion, refreshStoreFromCloud, ensureRentalSynced } from "@/lib/mock/store";
import { sendPaymentLink } from "@/lib/payment-link.functions";
import { requestAgreementResubmission } from "@/lib/agreement-review.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { toast } from "sonner";
import { FileSignature, FileText, IdCard, Camera, CheckCircle2, Send, AlertTriangle, ExternalLink } from "lucide-react";
import type { Rental } from "@/lib/mock/data";

export const Route = createFileRoute("/pending-agreements")({
  head: () => ({ meta: [{ title: "Pending Agreements — Camauto Rentals" }] }),
  component: PendingAgreementsPage,
});

function PendingAgreementsPage() {
  useStoreVersion();
  const [selected, setSelected] = useState<Rental | null>(null);
  const [resubmitFor, setResubmitFor] = useState<Rental | null>(null);
  const pending = rentals
    .filter(r => r.staffReviewStatus === "pending")
    .sort((a, b) => (b.clientSignedAt ?? "").localeCompare(a.clientSignedAt ?? ""));

  return (
    <div>
      <PageHeader
        title="Pending Agreements"
        subtitle="Signed agreements awaiting staff review"
      />

      {pending.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 p-12 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <div className="text-lg font-semibold">All caught up</div>
          <div className="text-sm text-muted-foreground">
            No signed agreements are waiting for review right now.
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pending.map(r => {
            const d = driverById(r.driverId);
            const v = vehicleById(r.vehicleId);
            return (
              <Card
                key={r.id}
                onClick={() => setSelected(r)}
                className="cursor-pointer p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileSignature className="h-4 w-4 text-amber-500" />
                      <div className="truncate text-sm font-semibold">{d?.fullName ?? r.driverId}</div>
                    </div>
                    <div className="mt-1 truncate text-sm text-muted-foreground">
                      {v ? `${v.year} ${v.make} ${v.model}` : r.vehicleId}
                      {v?.plate ? ` · ${v.plate}` : ""}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Signed {r.clientSignedAt ? fmtDate(r.clientSignedAt) : "—"}
                    </div>
                  </div>
                  <Badge className="bg-amber-500 text-white hover:bg-amber-500">Awaiting Review</Badge>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ReviewSheet
        rental={selected}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
        onRequestResubmit={(r) => { setSelected(null); setResubmitFor(r); }}
      />
      <ResubmitDialog
        rental={resubmitFor}
        onOpenChange={(o) => { if (!o) setResubmitFor(null); }}
      />
    </div>
  );
}

function ReviewSheet({
  rental,
  onOpenChange,
  onRequestResubmit,
}: {
  rental: Rental | null;
  onOpenChange: (open: boolean) => void;
  onRequestResubmit: (r: Rental) => void;
}) {
  const sendPayLinkFn = useServerFn(sendPaymentLink);
  const [check, setCheck] = useState({ agreement: false, id: false, selfie: false });
  const [sending, setSending] = useState(false);

  const d = rental ? driverById(rental.driverId) : null;
  const v = rental ? vehicleById(rental.vehicleId) : null;
  const allChecked = check.agreement && check.id && check.selfie;

  // Reset checklist when switching rentals
  if (rental && !(check as any).__forId) {
    // no-op marker; state resets via key below
  }

  async function handleApprove() {
    if (!rental || !d) return;
    if (!d.phone) { toast.error("No phone on file for renter"); return; }
    const rate = Number(rental.rate ?? rental.weeklyRate ?? 0);
    if (rate < 0.5) { toast.error("Set a rate on this rental before approving"); return; }
    const periodLbl = rental.billingPeriod === "daily" ? "day"
      : rental.billingPeriod === "monthly" ? "month" : "week";
    // DAILY rentals collect the first 2 days upfront (1 day with the
    // family-&-friends override). Other cadences collect a single period.
    const prepaidDays = rental.billingPeriod === "daily"
      ? (rental.skipDailyMinimum ? 1 : 2)
      : 1;
    const amount = rate * prepaidDays;
    const desc = rental.billingPeriod === "daily"
      ? `First ${prepaidDays} day${prepaidDays === 1 ? "" : "s"} upfront`
      : `First ${periodLbl}`;
    setSending(true);
    try {
      await ensureRentalSynced(rental.id);
      await sendPayLinkFn({ data: {
        phone: d.phone,
        name: d.fullName,
        email: d.email ?? null,
        amountCents: Math.round(amount * 100),
        description: `${desc} — ${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim(),
        environment: getStripeEnvironment(),
        rentalId: rental.id,
      } });
      toast.success("Approved — payment link sent to renter", { description: d.phone });
      await refreshStoreFromCloud();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not send payment link", { description: msg, duration: 12000 });
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={!!rental} onOpenChange={onOpenChange} key={rental?.id ?? "none"}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {rental && (
          <>
            <SheetHeader>
              <SheetTitle>{d?.fullName ?? rental.driverId}</SheetTitle>
              <SheetDescription>
                {v ? `${v.year} ${v.make} ${v.model}` : rental.vehicleId}
                {v?.plate ? ` · ${v.plate}` : ""}
                {rental.clientSignedAt ? ` · signed ${fmtDate(rental.clientSignedAt)}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-5">
              <DocSection
                icon={<FileText className="h-4 w-4" />}
                label="Rental Agreement"
                url={rental.agreementPdfUrl}
                kind="pdf"
              />
              <DocSection
                icon={<IdCard className="h-4 w-4" />}
                label="Driver's License"
                url={rental.licenseImageUrl}
                kind="image"
              />
              <DocSection
                icon={<Camera className="h-4 w-4" />}
                label="Selfie"
                url={rental.selfieImageUrl}
                kind="image"
              />

              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="mb-3 text-sm font-semibold">Reviewer checklist</div>
                <div className="space-y-2">
                  <CheckRow
                    checked={check.agreement}
                    onChange={(v) => setCheck(s => ({ ...s, agreement: v }))}
                    label="Agreement looks good"
                  />
                  <CheckRow
                    checked={check.id}
                    onChange={(v) => setCheck(s => ({ ...s, id: v }))}
                    label="ID matches renter name"
                  />
                  <CheckRow
                    checked={check.selfie}
                    onChange={(v) => setCheck(s => ({ ...s, selfie: v }))}
                    label="Selfie looks legit"
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onRequestResubmit(rental)}
                >
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  Request Resubmission
                </Button>
                <Button
                  className="bg-emerald-600 text-white hover:bg-emerald-600/90"
                  disabled={!allChecked || sending}
                  onClick={handleApprove}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {sending ? "Sending…" : "Approve & Send Payment Link"}
                </Button>
              </div>
              {!allChecked && (
                <div className="text-right text-xs text-muted-foreground">
                  Complete the checklist to approve.
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function DocSection({
  icon, label, url, kind,
}: { icon: React.ReactNode; label: string; url?: string | null; kind: "pdf" | "image" }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-muted-foreground">{icon}</span>
          {label}
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Open <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {!url ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
          Not uploaded yet.
        </div>
      ) : kind === "pdf" ? (
        <iframe
          src={url}
          title={label}
          className="h-80 w-full rounded-md border bg-white"
        />
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt={label}
            className="max-h-80 w-full rounded-md border bg-muted/20 object-contain transition-transform hover:scale-[1.01]"
          />
        </a>
      )}
    </div>
  );
}

function ResubmitDialog({
  rental,
  onOpenChange,
}: { rental: Rental | null; onOpenChange: (open: boolean) => void }) {
  const requestFn = useServerFn(requestAgreementResubmission);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit() {
    if (!rental) return;
    const trimmed = reason.trim();
    if (!trimmed) { toast.error("Please describe what needs fixing"); return; }
    setSending(true);
    try {
      await requestFn({ data: { rentalId: rental.id, reason: trimmed } });
      toast.success("Resubmission requested — renter notified");
      await refreshStoreFromCloud();
      setReason("");
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not send resubmission request", { description: msg, duration: 10000 });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={!!rental} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request resubmission</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            We&apos;ll text and email the renter with your reason and clear their
            previous signature, ID, and selfie so they can redo the signing flow.
          </p>
          <div>
            <Label htmlFor="resubmit-reason">What needs fixing?</Label>
            <Textarea
              id="resubmit-reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. The driver's license photo is blurry — please re-upload a clearer picture."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={sending || !reason.trim()}>
            {sending ? "Sending…" : "Send Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}