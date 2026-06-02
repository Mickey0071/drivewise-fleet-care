import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Car, Calendar, ClipboardList } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { taskTypeLabel } from "@/lib/task-types";

export const Route = createFileRoute("/runner/dashboard")({
  head: () => ({ meta: [{ title: "My Tasks — Camauto Rentals" }] }),
  component: RunnerDashboard,
});

type TaskRow = {
  id: string;
  type: string;
  vehicle_id: string;
  assigned_at: string;
  due_date: string | null;
  status: string;
  vehicleLabel: string;
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RunnerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [runnerName, setRunnerName] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name, first_name")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) setRunnerName(prof?.full_name || prof?.first_name || "");

      const { data: rows } = await supabase
        .from("runner_tasks")
        .select("id, type, vehicle_id, assigned_at, due_date, status")
        .eq("runner_id", user.id)
        .in("status", ["assigned", "in_progress"])
        .order("assigned_at", { ascending: true });

      const list = (rows ?? []) as any[];
      const vehIds = [...new Set(list.map((r) => r.vehicle_id))];
      const labels: Record<string, string> = {};
      if (vehIds.length) {
        const { data: vs } = await supabase
          .from("vehicles")
          .select("id, year, make, model, plate")
          .in("id", vehIds);
        for (const v of vs ?? []) {
          labels[(v as any).id] = `${(v as any).year} ${(v as any).make} ${(v as any).model} — ${(v as any).plate}`;
        }
      }
      if (!cancelled) {
        setTasks(list.map((r) => ({ ...r, vehicleLabel: labels[r.vehicle_id] || r.vehicle_id })));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome{runnerName ? `, ${runnerName}` : ""}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your assigned tasks</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No open tasks right now. 🎉</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {tasks.map((t) => (
            <Card key={t.id} className="overflow-hidden">
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-center justify-between">
                  <span className="text-base font-semibold">{taskTypeLabel(t.type)}</span>
                  <Badge variant="secondary" className="capitalize">{t.status.replace("_", " ")}</Badge>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Car className="h-4 w-4 shrink-0" /> {t.vehicleLabel}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4 shrink-0" /> Assigned {fmt(t.assigned_at)}
                  {t.due_date ? ` · Due ${fmt(t.due_date)}` : ""}
                </div>
                <Button
                  size="lg"
                  className="h-12 w-full text-base"
                  onClick={() => navigate({ to: "/runner/task/$taskId", params: { taskId: t.id } })}
                >
                  Start Task
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}