import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, ShieldAlert, ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  id: string;
  vehicle_id: string;
  runner_id: string;
  reviewed_at: string | null;
  forced: boolean | null;
  vehicleLabel: string;
  runnerName: string;
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ApprovedInspections() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: tasks } = await supabase
      .from("runner_tasks")
      .select("id, vehicle_id, runner_id, reviewed_at, forced, status")
      .eq("type", "inspection")
      .in("status", ["approved", "forced"])
      .order("reviewed_at", { ascending: false })
      .limit(5);
    const list = tasks ?? [];
    const vehIds = [...new Set(list.map((t: any) => t.vehicle_id))];
    const runnerIds = [...new Set(list.map((t: any) => t.runner_id))];
    const vMap: Record<string, string> = {};
    const rMap: Record<string, string> = {};
    if (vehIds.length) {
      const { data: vs } = await supabase.from("vehicles").select("id, year, make, model, plate").in("id", vehIds);
      for (const v of vs ?? []) vMap[(v as any).id] = `${(v as any).year} ${(v as any).make} ${(v as any).model}`;
    }
    if (runnerIds.length) {
      const { data: ps } = await supabase.from("profiles").select("id, full_name, first_name").in("id", runnerIds);
      for (const p of ps ?? []) rMap[(p as any).id] = (p as any).full_name || (p as any).first_name || "Runner";
    }
    setRows(
      list.map((t: any) => ({
        id: t.id,
        vehicle_id: t.vehicle_id,
        runner_id: t.runner_id,
        reviewed_at: t.reviewed_at,
        forced: t.forced,
        vehicleLabel: vMap[t.vehicle_id] || t.vehicle_id,
        runnerName: rMap[t.runner_id] || "Runner",
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!loading && rows.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          Recently approved inspections
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/maintenance">View all inspections</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          rows.map((r) => (
            <Link
              key={r.id}
              to="/fleet/$vehicleId"
              params={{ vehicleId: r.vehicle_id }}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-primary/50"
            >
              <div className="flex items-center gap-2 text-sm">
                {r.forced ? (
                  <ShieldAlert className="h-4 w-4 text-amber-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                )}
                <span className="font-medium">{r.vehicleLabel}</span>
                <span className="text-muted-foreground">
                  {r.forced ? "forced available (no inspection)" : `inspection approved by ${r.runnerName}`} on {fmt(r.reviewed_at)}
                </span>
              </div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}