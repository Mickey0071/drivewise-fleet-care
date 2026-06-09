import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createMechanicJob } from "@/lib/mechanic-jobs.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, X, Loader2, Send, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const COMMON_ITEMS = [
  "Check battery voltage",
  "Check alternator output",
  "Check starter motor",
  "Check fuel system",
  "Check ignition system",
  "Check brakes (front)",
  "Check brakes (rear)",
  "Check tires",
  "Check AC system",
  "Check heating system",
  "Check transmission",
  "Check oil level",
  "Check oil leak",
  "Check coolant",
  "Check belts/hoses",
  "Check suspension",
  "Check exhaust",
  "Check lights",
  "Check electrical",
  "Check engine codes",
] as const;

const BASIC_INSPECTION_ITEMS = [
  "Check battery voltage",
  "Check brakes (front)",
  "Check brakes (rear)",
  "Check tires",
  "Check oil level",
  "Check coolant",
  "Check lights",
  "Check engine codes",
] as const;

let counter = 0;
const newItem = (label = "") => ({ id: `i${Date.now()}_${counter++}`, label });

export function SendToMechanicDialog({
  open,
  onOpenChange,
  maintenanceId,
  vehicleId,
  vehicleLabel,
  plate,
  issue,
  adminName,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  maintenanceId: string;
  vehicleId?: string;
  vehicleLabel: string;
  plate?: string;
  issue: string;
  adminName?: string;
  onSent: () => void;
}) {
  const sendFn = useServerFn(createMechanicJob);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [shop, setShop] = useState("");
  const [context, setContext] = useState("");
  const [includeChecklist, setIncludeChecklist] = useState(false);
  const [selectedCommon, setSelectedCommon] = useState<string[]>([]);
  const [customItems, setCustomItems] = useState<{ id: string; label: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [checklistError, setChecklistError] = useState("");

  function toggleCommon(label: string) {
    setSelectedCommon((prev) => {
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label];
      if (next.length > 0 || customItems.some((i) => i.label.trim())) setChecklistError("");
      return next;
    });
  }

  function loadBasicInspection() {
    setIncludeChecklist(true);
    setSelectedCommon((prev) => Array.from(new Set([...prev, ...BASIC_INSPECTION_ITEMS])));
    setChecklistError("");
  }

  function reset() {
    setName(""); setPhone(""); setShop(""); setContext("");
    setIncludeChecklist(false); setSelectedCommon([]); setCustomItems([]); setChecklistError("");
  }

  useEffect(() => {
    const hasItems = selectedCommon.length > 0 || customItems.some((i) => i.label.trim());
    if (hasItems) setChecklistError("");
  }, [selectedCommon, customItems]);

  async function submit() {
    if (!name.trim()) { toast.error("Mechanic name required"); return; }
    if (!phone.trim()) { toast.error("Mechanic phone required"); return; }
    let checklist: { id: string; label: string }[] = [];
    if (includeChecklist) {
      checklist = [
        ...selectedCommon.map((l) => newItem(l)),
        ...customItems.filter((i) => i.label.trim()).map((i) => ({ id: i.id, label: i.label.trim() })),
      ];
      if (checklist.length === 0) { setChecklistError("Select or add at least one checklist item, or turn off the checklist"); return; }
    }
    setSending(true);
    try {
      await sendFn({
        data: {
          maintenanceId,
          vehicleId: vehicleId ?? null,
          mechanicName: name.trim(),
          mechanicPhone: phone.trim(),
          mechanicShop: shop.trim() || undefined,
          issueDescription: issue,
          additionalContext: context.trim() || undefined,
          checklistItems: checklist,
          vehicleLabel,
          plate,
          createdByAdmin: adminName,
        },
      });
      toast.success(`✓ Diagnosis request sent to ${name.trim()}`);
      reset();
      onOpenChange(false);
      onSent();
    } catch (e: any) {
      toast.error(e?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Diagnosis to Mechanic</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Mechanic name</Label>
              <Input className="mt-1 h-8" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Mechanic phone</Label>
              <Input className="mt-1 h-8" type="tel" placeholder="(267) 555-1234" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Shop (optional)</Label>
            <Input className="mt-1 h-8" value={shop} onChange={(e) => setShop(e.target.value)} />
          </div>
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
            <span className="font-medium">Issue:</span> {issue || "—"}
          </div>
          <div>
            <Label className="text-xs">Additional context</Label>
            <Textarea className="mt-1 min-h-[52px] text-xs" placeholder="What the customer reported, symptoms…"
              value={context} onChange={(e) => setContext(e.target.value)} />
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Include checklist for mechanic?</Label>
              <Switch checked={includeChecklist} onCheckedChange={(v) => { setIncludeChecklist(v); if (!v) setChecklistError(""); }} />
            </div>
            <Button type="button" size="sm" variant="outline" className="mt-2 w-full" onClick={loadBasicInspection}>
              <Plus className="h-4 w-4" /> Send basic inspection checklist
            </Button>
            {includeChecklist ? (
              <div className="mt-3 space-y-3">
                <div>
                  <Label className="text-[11px] uppercase text-muted-foreground">Common items</Label>
                  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {COMMON_ITEMS.map((label) => (
                      <label key={label} className="flex cursor-pointer items-center gap-2 text-xs">
                        <Checkbox
                          checked={selectedCommon.includes(label)}
                          onCheckedChange={() => toggleCommon(label)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-[11px] uppercase text-muted-foreground">Custom items</Label>
                  <div className="mt-2 space-y-2">
                    {customItems.map((it, i) => (
                      <div key={it.id} className="flex gap-2">
                        <Input className="h-8 flex-1 text-xs" placeholder={`Custom item ${i + 1}`}
                          value={it.label}
                          onChange={(e) => setCustomItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))} />
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8"
                          onClick={() => setCustomItems((prev) => prev.filter((x) => x.id !== it.id))}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setCustomItems((p) => [...p, newItem()])}>
                    <Plus className="h-4 w-4" /> Add Custom Item
                  </Button>
                </div>
              </div>
            ) : null}
            {checklistError ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5" />
                <span>{checklistError}</span>
              </div>
            ) : null}
          </div>
        </div>
        <SendLinkPreview route="/mechanic-job/[token]" />
        <DialogFooter>
          <Button disabled={sending} onClick={submit}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4" /> Send to Mechanic</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}