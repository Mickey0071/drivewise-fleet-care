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
import { completeTransportTask, startTask } from "@/lib/tasks.functions";

const searchSchema = z.object({ task_id: z.string().optional() });

export const Route = createFileRoute("/transport-task")({
  head: () => ({ meta: [{ title: "Transport — Camauto Rentals" }] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: TransportTaskPage,
});

type TaskRow = {
  id: string;
  status: string;
  description: string | null;
  due_date: string | null;
  year: number | null; make: string | null; model: string | null; plate: string | null;
  linked_vehicle_id: string | null;
  tr_from_address: string | null;
  tr_to_address: string | null;
  tr_reason: string | null;
  tr_instructions: string | null;
};

function TransportTaskPage() {
  const { task_id } = Route.useSearch();
  const navigate = useNavigate();
  const doStart = useServerFn(startTask);
  const doComplete = useServerFn(completeTransportTask);
  const pickupRef = useRef<HTMLInputElement>(null);
  const dropoffRef = useRef<HTMLInputElement>(null);

  const [task, setTask] = useState<TaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const [mileagePickup, setMileagePickup] = useState("");
  const [mileageDropoff, setMileageDropoff] = useState("");
  const [photosPickup, setPhotosPickup] = useState<string[]>([]);
  const [photosDropoff, setPhotosDropoff] = useState<string[]>([]);
  const [delivered, setDelivered] = useState(false);
  const [notes, setNotes] = useState("");
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
        .select("id, status, description, due_date, year, make, model, plate, linked_vehicle_id, tr_from_address, tr_to_address, tr_reason, tr_instructions")
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

  async function onPhotosPicked(files: FileList | null, which: "pickup" | "dropoff") {
    if (!files || !task) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        const url = await uploadVehiclePhoto(task.linked_vehicle_id ?? "transport", f);
        urls.push(url);
      }
      if (which === "pickup") setPhotosPickup((p) => [...p, ...urls]);
      else setPhotosDropoff((p) => [...p, ...urls]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setUploading(false);
      if (pickupRef.current) pickupRef.current.value = "";
      if (dropoffRef.current) dropoffRef.current.value = "";
    }
  }

  const milePickupNum = mileagePickup.trim() ? Number(mileagePickup) : null;
  const mileDropoffNum = mileageDropoff.trim() ? Number(mileageDropoff) : null;
  const milePickupValid = mileagePickup.trim() === "" || (Number.isFinite(milePickupNum) && (milePickupNum as number) >= 0);
  const mileDropoffValid = mileageDropoff.trim() === "" || (Number.isFinite(mileDropoffNum) && (mileDropoffNum as number) >= 0);
  const canSubmit = delivered && milePickupValid && mileDropoffValid && !submitting && !uploading;

  async function submit() {
    if (!task || !canSubmit) return;
    setSubmitting(true);
    try {
      await doComplete({ data: {
        task_id: task.id,
        mileage_pickup: milePickupNum,
        mileage_dropoff: mileDropoffNum,
        photos_pickup: photosPickup,
        photos_dropoff: photosDropoff,
        delivered,
        notes: notes.trim(),
      }});
      toast.success("Transport completed");
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
        <PageHeader title="🚚 Transport Completed" subtitle="Recorded — admins notified for approval" />
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
          <p className="text-base font-semibold">🚚 TRANSPORT{vehicleLabel ? `: ${vehicleLabel}` : ""}</p>
          {task.plate && <p className="text-muted-foreground">Tag #{task.plate}</p>}
          {task.due_date && <p><span className="text-muted-foreground">Scheduled:</span> {task.due_date}</p>}
          {task.tr_from_address && <p><span className="text-muted-foreground">Pickup:</span> {task.tr_from_address}</p>}
          {task.tr_to_address && <p><span className="text-muted-foreground">Drop Off:</span> {task.tr_to_address}</p>}
          {task.tr_reason && <p><span className="text-muted-foreground">Reason:</span> {task.tr_reason}</p>}
          {task.tr_instructions && <p><span className="text-muted-foreground">Instructions:</span> {task.tr_instructions}</p>}
          {task.description && <p><span className="text-muted-foreground">Details:</span> {task.description}</p>}
        </CardContent>
      </Card>

      {!started ? (
        <Button className="h-12 w-full text-base font-semibold" onClick={start}>Start Transport</Button>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-2 pt-6">
              <Label htmlFor="tr-mile-pickup">Mileage at Pickup</Label>
              <Input id="tr-mile-pickup" type="number" inputMode="numeric" min={0} value={mileagePickup}
                onChange={(e) => setMileagePickup(e.target.value)} placeholder="e.g. 84200" className="h-11" />
              {!milePickupValid && <p className="text-xs text-destructive">Enter a valid mileage.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label>Photos (pickup location)</Label>
              <input ref={pickupRef} type="file" accept="image/*" multiple capture="environment" className="hidden"
                onChange={(e) => onPhotosPicked(e.target.files, "pickup")} />
              <Button variant="outline" className="h-11 w-full" disabled={uploading} onClick={() => pickupRef.current?.click()}>
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : <><Camera className="mr-2 h-4 w-4" /> Take Photos</>}
              </Button>
              {photosPickup.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photosPickup.map((url, i) => (
                    <div key={url} className="relative">
                      <img src={url} alt={`Pickup ${i + 1}`} className="h-20 w-full rounded object-cover" />
                      <button type="button" onClick={() => setPhotosPickup((p) => p.filter((u) => u !== url))}
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
              <Label htmlFor="tr-mile-dropoff">Mileage at Drop-off</Label>
              <Input id="tr-mile-dropoff" type="number" inputMode="numeric" min={0} value={mileageDropoff}
                onChange={(e) => setMileageDropoff(e.target.value)} placeholder="e.g. 84230" className="h-11" />
              {!mileDropoffValid && <p className="text-xs text-destructive">Enter a valid mileage.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label>Photos (drop-off location)</Label>
              <input ref={dropoffRef} type="file" accept="image/*" multiple capture="environment" className="hidden"
                onChange={(e) => onPhotosPicked(e.target.files, "dropoff")} />
              <Button variant="outline" className="h-11 w-full" disabled={uploading} onClick={() => dropoffRef.current?.click()}>
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : <><Camera className="mr-2 h-4 w-4" /> Take Photos</>}
              </Button>
              {photosDropoff.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photosDropoff.map((url, i) => (
                    <div key={url} className="relative">
                      <img src={url} alt={`Drop-off ${i + 1}`} className="h-20 w-full rounded object-cover" />
                      <button type="button" onClick={() => setPhotosDropoff((p) => p.filter((u) => u !== url))}
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
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={delivered} onCheckedChange={(v) => setDelivered(v === true)} />
                I completed the transport
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-6">
              <Label htmlFor="tr-notes">Notes</Label>
              <Textarea id="tr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                maxLength={4000} placeholder='e.g. "Any issues during transport"' />
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