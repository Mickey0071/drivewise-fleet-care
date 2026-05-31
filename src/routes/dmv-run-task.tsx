import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Camera, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uploadVehiclePhoto } from "@/lib/mock/store";
import { completeDmvRunTask, startTask } from "@/lib/tasks.functions";

const searchSchema = z.object({ task_id: z.string().optional() });

export const Route = createFileRoute("/dmv-run-task")({
  head: () => ({ meta: [{ title: "DMV Run — Camauto Rentals" }] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: DmvRunTaskPage,
});

type TaskRow = {
  id: string;
  status: string;
  description: string | null;
  address: string | null;
  due_date: string | null;
  year: number | null; make: string | null; model: string | null; plate: string | null;
  linked_vehicle_id: string | null;
  dr_service: string | null;
  dr_documents_needed: Record<string, boolean> | null;
  dr_location: string | null;
  dr_expected_cost: number | null;
};

const SERVICE_COMPLETED_ITEMS = [
  "Registration renewed",
  "Title transferred (if applicable)",
  "Inspection sticker received",
  "Emissions passed (if applicable)",
  "New license plate received",
] as const;

const DOCS_RECEIVED_ITEMS = [
  "New registration certificate",
  "New inspection sticker",
  "New license plate (if ordered)",
  "Emissions certificate (if applicable)",
] as const;

function DmvRunTaskPage() {
  const { task_id } = Route.useSearch();
  const navigate = useNavigate();
  const doStart = useServerFn(startTask);
  const doComplete = useServerFn(completeDmvRunTask);
  const fileRef = useRef<HTMLInputElement>(null);

  const [task, setTask] = useState<TaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const [packed, setPacked] = useState<Record<string, boolean>>({});
  const [serviceDone, setServiceDone] = useState<Record<string, boolean>>({});
  const [docsReceived, setDocsReceived] = useState<Record<string, boolean>>({});
  const [actualCost, setActualCost] = useState("");
  const [newRegExpiry, setNewRegExpiry] = useState("");
  const [newStickerExpiry, setNewStickerExpiry] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [arrivalAt, setArrivalAt] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!task_id) { setError("No task specified."); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("tasks")
        .select("id, status, description, address, due_date, year, make, model, plate, linked_vehicle_id, dr_service, dr_documents_needed, dr_location, dr_expected_cost")
        .eq("id", task_id)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      else if (!data) setError("Task not found or not assigned to you.");
      else {
        setTask(data as TaskRow);
        if (data.status === "completed") setDone(true);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [task_id]);

  // Document keys the admin requested.
  const docKeys = task?.dr_documents_needed
    ? Object.entries(task.dr_documents_needed).filter(([, v]) => v).map(([k]) => k)
    : [];

  async function start() {
    if (!task) return;
    if (task.status === "pending") {
      try { await doStart({ data: { task_id: task.id } }); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Could not start task"); return; }
    }
    setArrivalAt(new Date().toISOString());
    setStarted(true);
  }

  async function onPhotosPicked(files: FileList | null) {
    if (!files || !task) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        const url = await uploadVehiclePhoto(task.linked_vehicle_id ?? "dmv", f);
        urls.push(url);
      }
      setPhotos((p) => [...p, ...urls]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const costNum = actualCost.trim() ? Number(actualCost) : null;
  const costValid = actualCost.trim() === "" || (Number.isFinite(costNum) && (costNum as number) >= 0);
  const canSubmit = !submitting && !uploading && costValid;

  async function submit() {
    if (!task || !canSubmit) return;
    setSubmitting(true);
    try {
      await doComplete({ data: {
        task_id: task.id,
        documents_packed: packed,
        arrival_at: arrivalAt,
        service_completed: serviceDone,
        actual_cost: costNum,
        documents_received: docsReceived,
        photos,
        new_reg_expiry: newRegExpiry || null,
        new_sticker_expiry: newStickerExpiry || null,
        notes: notes.trim(),
      }});
      toast.success("DMV run completed");
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl pb-24"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }
  if (error || !task) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-24">
        <Link to="/my-tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to tasks
        </Link>
        <Card><CardContent className="py-10 text-center text-sm text-destructive">{error ?? "Task not found"}</CardContent></Card>
      </div>
    );
  }

  const vehicleLabel = task.year ? `${task.year} ${task.make ?? ""} ${task.model ?? ""}`.trim() : null;

  if (done) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-24">
        <PageHeader title="📋 DMV Run Completed" subtitle="Recorded — admins notified for approval" />
        <Button className="h-12 w-full" onClick={() => navigate({ to: "/my-tasks" })}>Back to My Tasks</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-40">
      <Link to="/my-tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to tasks
      </Link>

      <Card>
        <CardContent className="space-y-1 pt-6 text-sm">
          <p className="text-base font-semibold">🏛️ DMV RUN{vehicleLabel ? `: ${vehicleLabel}` : ""}</p>
          {task.plate && <p className="text-muted-foreground">Tag #{task.plate}</p>}
          {task.due_date && <p><span className="text-muted-foreground">Assigned:</span> {task.due_date}</p>}
          {task.dr_service && <p><span className="text-muted-foreground">Service:</span> {task.dr_service}</p>}
          {task.description && <p><span className="text-muted-foreground">Details:</span> {task.description}</p>}
          {docKeys.length > 0 && (
            <div>
              <p className="text-muted-foreground">Documents to bring:</p>
              <ul className="ml-4 list-disc">{docKeys.map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}
          {task.dr_location && <p><span className="text-muted-foreground">DMV Location:</span> {task.dr_location}</p>}
          {task.dr_expected_cost != null && <p><span className="text-muted-foreground">Expected Cost:</span> ${Number(task.dr_expected_cost).toFixed(2)}</p>}
        </CardContent>
      </Card>

      {!started ? (
        <Button className="h-12 w-full text-base font-semibold" onClick={start}>Start DMV Run</Button>
      ) : (
        <>
          {docKeys.length > 0 && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <Label>Documents Packed</Label>
                <div className="space-y-2">
                  {docKeys.map((d) => (
                    <label key={d} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={!!packed[d]} onCheckedChange={() => setPacked((p) => ({ ...p, [d]: !p[d] }))} />
                      {d} — packed
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {task.dr_location && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">DMV Location (locked):</span> {task.dr_location}
            </div>
          )}

          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label>Service Completed</Label>
              <div className="space-y-2">
                {SERVICE_COMPLETED_ITEMS.map((item) => (
                  <label key={item} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!!serviceDone[item]} onCheckedChange={() => setServiceDone((p) => ({ ...p, [item]: !p[item] }))} />
                    {item}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-6">
              <Label htmlFor="dr-cost">Actual Cost</Label>
              <Input id="dr-cost" type="number" inputMode="decimal" min={0} value={actualCost}
                onChange={(e) => setActualCost(e.target.value)} placeholder="e.g. 95" className="h-11" />
              {!costValid && <p className="text-xs text-destructive">Enter a valid amount.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label>Documents Received</Label>
              <div className="space-y-2">
                {DOCS_RECEIVED_ITEMS.map((item) => (
                  <label key={item} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!!docsReceived[item]} onCheckedChange={() => setDocsReceived((p) => ({ ...p, [item]: !p[item] }))} />
                    {item}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid grid-cols-1 gap-3 pt-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dr-reg">New Registration Expiry</Label>
                <Input id="dr-reg" type="date" value={newRegExpiry} onChange={(e) => setNewRegExpiry(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dr-sticker">New Sticker Expiry</Label>
                <Input id="dr-sticker" type="date" value={newStickerExpiry} onChange={(e) => setNewStickerExpiry(e.target.value)} className="h-11" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label>Photos (of new documents)</Label>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden"
                onChange={(e) => onPhotosPicked(e.target.files)} />
              <Button variant="outline" className="h-11 w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : <><Camera className="mr-2 h-4 w-4" /> Take Photos</>}
              </Button>
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((url, i) => (
                    <div key={url} className="relative">
                      <img src={url} alt={`DMV ${i + 1}`} className="h-20 w-full rounded object-cover" />
                      <button type="button" onClick={() => setPhotos((p) => p.filter((u) => u !== url))}
                        className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-6">
              <Label htmlFor="dr-notes">Notes</Label>
              <Textarea id="dr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                maxLength={4000} placeholder='e.g. "Registration renewed, sticker applied to windshield"' />
            </CardContent>
          </Card>

          <div className="fixed inset-x-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 88px)" }}>
            <div className="mx-auto max-w-2xl">
              <Button className="h-12 w-full text-base font-semibold" disabled={!canSubmit} onClick={submit}>
                {submitting ? "Submitting…" : "Mark Complete"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
