import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { adminCreateTask, listAssignableRunners } from "@/lib/tasks.functions";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type TaskTypeKey =
  | "pickup" | "dropoff" | "dmv" | "repo" | "parts" | "inspection" | "mechanic_run" | "other";

export const TASK_TYPE_OPTIONS: { value: TaskTypeKey; label: string }[] = [
  { value: "pickup", label: "🔑 Pickup" },
  { value: "dropoff", label: "🚗 Dropoff" },
  { value: "dmv", label: "📋 DMV" },
  { value: "repo", label: "🚨 Repo" },
  { value: "mechanic_run", label: "🔧 Mechanic Run" },
  { value: "parts", label: "🏷️ Parts" },
  { value: "inspection", label: "✅ Inspection" },
  { value: "other", label: "📌 Other" },
];

type Vehicle = { id: string; year: number; make: string; model: string; plate: string };
type Rental = { id: string; vehicle_id: string; driver_id: string; start_date: string };
type Runner = { id: string; first_name: string | null; last_name: string | null; username: string | null; phone: string | null };

export type NewTaskPrefill = {
  task_type?: TaskTypeKey;
  linked_vehicle_id?: string;
  linked_rental_id?: string;
  description?: string;
  address?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefill?: NewTaskPrefill;
  onCreated?: () => void;
};

const today = () => new Date().toISOString().slice(0, 10);

export function NewTaskDialog({ open, onOpenChange, prefill, onCreated }: Props) {
  const createTask = useServerFn(adminCreateTask);
  const loadRunners = useServerFn(listAssignableRunners);

  const [runners, setRunners] = useState<Runner[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);

  const [assignedTo, setAssignedTo] = useState<string>("");
  const [taskType, setTaskType] = useState<TaskTypeKey>(prefill?.task_type ?? "other");
  const [vehicleId, setVehicleId] = useState<string>(prefill?.linked_vehicle_id ?? "");
  const [rentalId, setRentalId] = useState<string>(prefill?.linked_rental_id ?? "");
  const [description, setDescription] = useState<string>(prefill?.description ?? "");
  const [address, setAddress] = useState<string>(prefill?.address ?? "");
  const [dueDate, setDueDate] = useState<string>(today());
  const [priority, setPriority] = useState<"urgent" | "normal" | "flexible">("normal");
  const [notifySms, setNotifySms] = useState(true);
  const [busy, setBusy] = useState(false);

  // Reset state when dialog opens (so prefill from a different context is honored)
  useEffect(() => {
    if (!open) return;
    setTaskType(prefill?.task_type ?? "other");
    setVehicleId(prefill?.linked_vehicle_id ?? "");
    setRentalId(prefill?.linked_rental_id ?? "");
    setDescription(prefill?.description ?? "");
    setAddress(prefill?.address ?? "");
    setDueDate(today());
    setPriority("normal");
    setNotifySms(true);
    setBusy(false);
  }, [open, prefill]);

  // Load data on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [{ runners: r }, vRes, rRes] = await Promise.all([
        loadRunners({}).catch((e) => { console.error(e); return { runners: [] as Runner[] }; }),
        supabase.from("vehicles").select("id, year, make, model, plate").order("make"),
        supabase.from("rentals").select("id, vehicle_id, driver_id, start_date").order("start_date", { ascending: false }).limit(200),
      ]);
      if (cancelled) return;
      setRunners(r);
      setVehicles((vRes.data ?? []) as Vehicle[]);
      setRentals((rRes.data ?? []) as Rental[]);
    })();
    return () => { cancelled = true; };
  }, [open, loadRunners]);

  const selectedRunner = useMemo(() => runners.find((r) => r.id === assignedTo), [runners, assignedTo]);
  const selectedVehicle = useMemo(() => vehicles.find((v) => v.id === vehicleId), [vehicles, vehicleId]);

  const suggestedDescription = useMemo(() => {
    if (description) return description;
    const v = selectedVehicle ? `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}` : "";
    const label = TASK_TYPE_OPTIONS.find((t) => t.value === taskType)?.label.replace(/^[^\s]+\s/, "") ?? "Task";
    return v ? `${label} ${v}` : label;
  }, [description, selectedVehicle, taskType]);

  function runnerLabel(r: Runner) {
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || r.username || "Runner";
    const base = r.username ? `${name} (${r.username})` : name;
    return `${r.phone ? "📱" : "🚫📱"} ${base}`;
  }

  async function submit() {
    if (!assignedTo) { toast.error("Pick a runner"); return; }
    setBusy(true);
    try {
      const res = await createTask({ data: {
        assigned_to_user_id: assignedTo,
        task_type: taskType,
        linked_vehicle_id: vehicleId || null,
        linked_rental_id: rentalId || null,
        description: (description || suggestedDescription) || null,
        address: address || null,
        due_date: dueDate || null,
        priority,
        notify_sms: notifySms,
      }});
      const smsBlurb =
        res.sms_status === "queued" ? "SMS sending in background"
        : "SMS skipped (no phone on file)";
      toast.success(`Task sent to ${res.runner_name} — ${smsBlurb}`);
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Send Task to Runner</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Assigned Runner</Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger><SelectValue placeholder="Pick a runner…" /></SelectTrigger>
              <SelectContent>
                {runners.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No runners assigned roles yet.</div>}
                {runners.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{runnerLabel(r)}{r.phone ? "" : " — no phone"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRunner && !selectedRunner.phone && (
              <p className="mt-1 text-xs text-amber-600">No phone on file — SMS will be skipped.</p>
            )}
          </div>

          <div>
            <Label>Task Type</Label>
            <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskTypeKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TASK_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Linked Vehicle</Label>
            <Select value={vehicleId || "__none"} onValueChange={(v) => setVehicleId(v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.year} {v.make} {v.model} — {v.plate}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Linked Rental (optional)</Label>
            <Select value={rentalId || "__none"} onValueChange={(v) => setRentalId(v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {rentals.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.id} · {r.driver_id} · {r.start_date}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              value={description}
              placeholder={suggestedDescription}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="task-addr">Address</Label>
            <Input id="task-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="task-due">Due Date</Label>
            <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div>
            <Label>Priority</Label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: "urgent", l: "🚨 Urgent" },
                { v: "normal", l: "✅ Normal" },
                { v: "flexible", l: "🕐 Flexible" },
              ] as const).map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setPriority(p.v)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm",
                    priority === p.v ? "border-primary bg-primary/10 font-semibold" : "border-border bg-background"
                  )}
                >
                  {p.l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={notifySms} onCheckedChange={(v) => setNotifySms(v === true)} />
              Notify via SMS
            </label>
            {notifySms && selectedRunner && !selectedRunner.phone && (
              <p className="mt-1 text-xs text-amber-600">
                ⚠️ This runner has no phone on file — SMS will be skipped. They'll only see the task on their My Tasks page when they log in.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !assignedTo}>{busy ? "Sending…" : "Send Task"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}