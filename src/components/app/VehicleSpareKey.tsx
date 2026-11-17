import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { updateVehicle } from "@/lib/mock/store";
import type { Vehicle } from "@/lib/mock/data";
import { toast } from "sonner";

export function VehicleSpareKey({ vehicle }: { vehicle: Vehicle }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `spare-key-${vehicle.id}`;

  async function save(made: boolean) {
    const previous = !!vehicle.spareKeyMade;
    setSaving(true);
    setError(null);
    try {
      await updateVehicle(vehicle.id, { spareKeyMade: made });
      const { data, error: readError } = await supabase.from("vehicles")
        .select("spare_key_made").eq("id", vehicle.id).single();
      if (readError) throw readError;
      if (data.spare_key_made !== made) {
        await updateVehicle(vehicle.id, { spareKeyMade: previous });
        throw new Error("Spare key status was not saved. Try again.");
      }
      toast.success(made ? "Spare key marked as made" : "Spare key marked as not made");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save spare key status.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
        <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Checkbox id={id} checked={!!vehicle.spareKeyMade} disabled={saving}
          onCheckedChange={(checked) => void save(checked === true)} />
        <Label htmlFor={id} className="cursor-pointer text-sm">Spare key made</Label>
        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {saving ? "Saving…" : vehicle.spareKeyMade ? "Made" : "Not made"}
        </span>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}