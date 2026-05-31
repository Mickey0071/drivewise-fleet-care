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
import { ArrowLeft, Camera, Loader2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uploadVehiclePhoto } from "@/lib/mock/store";
import { completePartsRunTask, startTask } from "@/lib/tasks.functions";

const searchSchema = z.object({ task_id: z.string().optional() });

export const Route = createFileRoute("/parts-run-task")({
  head: () => ({ meta: [{ title: "Parts Run — Camauto Rentals" }] }),
  validateSearch: (s) => searchSchema.parse(s),
  component: PartsRunTaskPage,
});

type TaskRow = {
  id: string;
  status: string;
  description: string | null;
  address: string | null;
  due_date: string | null;
  year: number | null; make: string | null; model: string | null; plate: string | null;
  linked_vehicle_id: string | null;
  pr_vendor_name: string | null;
  pr_contact_phone: string | null;
  pr_parts_needed: string | null;
  pr_destination: string | null;
};

type Part = { label: string; checked: boolean };

function parseParts(text: string | null): Part[] {
  if (!text) return [];
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label, checked: false }));
}

function PartsRunTaskPage() {
  const { task_id } = Route.useSearch();
  const navigate = useNavigate();
  const doStart = useServerFn(startTask);
  const doComplete = useServerFn(completePartsRunTask);
  const fileRef = useRef<HTMLInputElement>(null);

  const [task, setTask] = useState<TaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const [parts, setParts] = useState<Part[]>([]);
  const [newPart, setNewPart] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [delivered, setDelivered] = useState(false);
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
        .select("id, status, description, address, due_date, year, make, model, plate, linked_vehicle_id, pr_vendor_name, pr_contact_phone, pr_parts_needed, pr_destination")
        .eq("id", task_id)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      else if (!data) setError("Task not found or not assigned to you.");
      else {
        setTask(data as TaskRow);
        setParts(parseParts((data as TaskRow).pr_parts_needed));
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
        const url = await uploadVehiclePhoto(task.linked_vehicle_id ?? "parts-run", f);
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

  function togglePart(i: number) {
    setParts((p) => p.map((x, idx) => (idx === i ? { ...x, checked: !x.checked } : x)));
  }
  function removePart(i: number) {
    setParts((p) => p.filter((_, idx) => idx !== i));
  }
  function addPart() {
    const label = newPart.trim();
    if (!label) return;
    setParts((p) => [...p, { label, checked: true }]);
    setNewPart("");
  }

  const costNum = cost.trim() ? Number(cost) : null;
  const costValid = cost.trim() === "" || (Number.isFinite(costNum) && (costNum as number) >= 0);
  const canSubmit = delivered && costValid && !submitting && !uploading;

  async function submit() {
    if (!task || !canSubmit) return;
    setSubmitting(true);
    try {
      await doComplete({ data: {
        task_id: task.id,
        parts_picked_up: parts,
        cost: costNum,
        photos,
        delivered,
        delivery_notes: notes.trim(),
      }});
      toast.success("Parts run completed");
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
        <PageHeader title="✅ Parts Run Completed" subtitle="Delivery recorded — admins notified for approval" />
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
          <p className="text-base font-semibold">📦 Parts Run{vehicleLabel ? `: ${vehicleLabel}` : ""}</p>
          {task.plate && <p className="text-muted-foreground">Tag #{task.plate}</p>}
          {task.due_date && <p><span className="text-muted-foreground">Scheduled:</span> {task.due_date}</p>}
          {task.pr_vendor_name && <p><span className="text-muted-foreground">Vendor:</span> {task.pr_vendor_name}</p>}
          {task.address && <p><span className="text-muted-foreground">Address:</span> {task.address}</p>}
          {task.pr_contact_phone && (
            <p><span className="text-muted-foreground">Phone:</span> <a href={`tel:${task.pr_contact_phone}`} className="underline">{task.pr_contact_phone}</a></p>
          )}
          {task.pr_parts_needed && <p><span className="text-muted-foreground">Parts to pick up:</span> {task.pr_parts_needed}</p>}
          {task.pr_destination && <p><span className="text-muted-foreground">Destination:</span> {task.pr_destination}</p>}
          {task.description && <p><span className="text-muted-foreground">Notes:</span> {task.description}</p>}
        </CardContent>
      </Card>

      {!started ? (
        <Button className="h-12 w-full text-base font-semibold" onClick={start}>Start Parts Run</Button>
      ) : (
        <>
          {(task.pr_vendor_name || task.address || task.pr_contact_phone) && (
            <Card>
              <CardContent className="space-y-1 pt-6 text-sm">
                <p className="font-semibold">Vendor Details (locked)</p>
                {task.pr_vendor_name && <p><span className="text-muted-foreground">Vendor:</span> {task.pr_vendor_name}</p>}
                {task.address && <p><span className="text-muted-foreground">Address:</span> {task.address}</p>}
                {task.pr_contact_phone && (
                  <p><span className="text-muted-foreground">Phone:</span> <a href={`tel:${task.pr_contact_phone}`} className="underline">{task.pr_contact_phone}</a></p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label>Parts Picked Up</Label>
              <div className="space-y-2">
                {parts.map((p, i) => (
                  <div key={`${p.label}-${i}`} className="flex items-center gap-2">
                    <Checkbox checked={p.checked} onCheckedChange={() => togglePart(i)} />
                    <span className="flex-1 text-sm">{p.label}</span>
                    <button type="button" onClick={() => removePart(i)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {parts.length === 0 && <p className="text-xs text-muted-foreground">No parts listed — add them below.</p>}
              </div>
              <div className="flex gap-2">
                <Input value={newPart} onChange={(e) => setNewPart(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPart(); } }}
                  placeholder="Add another part" className="h-10" />
                <Button type="button" variant="outline" className="h-10" onClick={addPart}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <Label>Photos (receipt / parts)</Label>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden"
                onChange={(e) => onPhotosPicked(e.target.files)} />
              <Button variant="outline" className="h-11 w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : <><Camera className="mr-2 h-4 w-4" /> Take Photos</>}
              </Button>
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((url, i) => (
                    <div key={url} className="relative">
                      <img src={url} alt={`Parts ${i + 1}`} className="h-20 w-full rounded object-cover" />
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

          {task.pr_destination && (
            <Card>
              <CardContent className="pt-6 text-sm">
                <p><span className="text-muted-foreground">Destination (locked):</span> {task.pr_destination}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-2 pt-6">
              <Label htmlFor="pr-cost">Cost / Receipt Total ($)</Label>
              <Input id="pr-cost" type="number" inputMode="decimal" min={0} step="0.01" value={cost}
                onChange={(e) => setCost(e.target.value)} placeholder="e.g. 87.50" className="h-11" />
              {!costValid && <p className="text-xs text-destructive">Enter a valid amount.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-6">
              <Label htmlFor="pr-notes">Notes</Label>
              <Textarea id="pr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                maxLength={4000} placeholder='e.g. "Delivered to John at ABC Repairs"' />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={delivered} onCheckedChange={(v) => setDelivered(v === true)} />
                Delivery confirmed — I delivered the parts
              </label>
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
