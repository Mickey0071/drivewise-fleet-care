import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InspectionDetailDialog } from "@/components/app/InspectionDetailDialog";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { JOB_TYPE_LABELS } from "@/lib/checklist-items";

export const Route = createFileRoute("/inspections")({
  head: () => ({ meta: [{ title: "Inspections — Camauto Rentals" }] }),
  component: InspectionsPage,
});

type Row = {
  id: string;
  vehicle_id: string;
  date: string;
  submitted_at: string | null;
  mileage: number;
  inspector_name: string | null;
  completed_by: string;
  job_type: string | null;
  ready_to_rent: boolean | null;
  damage_noted: boolean;
  notes: string | null;
  checklist_items: Record<string, string> | null;
  vehicle_label: string | null;
  task_type: string | null;
  task_completed_at: string | null;
  runner_notes: string | null;
};

function InspectionsPage() {
  const { role, user } = useAuth();
  const isAdmin = role === "admin";
  const [openId, setOpenId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data: ins, error: iErr } = await supabase
          .from("inspections")
          .select("id, vehicle_id, date, submitted_at, mileage, inspector_name, completed_by, job_type, ready_to_rent, damage_noted, notes, checklist_items")
          .order("submitted_at", { ascending: false });
        if (iErr) throw iErr;

        const vIds = Array.from(new Set((ins ?? []).map((r) => r.vehicle_id).filter(Boolean)));
        const vMap = new Map<string, string>();
        if (vIds.length) {
          const { data: vs } = await supabase
            .from("vehicles").select("id, year, make, model, plate").in("id", vIds);
          for (const v of vs ?? []) {
            vMap.set(v.id, `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}${v.plate ? ` · ${v.plate}` : ""}`.trim());
          }
        }

        if (cancelled) return;
        setRows((ins ?? []).map((r) => ({
          ...r,
          checklist_items: (r.checklist_items as Record<string, string> | null) ?? null,
          vehicle_label: vMap.get(r.vehicle_id) ?? r.vehicle_id,
          task_type: null,
          task_completed_at: null,
          runner_notes: null,
        } as Row)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load inspections");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, user?.id]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) =>
      (b.task_completed_at ?? b.submitted_at ?? b.date).localeCompare(
        a.task_completed_at ?? a.submitted_at ?? a.date,
      ),
    ),
    [rows],
  );

  return (
    <div>
      <PageHeader
        title={isAdmin ? "Inspections" : "My Inspections"}
        subtitle={isAdmin ? "All submitted vehicle inspections" : "Inspections you have submitted"}
      />
      <Card>
        <CardContent className="space-y-2 py-4">
          {loading && <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>}
          {error && <div className="py-10 text-center text-sm text-destructive">{error}</div>}
          {!loading && !error && sortedRows.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No inspections yet.</div>
          )}
          {sortedRows.map((i) => {
            const fails = i.checklist_items ? Object.values(i.checklist_items).filter((x) => x === "fail").length : 0;
            const when = i.task_completed_at ?? i.submitted_at ?? i.date;
            const jobLabel = i.task_type
              ? (JOB_TYPE_LABELS[i.task_type] ?? i.task_type.replace(/_/g, " "))
              : (i.job_type ? (JOB_TYPE_LABELS[i.job_type] ?? i.job_type.replace(/_/g, " ")) : null);
            return (
              <div key={i.id} className="flex items-center justify-between rounded-md border border-border bg-card p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span>{i.vehicle_label ?? i.vehicle_id}</span>
                    {jobLabel && <Badge variant="outline">{jobLabel}</Badge>}
                    {i.ready_to_rent === false && <Badge variant="destructive">Needs mechanic</Badge>}
                    {i.ready_to_rent === true && <Badge variant="secondary">Ready</Badge>}
                    {fails > 0 && <Badge variant="outline">{fails} fail{fails === 1 ? "" : "s"}</Badge>}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {new Date(when).toLocaleString()} · {i.mileage.toLocaleString()} mi
                    {i.inspector_name && ` · ${i.inspector_name}`}
                  </div>
                  {i.notes && (
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {i.notes}
                    </div>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => setOpenId(i.id)}>View</Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <InspectionDetailDialog inspectionId={openId} open={!!openId} onOpenChange={(v) => !v && setOpenId(null)} />
    </div>
  );
}
