import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/mock/data";

interface InspectionRow {
  id: string;
  vehicle_id: string;
  rental_id: string;
  type: string;
  date: string;
  mileage: number;
  fuel_level: number;
  damage_noted: boolean;
  completed_by: string;
  inspector_name: string | null;
  tires_status: string | null;
  fluids_status: string | null;
  brakes_status: string | null;
  lights_status: string | null;
  body_status: string | null;
  interior_status: string | null;
  tires_notes: string | null;
  fluids_notes: string | null;
  brakes_notes: string | null;
  lights_notes: string | null;
  body_notes: string | null;
  interior_notes: string | null;
  created_at: string;
}

const ITEMS = [
  { key: "tires", label: "Tires" },
  { key: "fluids", label: "Fluids" },
  { key: "brakes", label: "Brakes" },
  { key: "lights", label: "Lights" },
  { key: "body", label: "Body" },
  { key: "interior", label: "Interior" },
] as const;

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
      // Best-effort: list photos under inspections/{id}/ in vehicle-photos bucket
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
    return () => {
      cancelled = true;
    };
  }, [open, inspectionId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inspection details</DialogTitle>
          <DialogDescription>
            {row ? `${row.type} on ${fmtDate(row.date)} · ${row.mileage.toLocaleString()} mi` : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Loading inspection…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {row && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Inspector</div>
                <div className="font-medium">{row.inspector_name || row.completed_by || "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Submitted</div>
                <div className="font-medium">{fmtDate(row.created_at?.slice(0, 10))}</div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs uppercase text-muted-foreground">Checklist</div>
              {ITEMS.map((it) => {
                const status = (row as any)[`${it.key}_status`] as string | null;
                const notes = (row as any)[`${it.key}_notes`] as string | null;
                const failed = status === "fail";
                return (
                  <div
                    key={it.key}
                    className={`rounded-md border px-3 py-2 ${failed ? "border-destructive/40 bg-destructive/5" : "border-border"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{it.label}</span>
                      {status ? (
                        <Badge variant={failed ? "destructive" : "secondary"}>
                          {failed ? "Fail" : "Pass"}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not checked</span>
                      )}
                    </div>
                    {failed && notes && (
                      <div className="mt-1 text-sm text-muted-foreground">{notes}</div>
                    )}
                  </div>
                );
              })}
            </div>
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}