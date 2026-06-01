import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { sendPaymentLink } from "@/lib/payment-link.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { toast } from "sonner";
import { Smartphone, Loader2 } from "lucide-react";

const REASONS = [
  { value: "additional", label: "Additional charge" },
  { value: "stripe_error", label: "Stripe error (re-attempt)" },
  { value: "customer_request", label: "Customer request" },
  { value: "other", label: "Other" },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rentalId: string;
  renterName: string;
  phone: string;
  email?: string | null;
  defaultAmount: number;
  description: string;
  onSent?: () => void;
}

export function SendPaymentLinkDialog({
  open,
  onOpenChange,
  rentalId,
  renterName,
  phone,
  email,
  defaultAmount,
  description,
  onSent,
}: Props) {
  const sendFn = useServerFn(sendPaymentLink);
  const [amount, setAmount] = useState(String(defaultAmount || ""));
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(defaultAmount ? defaultAmount.toFixed(2) : "");
      setReason("");
      setMessage("");
    }
  }, [open, defaultAmount]);

  async function handleSend() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0.5) {
      toast.error("Enter a valid amount (min $0.50)");
      return;
    }
    if (!phone) {
      toast.error("No phone on file for renter");
      return;
    }
    const reasonLabel = REASONS.find((r) => r.value === reason)?.label;
    const desc = reasonLabel ? `${description} — ${reasonLabel}` : description;
    setSending(true);
    try {
      await sendFn({
        data: {
          phone,
          name: renterName,
          email: email ?? null,
          amountCents: Math.round(amt * 100),
          description: desc.slice(0, 200),
          environment: getStripeEnvironment(),
          rentalId,
          customMessage: message.trim() || undefined,
        },
      });
      toast.success("Payment link sent", { description: `$${amt.toFixed(2)} · ${phone}` });
      onSent?.();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not send payment link", { description: msg, duration: 12000 });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" /> Send Payment Link
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Payment Amount</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="pay-amount"
                type="number"
                min="0.5"
                step="0.01"
                className="pl-6"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Auto-filled with remaining balance — edit for partial or additional payments.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Reason (optional)</Label>
            <Select value={reason} onValueChange={setReason}>
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
            <Label htmlFor="pay-msg">Message (optional)</Label>
            <Textarea
              id="pay-msg"
              rows={2}
              maxLength={300}
              placeholder="Please complete your payment:"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">The payment link is appended automatically to your message.</p>
          </div>
          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            Sends to {renterName || "renter"}
            {phone ? ` · ${phone}` : ""}
            {email ? ` · ${email}` : ""}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Smartphone className="mr-1 h-4 w-4" />}
            {sending ? "Sending…" : "Send Payment Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}