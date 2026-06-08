import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { sendVerificationLink } from "@/lib/cardholder-verification.functions";
import { toE164, isValidE164 } from "@/lib/phone";

export function SendVerificationLinkDialog({
  open,
  onOpenChange,
  rentalId,
  defaultPhone,
  defaultName,
  driverPhone,
  driverName,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rentalId: string;
  defaultPhone?: string | null;
  defaultName?: string | null;
  driverPhone?: string | null;
  driverName?: string | null;
  onSent?: () => void;
}) {
  const sendFn = useServerFn(sendVerificationLink);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const p = toE164(defaultPhone?.trim() || driverPhone?.trim() || "");
    const n = defaultName?.trim() || driverName?.trim() || "";
    setPhone(p);
    setName(n);
  }, [open, defaultPhone, driverPhone, defaultName, driverName]);

  const phoneSource = defaultPhone?.trim()
    ? "Cardholder phone on file"
    : driverPhone?.trim()
      ? "Auto-filled from rental"
      : null;
  const nameSource = defaultName?.trim()
    ? "Cardholder name on file"
    : driverName?.trim()
      ? "Auto-filled from rental"
      : null;

  const send = async () => {
    if (!phone.trim()) {
      toast.error("Enter a recipient phone number");
      return;
    }
    setBusy(true);
    try {
      await sendFn({
        data: {
          rentalId,
          phone: phone.trim(),
          name: name.trim() || undefined,
          message: message.trim() || undefined,
        },
      });
      toast.success(`✓ Verification link sent to ${phone.trim()}`);
      onSent?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send link");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send verification link</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="vl-phone">Recipient phone</Label>
            <Input
              id="vl-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(267) 555-1234"
            />
            {phoneSource && (
              <p className="text-xs text-muted-foreground">{phoneSource}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="vl-name">Recipient name</Label>
            <Input
              id="vl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cardholder name"
            />
            {nameSource && (
              <p className="text-xs text-muted-foreground">{nameSource}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="vl-msg">Custom message (optional)</Label>
            <Textarea
              id="vl-msg"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Leave blank to use the default message."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={send} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
