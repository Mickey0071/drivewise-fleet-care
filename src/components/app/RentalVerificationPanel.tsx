import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import {
  resolveCardholderReview,
  getVerificationAudit,
} from "@/lib/cardholder-verification.functions";
import { SendVerificationLinkDialog } from "@/components/app/SendVerificationLinkDialog";
import { ensureRentalSynced } from "@/lib/mock/store";
import type { Rental } from "@/lib/mock/data";

type AuditEvent = { type: string; at?: string; by?: string | null; note?: string | null };

const EVENT_LABELS: Record<string, string> = {
  mismatch_detected: "Name mismatch detected",
  initial_sms_sent: "Initial SMS sent to customer",
  admin_alert_sent: "Admin SMS alert sent",
  link_sent: "Verification link sent",
  submitted: "Verification submitted",
  admin_reviewed: "Admin marked reviewed",
  refunded: "Payment refunded",
  refused: "Cardholder refused verification",
};

export function RentalVerificationPanel({
  rental,
  isAdmin,
}: {
  rental: Rental;
  isAdmin: boolean;
}) {
  const resolveFn = useServerFn(resolveCardholderReview);
  const auditFn = useServerFn(getVerificationAudit);
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [license, setLicense] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);

  const status = rental.verificationStatus ?? "pending";

  const loadAudit = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await auditFn({ data: { rentalId: rental.id } });
      setAudit((res?.events ?? []) as AuditEvent[]);
    } catch {
      setAudit([]);
    }
  }, [auditFn, rental.id, isAdmin]);

  useEffect(() => {
    if (showAudit && audit === null) loadAudit();
  }, [showAudit, audit, loadAudit]);

  const act = async (action: "reviewed" | "refund") => {
    setBusy(true);
    try {
      await resolveFn({ data: { rentalId: rental.id, action } });
      toast.success(action === "reviewed" ? "Marked reviewed" : "Payment refunded");
      await ensureRentalSynced(rental.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const tone =
    status === "refused"
      ? "border-destructive/50 bg-destructive/5"
      : status === "verified"
        ? "border-emerald-500/40 bg-emerald-500/5"
        : status === "submitted"
          ? "border-sky-500/40 bg-sky-500/5"
          : "border-amber-500/40 bg-amber-500/5";

  return (
    <div className={`mt-3 rounded-md border p-3 ${tone}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
        {status === "refused" ? (
          <span className="text-destructive">🔴 HIGH RISK: Cardholder refused verification</span>
        ) : status === "verified" ? (
          <span className="text-emerald-700">✓ Card Verified by Admin</span>
        ) : status === "submitted" ? (
          <span className="text-sky-700">
            ✓ Card Verification Submitted — License uploaded by {rental.cardholderName ?? "cardholder"}
          </span>
        ) : (
          <span className="text-amber-700">
            ⚠️ Card Verification Pending — Cardholder ({rental.cardholderName ?? "—"}) doesn't match
            renter
          </span>
        )}
        <Badge variant="outline" className="capitalize">
          {status}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Cardholder</span>
        <span className="text-right font-medium">{rental.cardholderName ?? "—"}</span>
        <span className="text-muted-foreground">Relationship</span>
        <span className="text-right font-medium">{rental.cardholderRelationship ?? "—"}</span>
        <span className="text-muted-foreground">Phone</span>
        <span className="text-right font-medium">{rental.cardholderPhone ?? "—"}</span>
        <span className="text-muted-foreground">Verified</span>
        <span className="text-right font-medium">
          {rental.cardholderVerifiedAt
            ? new Date(rental.cardholderVerifiedAt).toLocaleString()
            : "—"}
        </span>
      </div>

      {rental.cardholderLicenseUrl && status !== "verified" && (
        <button onClick={() => setLicense(rental.cardholderLicenseUrl!)} className="mt-2">
          <img
            src={rental.cardholderLicenseUrl}
            alt="Cardholder license"
            className="h-20 w-auto rounded border border-border object-cover"
          />
        </button>
      )}

      {status !== "verified" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {isAdmin && (status === "pending" || status === "refused") && (
            <Button size="sm" onClick={() => setLinkOpen(true)} disabled={busy}>
              {status === "refused" ? "Resend Verification Link" : "Send Verification Link"}
            </Button>
          )}
          {rental.cardholderLicenseUrl && (
            <Button size="sm" variant="outline" onClick={() => setLicense(rental.cardholderLicenseUrl!)}>
              View Submission
            </Button>
          )}
          {isAdmin && status === "refused" && (
            <Button size="sm" variant="destructive" onClick={() => act("refund")} disabled={busy}>
              Process Refund
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="secondary" onClick={() => act("reviewed")} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark Reviewed"}
            </Button>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="mt-3">
          <button
            onClick={() => setShowAudit((s) => !s)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showAudit ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Audit trail
          </button>
          {showAudit && (
            <div className="mt-2 space-y-1 border-l border-border pl-3 text-xs">
              {audit === null && <p className="text-muted-foreground">Loading…</p>}
              {audit && audit.length === 0 && (
                <p className="text-muted-foreground">No actions recorded yet.</p>
              )}
              {audit?.map((e, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span>
                    {EVENT_LABELS[e.type] ?? e.type}
                    {e.note ? ` (${e.note})` : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {e.at ? new Date(e.at).toLocaleString() : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <SendVerificationLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        rentalId={rental.id}
        defaultPhone={rental.cardholderPhone}
        defaultName={rental.cardholderName}
        onSent={() => {
          setAudit(null);
          ensureRentalSynced(rental.id);
        }}
      />

      <Dialog open={!!license} onOpenChange={(o) => !o && setLicense(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cardholder license</DialogTitle>
          </DialogHeader>
          {license && <img src={license} alt="Cardholder license" className="w-full rounded-md" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
