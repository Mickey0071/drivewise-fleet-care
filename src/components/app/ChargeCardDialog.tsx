import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { chargeCardOnFile } from "@/lib/driver-card.functions";
import { notifyCardCharge } from "@/lib/refund-recovery.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { recordManualPayment } from "@/lib/mock/store";
import { toast } from "sonner";
import { CreditCard, Loader2, AlertTriangle } from "lucide-react";
import type { SavedCard } from "@/lib/card-display";

const REASONS = [
  { value: "Refund Recovery", label: "Refund Recovery" },
  { value: "Past Due", label: "Past Due" },
  { value: "Damage", label: "Damage" },
  { value: "Violation", label: "Violation" },
  { value: "Other", label: "Other" },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rentalId: string;
  driverId: string;
  renterName: string;
  defaultAmount: number;
  description: string;
  savedCard: SavedCard | null;
  /** Whether the renter signed an agreement containing card-on-file consent. */
  consentOnFile?: boolean;
  defaultReason?: string;
}

export function ChargeCardDialog({
  open, onOpenChange, rentalId, driverId, renterName, defaultAmount, description, savedCard,
  consentOnFile = true, defaultReason = "",
}: Props) {
  const chargeFn = useServerFn(chargeCardOnFile);
  const notifyFn = useServerFn(notifyCardCharge);
  const [amount, setAmount] = useState(defaultAmount ? defaultAmount.toFixed(2) : "");
  const [reason, setReason] = useState(defaultReason);
  const [note, setNote] = useState("");
  const [charging, setCharging] = useState(false);

  // Reset the amount whenever the dialog re-opens with a new balance.
  const [lastDefault, setLastDefault] = useState(defaultAmount);
  if (open && lastDefault !== defaultAmount) {
    setLastDefault(defaultAmount);
    setAmount(defaultAmount ? defaultAmount.toFixed(2) : "");
    setReason(defaultReason);
    setNote("");
  }

  const expired = !!savedCard?.expired;
  const noCard = !savedCard;

  async function handleCharge() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0.5) {
      toast.error("Enter a valid amount (min $0.50)");
      return;
    }
    if (!reason) {
      toast.error("Select a reason for the charge");
      return;
    }
    setCharging(true);
    try {
      const fullDesc = [description, reason, note.trim()].filter(Boolean).join(" — ");
      const res = await chargeFn({
        data: {
          driverId,
          amountCents: Math.round(amt * 100),
          description: fullDesc.slice(0, 200),
          environment: getStripeEnvironment(),
        },
      });
      if (!res.ok) {
        toast.error(res.error || "Could not charge card", {
          description: "Don't retry automatically — try Send Payment Link instead.",
          duration: 12000,
        });
        return;
      }
      const result = recordManualPayment(rentalId, amt, "card");
      try {
        await notifyFn({ data: { rentalId, amount: amt, reason, last4: res.last4 ?? savedCard?.last4 } });
      } catch {
        /* notification failure is non-fatal */
      }
      toast.success(`Charged $${amt.toFixed(2)} to •••• ${res.last4 ?? savedCard?.last4 ?? ""}`, {
        description: result.fullyPaid ? "Paid in full" : "Partial payment recorded",
      });
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not charge card", {
        description: e instanceof Error ? e.message : String(e),
        duration: 10000,
      });
    } finally {
      setCharging(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Charge Card on File
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!consentOnFile && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Card on file consent not found in rental agreement. Recommend sending a payment link instead.
            </div>
          )}
          {noCard ? (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              No card on file. Use Send Payment Link to collect payment.
            </div>
          ) : expired ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              {savedCard?.brand} ending in {savedCard?.last4} is expired. Use Send Payment Link instead.
            </div>
          ) : (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              💳 {savedCard?.brand} ending in {savedCard?.last4} · <span className="text-emerald-600">Active ✓</span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="charge-amount">Amount to charge</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="charge-amount"
                type="number"
                min="0.5"
                step="0.01"
                className="pl-6"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={noCard || expired}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason} disabled={noCard || expired}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="charge-note">Description (optional)</Label>
            <Textarea
              id="charge-note"
              rows={2}
              maxLength={200}
              placeholder="Add a note for the customer receipt"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={noCard || expired}
            />
          </div>
          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            Charges {renterName || "renter"}'s saved card immediately and records it to Payments + P&amp;L.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={charging}>Cancel</Button>
          <Button onClick={handleCharge} disabled={charging || noCard || expired}>
            {charging ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1 h-4 w-4" />}
            {charging ? "Charging…" : `Charge $${(Number(amount) || 0).toFixed(2)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}