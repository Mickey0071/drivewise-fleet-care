import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Wrench, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/mock/data";
import { CHECKLIST_SECTIONS, JOB_TYPE_LABELS, FUEL_LEVEL_LABELS } from "@/lib/checklist-items";

interface InspectionRow {
  id: string;
  vehicle_id: string;
  rental_id: string;
  type: string;
  date: string;
  mileage: number;
  fuel_level: string | null;
  damage_noted: boolean;
  completed_by: string;
  inspector_name: string | null;
  job_type: string | null;
  checklist_items: Record<string, string> | null;
  ready_to_rent: boolean | null;
  submitted_at: string | null;
  notes?: string | null;
  created_at: string;
}

function StatusBadge({ value }: { value?: string }) {
  if (value === "pass") return <Badge variant="secondary">✅ Pass</Badge>;
  if (value === "fail") return <Badge variant="destructive">❌ Fail</Badge>;
  if (value === "na") return <Badge variant="outline">➖ N/A</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

export function InspectionDetailDialog({
  inspectionId,
  open,
  onOpenChange,
}: {
  inspectionId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [row, setRow] = useState<InspectionRow | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !inspectionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRow(null);
    setPhotos([]);
    (async () => {
      const { data, error } = await supabase
        .from("inspections")
        .select("*")
        .eq("id", inspectionId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setError(error?.message ?? "Inspection not found");
        setLoading(false);
        return;
      }
      setRow(data as unknown as InspectionRow);
      try {
        const { data: files } = await supabase.storage
          .from("vehicle-photos")
          .list(`inspections/${inspectionId}`, { limit: 50 });
        if (!cancelled && files?.length) {
          const urls = files
            .filter((f) => f.name && !f.name.startsWith("."))
            .map((f) => supabase.storage.from("vehicle-photos").getPublicUrl(`inspections/${inspectionId}/${f.name}`).data.publicUrl);
          setPhotos(urls);
        }
      } catch {
        // ignore
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, inspectionId]);

  const checklist = row?.checklist_items ?? {};
  const submittedDate = row?.submitted_at?.slice(0, 10) ?? row?.created_at?.slice(0, 10) ?? row?.date;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inspection details</DialogTitle>
          <DialogDescription>
            {row ? `${row.mileage.toLocaleString()} mi · ${fmtDate(row.date)}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Loading inspection…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {row && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Inspector</div>
                <div className="font-medium">{row.inspector_name || row.completed_by || "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Job type</div>
                <div className="font-medium">{row.job_type ? (JOB_TYPE_LABELS[row.job_type] ?? row.job_type) : "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Submitted</div>
                <div className="font-medium">{fmtDate(submittedDate)}</div>
              </div>
            </div>

            {row.ready_to_rent === true && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="font-medium">Ready for next renter</span>
              </div>
            )}
            {row.ready_to_rent === false && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
                <Wrench className="h-4 w-4 text-amber-600" />
                <span className="font-medium">Needs mechanic — flagged not ready to rent</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Fuel level</div>
                <div className="font-medium">
                  {row.fuel_level ? (FUEL_LEVEL_LABELS[row.fuel_level] ?? row.fuel_level) : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Mileage</div>
                <div className="font-medium">{row.mileage?.toLocaleString() ?? "—"} mi</div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs uppercase text-muted-foreground">Checklist</div>
              {CHECKLIST_SECTIONS.map((section) => (
                <div key={section.title} className="space-y-1.5">
                  <div className="text-sm font-semibold">{section.title}</div>
                  <div className="space-y-1">
                    {section.items.map((item) => {
                      const v = checklist[item.key];
                      const failed = v === "fail";
                      return (
                        <div
                          key={item.key}
                          className={`flex items-center justify-between rounded-md border px-3 py-1.5 text-sm ${failed ? "border-destructive/40 bg-destructive/5" : "border-border"}`}
                        >
                          <span>{item.label}</span>
                          <StatusBadge value={v} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {row.damage_noted && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="font-medium">Damage noted</span>
              </div>
            )}

            {photos.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs uppercase text-muted-foreground">Damage photos</div>
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-md border border-border bg-muted">
                      <img src={url} alt="Inspection" className="h-full w-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {row.notes && (
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Notes</div>
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap">{row.notes}</div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
