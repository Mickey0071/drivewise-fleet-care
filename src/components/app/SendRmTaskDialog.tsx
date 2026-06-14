import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { computeScheduledItems } from "@/lib/maintenance-utils";
import { createRmCardLink } from "@/lib/rm-cards.functions";
import type { Vehicle } from "@/lib/mock/data";

function formatPhone(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function SendRmTaskDialog({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle: Vehicle | null;
}) {
  const sendFn = useServerFn(createRmCardLink);
  const [runnerName, setRunnerName] = useState("");
  const [runnerPhone, setRunnerPhone] = useState("");
  const [sending, setSending] = useState(false);

  const scheduled = useMemo(
    () => (vehicle ? computeScheduledItems(vehicle as any) : []),
    [vehicle],
  );

  const vehicleLabel = vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model} · ${vehicle.plate}`
    : "";

  async function submit() {
    if (!vehicle) return;
    if (!runnerName.trim()) { toast.error("Runner name is required"); return; }
    if (runnerPhone.replace(/\D/g, "").length < 10) { toast.error("Enter a valid runner phone"); return; }
    if (scheduled.length === 0) { toast.error("This vehicle has no scheduled maintenance items"); return; }
    setSending(true);
    try {
      const rmItems = scheduled.map((s) => ({
        type: s.type,
        customId: s.customId ?? undefined,
        label: s.label,
        due: s.dueDate ?? (s.dueMileage != null ? `${s.dueMileage} mi` : undefined),
      }));
      await sendFn({
        data: {
          vehicleId: vehicle.id,
          items: rmItems,
          inspectorName: runnerName.trim(),
          inspectorPhone: runnerPhone.trim(),
          inspectorType: "runner",
          mileage: (vehicle as any).mileage ?? null,
          vehicleLabel,
        },
      });
      toast.success(`✓ RM Card link sent to ${runnerName.trim()}`);
      setRunnerName(""); setRunnerPhone("");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to send RM task");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send Routine Maintenance</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {vehicle && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{vehicleLabel}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {scheduled.length} maintenance item{scheduled.length === 1 ? "" : "s"} on the list
              </div>
              {scheduled.length > 0 && (
                <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">
                  {scheduled.map((s) => <li key={s.key}>{s.label}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Runner name *</Label>
              <Input className="mt-1" value={runnerName} onChange={(e) => setRunnerName(e.target.value)} placeholder="John Doe" />
            </div>
            <div>
              <Label>Runner phone *</Label>
              <Input className="mt-1" type="tel" inputMode="tel" value={runnerPhone}
                onChange={(e) => setRunnerPhone(formatPhone(e.target.value))} placeholder="(267) 555-1234" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The runner gets an SMS link. Their results wait for your approval before the vehicle's maintenance history updates.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1 h-4 w-4" /> Send Task</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}