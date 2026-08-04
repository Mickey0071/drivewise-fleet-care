import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface LogRow {
  id: string;
  old_mileage: number | null;
  new_mileage: number;
  applied: boolean;
  source: string;
  actor: string | null;
  created_at: string;
}

export function VehicleMileageHistory({ vehicleId }: { vehicleId: string }) {
  const [rows, setRows] = useState<LogRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("vehicle_mileage_log")
        .select("id, old_mileage, new_mileage, applied, source, actor, created_at")
        .eq("vehicle_id", vehicleId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!cancelled) setRows((data ?? []) as LogRow[]);
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Mileage History</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No mileage updates recorded yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border pb-2 last:border-0 last:pb-0">
                <span>
                  <span className="font-medium">
                    {r.old_mileage != null ? `${r.old_mileage.toLocaleString()} → ` : ""}
                    {r.new_mileage.toLocaleString()} mi
                  </span>
                  {!r.applied && (
                    <span className="ml-2 text-amber-600">lower reading — vehicle mileage not changed</span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()} · {r.source}
                  {r.actor ? ` · ${r.actor}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
