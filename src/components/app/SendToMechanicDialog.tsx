import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createMechanicJob } from "@/lib/mechanic-jobs.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

const TEMPLATES: Record<string, string[]> = {
  "Won't start": ["Check battery voltage", "Check alternator output", "Check starter motor", "Check fuel level", "Check ignition system"],
  Brakes: ["Inspect brake pads", "Inspect rotors", "Check brake fluid level", "Test brake lines for leaks", "Check parking brake"],
  AC: ["Check refrigerant level", "Inspect compressor", "Check cabin air filter", "Test blower motor", "Check for leaks"],
  Custom: [],
};

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
  const [items, setItems] = useState([newItem()]);
  const [sending, setSending] = useState(false);

  function applyTemplate(key: string) {
    const t = TEMPLATES[key] ?? [];
    if (t.length) setItems(t.map((l) => newItem(l)));
  }

  async function submit() {
    if (!name.trim()) { toast.error("Mechanic name required"); return; }
    if (!phone.trim()) { toast.error("Mechanic phone required"); return; }
    const checklist = items.filter((i) => i.label.trim()).map((i) => ({ id: i.id, label: i.label.trim() }));
    if (checklist.length === 0) { toast.error("Add at least one checklist item"); return; }
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
      setName(""); setPhone(""); setShop(""); setContext(""); setItems([newItem()]);
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
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs">Items to inspect</Label>
              <Select onValueChange={applyTemplate}>
                <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Template" /></SelectTrigger>
                <SelectContent>
                  {Object.keys(TEMPLATES).map((k) => <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={it.id} className="flex gap-2">
                  <Input className="h-8 flex-1 text-xs" placeholder={`Item ${i + 1}`}
                    value={it.label}
                    onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))} />
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8"
                    onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setItems((p) => [...p, newItem()])}>
              <Plus className="h-4 w-4" /> Add Item
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={sending} onClick={submit}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4" /> Send to Mechanic</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}