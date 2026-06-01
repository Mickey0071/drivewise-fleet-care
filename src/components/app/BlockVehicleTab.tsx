import { useMemo, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type Vehicle } from "@/lib/mock/data";
import { setVehicleAvailabilityOverride, useStoreVersion } from "@/lib/mock/store";
import { fmtBlockRange, getVehicleBlocks } from "@/lib/vehicle-blocks";
import { toast } from "sonner";

export function BlockVehicleTab({ vehicle }: { vehicle: Vehicle }) {
  useStoreVersion();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const blocks = useMemo(() => getVehicleBlocks(vehicle.id), [vehicle.id, vehicle.status, vehicle.hasOpenIssues]);
  const unavailable = blocks.length > 0 || vehicle.status !== "available" || !!vehicle.hasOpenIssues;

  async function apply(available: boolean) {
    setSaving(true);
    try {
      await setVehicleAvailabilityOverride(vehicle.id, available, reason);
      toast.success(available ? "Vehicle turned available" : "Vehicle blocked as unavailable");
      setReason("");
    } catch (e) {
      toast.error("Could not update vehicle", { description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className={unavailable ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {unavailable ? <Ban className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-primary" />}
            Vehicle availability override
            <Badge variant={unavailable ? "destructive" : "outline"}>{unavailable ? "Unavailable" : "Available"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 text-sm">
            {blocks.length === 0 ? (
              <div className="rounded-md border bg-card px-3 py-2 text-muted-foreground">No active rental, repair, or manual block.</div>
            ) : blocks.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="font-medium">{b.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">{fmtBlockRange(b)}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label>Override note</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Reason for blocking or lifting the block"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" disabled={saving || unavailable} onClick={() => apply(false)}>
              Block vehicle / Turn unavailable
            </Button>
            <Button disabled={saving || !unavailable} onClick={() => apply(true)}>
              Lift block / Turn available
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}