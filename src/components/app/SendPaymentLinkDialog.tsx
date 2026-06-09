import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useServerFn } from "@tanstack/react-start";
import { sendPaymentLink, getPaymentLinkLogs, type PaymentLinkLog } from "@/lib/payment-link.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { toast } from "sonner";
import { Smartphone, Loader2 } from "lucide-react";
import type { SavedCard } from "@/lib/card-display";
import { SendLinkPreview } from "@/components/app/SendLinkPreview";

const REASONS = [
  { value: "stripe_error", label: "Stripe error (re-attempt)" },
  { value: "additional", label: "Additional charge" },
  { value: "lost_link", label: "Customer lost link" },
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
  savedCard?: SavedCard | null;
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
  savedCard,
}: Props) {
  const sendFn = useServerFn(sendPaymentLink);
  const logsFn = useServerFn(getPaymentLinkLogs);
  const [amount, setAmount] = useState(String(defaultAmount || ""));
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [viaSms, setViaSms] = useState(true);
  const [viaEmail, setViaEmail] = useState(true);
  const [logs, setLogs] = useState<PaymentLinkLog[]>([]);

  async function loadLogs() {
    if (!rentalId) return;
    try {
      setLogs(await logsFn({ data: { rentalId } }));
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    if (open) {
      setAmount(defaultAmount ? defaultAmount.toFixed(2) : "");
      setReason("");
      setMessage("");
      setViaSms(true);
      setViaEmail(!!email);
      loadLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultAmount, rentalId]);

  async function handleSend() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0.5) {
      toast.error("Enter a valid amount (min $0.50)");
      return;
    }
    if (!viaSms && !viaEmail) {
      toast.error("Choose at least one delivery method");
      return;
    }
    if (viaSms && !phone) {
      toast.error("No phone on file for renter");
      return;
    }
    if (viaEmail && !email) {
      toast.error("No email on file for renter");
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
          reason: reasonLabel,
          sendSms: viaSms,
          sendEmail: viaEmail,
        },
      });
      toast.success(`Payment link sent to ${renterName || "renter"}`, {
        description: `$${amt.toFixed(2)}`,
      });
      onSent?.();
      await loadLogs();
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
          <div className="space-y-2">
            <Label>Send via</Label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={viaSms}
                  onCheckedChange={(c) => setViaSms(!!c)}
                  disabled={!phone}
                />
                SMS to customer phone{phone ? ` (${phone})` : " — none on file"}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={viaEmail}
                  onCheckedChange={(c) => setViaEmail(!!c)}
                  disabled={!email}
                />
                Email to customer{email ? ` (${email})` : " — none on file"}
              </label>
            </div>
          </div>
          {logs.length > 0 && (
            <div className="space-y-1.5">
              <Label>History</Label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                {logs.map((l) => {
                  const d = new Date(l.createdAt);
                  const date = `${d.getMonth() + 1}-${d.getDate()}-${String(d.getFullYear()).slice(2)}`;
                  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                  return (
                    <div key={l.id} className="text-xs text-muted-foreground">
                      Payment link sent {date} {time} for ${(l.amountCents / 100).toFixed(2)}
                      {l.reason ? ` (${l.reason})` : ""}
                      {l.channels.length ? ` · ${l.channels.join(", ")}` : ""}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            Sends to {renterName || "renter"}
            {phone ? ` · ${phone}` : ""}
            {email ? ` · ${email}` : ""}
          </div>
          {savedCard && !savedCard.expired ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-foreground">
              💳 Using saved card ending in {savedCard.last4}
            </div>
          ) : (
            <div className="rounded-md border border-border bg-muted/50 p-2 text-xs text-muted-foreground">
              {savedCard?.expired
                ? "⚠️ Saved card is expired — customer will enter card info at the link."
                : "No card on file. Customer will enter card info at the link."}
            </div>
          )}
        </div>
        <SendLinkPreview note="Payment is processed via a secure Stripe checkout link. The confirmation redirect uses your current site." />
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