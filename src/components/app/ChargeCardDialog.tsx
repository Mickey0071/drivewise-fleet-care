import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import { chargeCardOnFile } from "@/lib/driver-card.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { recordManualPayment } from "@/lib/mock/store";
import { toast } from "sonner";
import { CreditCard, Loader2, AlertTriangle } from "lucide-react";
import type { SavedCard } from "@/lib/card-display";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rentalId: string;
  driverId: string;
  renterName: string;
  defaultAmount: number;
  description: string;
  savedCard: SavedCard | null;
}

export function ChargeCardDialog({
  open, onOpenChange, rentalId, driverId, renterName, defaultAmount, description, savedCard,
}: Props) {
  const chargeFn = useServerFn(chargeCardOnFile);
  const [amount, setAmount] = useState(defaultAmount ? defaultAmount.toFixed(2) : "");
  const [charging, setCharging] = useState(false);

  // Reset the amount whenever the dialog re-opens with a new balance.
  const [lastDefault, setLastDefault] = useState(defaultAmount);
  if (open && lastDefault !== defaultAmount) {
    setLastDefault(defaultAmount);
    setAmount(defaultAmount ? defaultAmount.toFixed(2) : "");
  }

  const expired = !!savedCard?.expired;
  const noCard = !savedCard;

  async function handleCharge() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0.5) {
      toast.error("Enter a valid amount (min $0.50)");
      return;
    }
    setCharging(true);
    try {
      const res = await chargeFn({
        data: {
          driverId,
          amountCents: Math.round(amt * 100),
          description: description.slice(0, 200),
          environment: getStripeEnvironment(),
        },
      });
      if (!res.ok) {
        toast.error(res.error || "Could not charge card", { duration: 10000 });
        return;
      }
      const result = recordManualPayment(rentalId, amt, "card");
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