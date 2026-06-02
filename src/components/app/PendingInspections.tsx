import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, XCircle, ShieldAlert, Car, User, Calendar, AlertTriangle, ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { reviewInspection } from "@/lib/tasks.functions";

type Row = {
  id: string;
  vehicle_id: string;
  runner_id: string;
  completed_at: string | null;
  mileage: number | null;
  completion: any;
  notes: string | null;
  photo_urls: string[] | null;
  vehicleLabel: string;
  runnerName: string;
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function PendingInspections() {
  const review = useServerFn(reviewInspection);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: tasks } = await supabase
      .from("runner_tasks")
      .select("id, vehicle_id, runner_id, completed_at, mileage, completion, notes, photo_urls, details")
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
      setDetails(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          Inspections Pending Approval ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No inspections awaiting approval.</div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => {
              const c = r.completion || {};
              const issues: string[] = Array.isArray(c.issues) ? c.issues : [];
              const checklist: Record<string, boolean> = c.checklist || {};
              const checkCount = Object.keys(checklist).length;
              const passCount = Object.values(checklist).filter(Boolean).length;
              return (
                <div key={r.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold"><Car className="h-4 w-4" /> {r.vehicleLabel}</span>
                    {issues.length > 0 ? (
                      <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Issues: Yes ({issues.length})</Badge>
                    ) : (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">Issues: No</Badge>
                    )}
                  </div>
                  <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span className="flex items-center gap-2"><User className="h-3.5 w-3.5" /> {r.runnerName}</span>
                    <span className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5" /> {fmt(r.completed_at)}</span>
                    <span>Mileage: {r.mileage?.toLocaleString() ?? "—"}</span>
                    <span>Checklist: {passCount}/{checkCount} passed</span>
                  </div>
                  <Textarea
                    placeholder="Rejection reason (optional)"
                    rows={2}
                    value={reasons[r.id] || ""}
                    onChange={(e) => setReasons((p) => ({ ...p, [r.id]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => setDetails(r)}>View Details</Button>
                    <Button size="sm" disabled={busy === r.id} onClick={() => act(r.id, "approve")}>
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => act(r.id, "reject", true)}>
                      <XCircle className="mr-1 h-4 w-4" /> Re-inspect
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => act(r.id, "reject", false)}>
                      Fix manually
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => act(r.id, "force_available")}>
                      <ShieldAlert className="mr-1 h-4 w-4" /> Force Available
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={!!details} onOpenChange={(o) => { if (!o) setDetails(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{details?.vehicleLabel}</DialogTitle>
          </DialogHeader>
          {details && (() => {
            const c = details.completion || {};
            const issues: string[] = Array.isArray(c.issues) ? c.issues : [];
            const checklist: Record<string, boolean> = c.checklist || {};
            const photos = details.photo_urls ?? [];
            return (
              <div className="space-y-3 text-sm">
                <div className="grid gap-1 text-muted-foreground">
                  <span className="flex items-center gap-2"><User className="h-3.5 w-3.5" /> Inspected by {details.runnerName}</span>
                  <span className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5" /> {fmt(details.completed_at)}</span>
                  <span>Mileage: {details.mileage?.toLocaleString() ?? "—"}</span>
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
                {c.dashboard_code && <div>Dashboard code: <strong>{c.dashboard_code}</strong></div>}
                {issues.length > 0 && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                    <div className="font-medium text-destructive">Issues found</div>
                    <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                      {issues.map((i, idx) => <li key={idx}>{i}</li>)}
                    </ul>
                  </div>
                )}
                {details.notes && <div className="text-muted-foreground">Notes: {details.notes}</div>}
                {photos.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {photos.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={`Inspection photo ${i + 1}`} className="rounded-md border border-border object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" disabled={busy === details.id} onClick={() => act(details.id, "approve")}>
                    <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy === details.id} onClick={() => act(details.id, "force_available")}>
                    <ShieldAlert className="mr-1 h-4 w-4" /> Force Available
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Card>
  );
}