import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, XCircle, ShieldAlert, Car, User, Calendar, AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { reviewInspection } from "@/lib/tasks.functions";

export const Route = createFileRoute("/admin/completed-inspections")({
  head: () => ({ meta: [{ title: "Completed Inspections — Camauto Rentals" }] }),
  component: CompletedInspectionsPage,
});

type Row = {
  id: string;
  vehicle_id: string;
  runner_id: string;
  completed_at: string | null;
  mileage: number | null;
  completion: any;
  notes: string | null;
  vehicleLabel: string;
  runnerName: string;
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function CompletedInspectionsPage() {
  const review = useServerFn(reviewInspection);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data: tasks } = await supabase
      .from("runner_tasks")
      .select("id, vehicle_id, runner_id, completed_at, mileage, completion, notes, details")
      .eq("type", "inspection")
      .eq("status", "completed")
      .order("completed_at", { ascending: false });
    const list = (tasks ?? []).filter((t: any) => t.details?.return_inspection === true);
    const vehIds = [...new Set(list.map((t: any) => t.vehicle_id))];
    const runnerIds = [...new Set(list.map((t: any) => t.runner_id))];
    const vMap: Record<string, string> = {};
    const rMap: Record<string, string> = {};
    if (vehIds.length) {
      const { data: vs } = await supabase.from("vehicles").select("id, year, make, model, plate").in("id", vehIds);
      for (const v of vs ?? []) vMap[(v as any).id] = `${(v as any).year} ${(v as any).make} ${(v as any).model} — ${(v as any).plate}`;
    }
    if (runnerIds.length) {
      const { data: ps } = await supabase.from("profiles").select("id, full_name, first_name").in("id", runnerIds);
      for (const p of ps ?? []) rMap[(p as any).id] = (p as any).full_name || (p as any).first_name || "Runner";
    }
    setRows(
      list.map((t: any) => ({
        ...t,
        vehicleLabel: vMap[t.vehicle_id] || t.vehicle_id,
        runnerName: rMap[t.runner_id] || "Runner",
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: "approve" | "reject" | "force_available", reopen?: boolean) => {
    setBusy(id);
    try {
      await review({ data: { taskId: id, action, reason: reasons[id]?.trim() || undefined, reopen, origin: window.location.origin } });
      toast.success(
        action === "approve" ? "Inspection approved — vehicle available." :
        action === "force_available" ? "Vehicle forced available." :
        reopen ? "Sent back to runner for re-inspection." : "Inspection rejected.",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Completed Inspections" subtitle="Returned vehicles awaiting inspection approval." />
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No inspections awaiting approval. 🎉</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const c = r.completion || {};
            const issues: string[] = Array.isArray(c.issues) ? c.issues : [];
            const checklist: Record<string, boolean> = c.checklist || {};
            return (
              <Card key={r.id}>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-base font-semibold"><Car className="h-4 w-4" /> {r.vehicleLabel}</span>
                    {issues.length > 0 ? (
                      <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> {issues.length} issue{issues.length > 1 ? "s" : ""}</Badge>
                    ) : (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">No issues</Badge>
                    )}
                  </div>
                  <div className="grid gap-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-2"><User className="h-3.5 w-3.5" /> Inspected by {r.runnerName}</span>
                    <span className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5" /> {fmt(r.completed_at)}</span>
                    <span>Mileage: {r.mileage?.toLocaleString() ?? "—"}</span>
                  </div>

                  {Object.keys(checklist).length > 0 && (
                    <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-3 text-xs">
                      {Object.entries(checklist).map(([k, v]) => (
                        <span key={k} className="flex items-center gap-1">
                          {v ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-destructive" />}
                          {k.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}

                  {issues.length > 0 && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                      <div className="font-medium text-destructive">Issues found</div>
                      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                        {issues.map((i, idx) => <li key={idx}>{i}</li>)}
                      </ul>
                    </div>
                  )}

                  {c.dashboard_code && <div className="text-sm">Dashboard code: <strong>{c.dashboard_code}</strong></div>}
                  {r.notes && <div className="text-sm text-muted-foreground">Notes: {r.notes}</div>}

                  <Textarea
                    placeholder="Rejection reason (optional)"
                    rows={2}
                    value={reasons[r.id] || ""}
                    onChange={(e) => setReasons((p) => ({ ...p, [r.id]: e.target.value }))}
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy === r.id} onClick={() => act(r.id, "approve")}>
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => act(r.id, "reject", true)}>
                      <XCircle className="mr-1 h-4 w-4" /> Reject & re-inspect
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => act(r.id, "reject", false)}>
                      Reject (fix manually)
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => act(r.id, "force_available")}>
                      <ShieldAlert className="mr-1 h-4 w-4" /> Force Available
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
