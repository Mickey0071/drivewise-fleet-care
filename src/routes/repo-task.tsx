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
import { completeRepoTask, startTask } from "@/lib/tasks.functions";

const searchSchema = z.object({ task_id: z.string().optional() });

export const Route = createFileRoute("/repo-task")({
  head: () => ({ meta: [{ title: "Repo — Camauto Rentals" }] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: RepoTaskPage,
});

type TaskRow = {
  id: string;
  status: string;
  description: string | null;
  address: string | null;
  due_date: string | null;
  year: number | null; make: string | null; model: string | null; plate: string | null;
  linked_vehicle_id: string | null;
  rp_reason: string | null;
  rp_customer_name: string | null;
  rp_customer_phone: string | null;
  rp_tow_authorized: boolean | null;
};

const STATUS_ITEMS = [
  "Vehicle found",
  "Vehicle accessible",
  "Keys obtained",
  "Vehicle drivable",
  "Vehicle towed (if not drivable)",
] as const;

const LOCATION_OPTIONS = [
  "Brought to main lot",
  "Towed to impound",
  "Other",
] as const;

function RepoTaskPage() {
  const { task_id } = Route.useSearch();
  const navigate = useNavigate();
  const doStart = useServerFn(startTask);
  const doComplete = useServerFn(completeRepoTask);
  const fileRef = useRef<HTMLInputElement>(null);

  const [task, setTask] = useState<TaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [odometer, setOdometer] = useState("");
  const [locationChoice, setLocationChoice] = useState<string>("");
  const [locationOther, setLocationOther] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
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
        .select("id, status, description, address, due_date, year, make, model, plate, linked_vehicle_id, rp_reason, rp_customer_name, rp_customer_phone, rp_tow_authorized")
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

  async function start() {
    if (!task) return;
    if (task.status === "pending") {
      try { await doStart({ data: { task_id: task.id } }); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Could not start task"); return; }
    }
    setStarted(true);
  }

  async function onPhotosPicked(files: FileList | null) {
    if (!files || !task) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        const url = await uploadVehiclePhoto(task.linked_vehicle_id ?? "repo", f);
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

  function toggle(item: string) {
    setChecklist((c) => ({ ...c, [item]: !c[item] }));
  }

  const odoNum = odometer.trim() ? Number(odometer) : null;
  const odoValid = odometer.trim() === "" || (Number.isFinite(odoNum) && (odoNum as number) >= 0);
  const locationAfter = locationChoice === "Other" ? locationOther.trim() : locationChoice;
  const canSubmit = !!checklist["Vehicle found"] && !!locationAfter && odoValid && !submitting && !uploading;

  async function submit() {
    if (!task || !canSubmit) return;
    setSubmitting(true);
    try {
      await doComplete({ data: {
        task_id: task.id,
        status_checklist: checklist,
        odometer: odoNum,
        photos,
        location_after: locationAfter,
        notes: notes.trim(),
      }});
      toast.success("Repo completed");
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
        <PageHeader title="🚨 Repo Completed" subtitle="Recovery recorded — admins notified for approval" />
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
          <p className="text-base font-semibold text-destructive">⚠️ REPO{vehicleLabel ? `: ${vehicleLabel}` : ""}</p>
          {task.plate && <p className="text-muted-foreground">Tag #{task.plate}</p>}
          {task.due_date && <p><span className="text-muted-foreground">Scheduled:</span> {task.due_date}</p>}
          {task.rp_reason && <p><span className="text-muted-foreground">Reason:</span> {task.rp_reason}</p>}
          {task.rp_customer_name && <p><span className="text-muted-foreground">Customer:</span> {task.rp_customer_name}</p>}
          {task.rp_customer_phone && (
            <p><span className="text-muted-foreground">Phone:</span> <a href={`tel:${task.rp_customer_phone}`} className="underline">{task.rp_customer_phone}</a></p>
          )}
          {task.address && <p><span className="text-muted-foreground">Pickup location:</span> {task.address}</p>}
          {task.description && <p><span className="text-muted-foreground">Instructions:</span> {task.description}</p>}
          <p><span className="text-muted-foreground">Tow authorized:</span> {task.rp_tow_authorized ? "Yes" : "No"}</p>
        </CardContent>
      </Card>

      {!started ? (
        <Button className="h-12 w-full text-base font-semibold" onClick={start}>Start Repo</Button>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label>Current Vehicle Status</Label>
              <div className="space-y-2">
                {STATUS_ITEMS.map((item) => (
                  <label key={item} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!!checklist[item]} onCheckedChange={() => toggle(item)} />
                    {item}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-6">
              <Label htmlFor="rp-odo">Odometer Reading</Label>
              <Input id="rp-odo" type="number" inputMode="numeric" min={0} value={odometer}
                onChange={(e) => setOdometer(e.target.value)} placeholder="e.g. 145200" className="h-11" />
              {!odoValid && <p className="text-xs text-destructive">Enter a valid mileage.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label>Vehicle Condition (photos)</Label>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden"
                onChange={(e) => onPhotosPicked(e.target.files)} />
              <Button variant="outline" className="h-11 w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : <><Camera className="mr-2 h-4 w-4" /> Take Photos</>}
              </Button>
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((url, i) => (
                    <div key={url} className="relative">
                      <img src={url} alt={`Repo ${i + 1}`} className="h-20 w-full rounded object-cover" />
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
            <CardContent className="space-y-3 pt-6">
              <Label>Vehicle Location After Repo</Label>
              <div className="space-y-2">
                {LOCATION_OPTIONS.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={locationChoice === opt} onCheckedChange={(v) => setLocationChoice(v === true ? opt : "")} />
                    {opt === "Other" ? "Towed to / Other location" : opt}
                  </label>
                ))}
              </div>
              {locationChoice === "Other" && (
                <Input value={locationOther} onChange={(e) => setLocationOther(e.target.value)}
                  placeholder="Enter location" maxLength={500} className="h-11" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-6">
              <Label htmlFor="rp-notes">Notes</Label>
              <Textarea id="rp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                maxLength={4000} placeholder='e.g. "Vehicle found, drivable, brought to lot"' />
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