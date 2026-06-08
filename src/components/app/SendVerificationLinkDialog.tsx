import { useState } from "react";
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

export function SendVerificationLinkDialog({
  open,
  onOpenChange,
  rentalId,
  defaultPhone,
  defaultName,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rentalId: string;
  defaultPhone?: string | null;
  defaultName?: string | null;
  onSent?: () => void;
}) {
  const sendFn = useServerFn(sendVerificationLink);
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [name, setName] = useState(defaultName ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
          </div>
          <div className="space-y-1">
            <Label htmlFor="vl-name">Recipient name</Label>
            <Input
              id="vl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cardholder name"
            />
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
