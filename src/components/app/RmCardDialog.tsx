import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { vehicleById, fmtDate } from "@/lib/mock/data";
import { computeScheduledItems, scheduledRemainingLabel } from "@/lib/maintenance-utils";
import { refreshStoreFromCloud } from "@/lib/mock/store";
import { supabase } from "@/integrations/supabase/client";
import { submitRmCardAdmin, createRmCardLink } from "@/lib/rm-cards.functions";
import { RmCardForm, type RmFormItem } from "@/components/app/RmCardForm";

function dueText(it: ReturnType<typeof computeScheduledItems>[number]): string {
  const rem = scheduledRemainingLabel(it);
  if (it.dueDate) return `${rem} · due ${fmtDate(it.dueDate)}`;
  if (it.dueMileage) return `${rem} · at ${it.dueMileage.toLocaleString()} mi`;
  return rem;
}

export function RmCardDialog({
  vehicleId,
  open,
  onOpenChange,
  adminName,
  onSubmitted,
}: {
  vehicleId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  adminName?: string;
  onSubmitted?: () => void;
}) {
  const submitFn = useServerFn(submitRmCardAdmin);
  const linkFn = useServerFn(createRmCardLink);
  const v = vehicleId ? vehicleById(vehicleId) : undefined;

  const baseItems = useMemo<RmFormItem[]>(() => {
    if (!v) return [];
    return computeScheduledItems(v).map((it) => ({
      type: it.type,
      customId: it.customId,
      label: it.label,
      due: dueText(it),
      status: "" as const,
      notes: "",
    }));
  }, [v?.id, v?.mileage]);

  const [items, setItems] = useState<RmFormItem[]>([]);
  const [inspectorName, setInspectorName] = useState("");
  const [inspectorPhone, setInspectorPhone] = useState("");
  const [overallNotes, setOverallNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastRmText, setLastRmText] = useState("No prior RM inspection");

  // Send-to-runner subform
  const [sendOpen, setSendOpen] = useState(false);
  const [sName, setSName] = useState("");
  const [sPhone, setSPhone] = useState("");
  const [sType, setSType] = useState<"runner" | "mechanic">("runner");

  useEffect(() => {
    if (!open) return;
    setItems(baseItems);
    setInspectorName("");
    setInspectorPhone("");
    setOverallNotes("");
    setSendOpen(false);
    setSName("");
    setSPhone("");
    setSType("runner");
    setLastRmText("No prior RM inspection");
    if (vehicleId) {
      supabase
        .from("vehicles")
        .select("last_rm_date")
        .eq("id", vehicleId)
        .maybeSingle()
        .then(({ data }) => {
          const d = (data as any)?.last_rm_date as string | null;
          if (d) {
            const days = Math.round((Date.now() - new Date(d).getTime()) / 86400_000);
            setLastRmText(`Last RM ${fmtDate(d.slice(0, 10))} · ${days} day${days === 1 ? "" : "s"} ago`);
          }
        });
    }
  }, [open, vehicleId, baseItems]);

  if (!v || !vehicleId) return null;
  const vehicleLabel = `${v.year} ${v.make} ${v.model}`;

  function setStatus(idx: number, status: "Pass" | "Fail") {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, status } : it)));
  }
  function setNotes(idx: number, notes: string) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, notes } : it)));
  }

  async function handleSubmit() {
    if (items.length === 0) { toast.error("No items to inspect"); return; }
    if (items.some((i) => i.status !== "Pass" && i.status !== "Fail")) {
      toast.error("Mark Pass or Fail for every item");
      return;
    }
    setBusy(true);
    try {
      const r = await submitFn({
        data: {
          vehicleId: vehicleId!,
          items,
          inspectorName: inspectorName.trim() || adminName,
          inspectorPhone: inspectorPhone.trim() || undefined,
          mileage: v!.mileage,
          overallNotes: overallNotes.trim() || undefined,
          createdByAdmin: adminName,
        },
      });
      await refreshStoreFromCloud();
      toast.success(`✓ RM Card: ${r.vehicleLabel} — ${r.passed.length} passed, ${r.failed.length} failed`);
      onOpenChange(false);
      onSubmitted?.();
    } catch (e: any) {
      toast.error(e?.message || "Failed to submit");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendLink() {
    if (!sName.trim()) { toast.error("Name required"); return; }
    if (!sPhone.trim()) { toast.error("Phone required"); return; }
    setBusy(true);
    try {
      await linkFn({
        data: {
          vehicleId: vehicleId!,
          items,
          inspectorName: sName.trim(),
          inspectorPhone: sPhone.trim(),
          inspectorType: sType,
          mileage: v!.mileage,
          vehicleLabel,
          createdByAdmin: adminName,
        },
      });
      toast.success(`✓ Link sent to ${sName.trim()}`);
      onOpenChange(false);
      onSubmitted?.();
    } catch (e: any) {
      toast.error(e?.message || "Failed to send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" /> Routine Maintenance Card
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{vehicleLabel} — {v.plate}</p>
        </DialogHeader>

        <RmCardForm
          vehicleLabel={vehicleLabel}
          plate={v.plate}
          mileage={v.mileage}
          lastRmText={lastRmText}
          items={items}
          onStatus={setStatus}
          onNotes={setNotes}
          inspectorName={inspectorName}
          inspectorPhone={inspectorPhone}
          setInspectorName={setInspectorName}
          setInspectorPhone={setInspectorPhone}
          overallNotes={overallNotes}
          setOverallNotes={setOverallNotes}
        />

        {sendOpen && (
          <div className="space-y-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
            <div className="text-sm font-medium">Send to Runner / Mechanic</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Name</Label>
                <Input className="mt-1 h-8" value={sName} onChange={(e) => setSName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input className="mt-1 h-8" type="tel" value={sPhone} onChange={(e) => setSPhone(e.target.value)} placeholder="(267) 555-1234" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Send to</Label>
              <Select value={sType} onValueChange={(val) => setSType(val as "runner" | "mechanic")}>
                <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="runner">Runner</SelectItem>
                  <SelectItem value="mechanic">Mechanic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={busy} onClick={handleSendLink}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4" /> Send Link</>}
            </Button>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          {!sendOpen && (
            <Button variant="secondary" onClick={() => setSendOpen(true)} disabled={busy}>
              <Send className="h-4 w-4" /> Send to Runner/Mechanic
            </Button>
          )}
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit RM Card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
