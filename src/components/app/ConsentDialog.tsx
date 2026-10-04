import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { setCustomerConsent } from "@/lib/marketing.functions";
import { CONSENT_LABEL, LEAD_SOURCE_LABEL, type ConsentStatus, type LeadSource } from "@/lib/marketing-shared";

export function ConsentBadge({ status }: { status: ConsentStatus }) {
  const variant = status === "opted_in" ? "default" : status === "opted_out" ? "destructive" : "outline";
  return <Badge variant={variant} className="text-[10px]">{CONSENT_LABEL[status]}</Badge>;
}

export function LeadSourceBadge({ source }: { source: LeadSource }) {
  return <Badge variant="secondary" className="text-[10px]">{LEAD_SOURCE_LABEL[source] ?? source}</Badge>;
}

export interface ConsentTarget {
  id: string;
  name: string;
  consentStatus: ConsentStatus;
  consentNote?: string | null;
  doNotText?: boolean;
}

/** Admin toggle: mark a customer opted in (with an optional note), opted out, or do-not-text. */
export function ConsentDialog({ target, onClose, onSaved }: { target: ConsentTarget | null; onClose: () => void; onSaved?: () => void }) {
  const save = useServerFn(setCustomerConsent);
  const [optedIn, setOptedIn] = useState(false);
  const [doNotText, setDoNotText] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setOptedIn(target.consentStatus === "opted_in");
    setDoNotText(!!target.doNotText);
    setNote(target.consentNote ?? "");
  }, [target]);

  async function submit() {
    if (!target) return;
    setBusy(true);
    try {
      const status: ConsentStatus = optedIn ? "opted_in" : target.consentStatus === "opted_out" ? "opted_out" : "unknown";
      await save({ data: { customerId: target.id, status, note, doNotText } });
      toast.success("Consent updated");
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Text/email consent — {target?.name}</DialogTitle>
        </DialogHeader>
        {target?.consentStatus === "opted_out" && (
          <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            This customer replied STOP. Only turn opt-in back on if they asked you to.
          </p>
        )}
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Opted in to offers</span>
            <Switch checked={optedIn} onCheckedChange={setOptedIn} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Do not text this number</span>
            <Switch checked={doNotText} onCheckedChange={setDoNotText} />
          </label>
          <div className="space-y-1">
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Agreed by phone on 10/3" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
