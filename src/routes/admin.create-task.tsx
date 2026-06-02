import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { assignTask } from "@/lib/tasks.functions";
import { TASK_TYPES, TASK_TYPE_KEYS, type TaskType } from "@/lib/task-types";

export const Route = createFileRoute("/admin/create-task")({
  head: () => ({ meta: [{ title: "Create Task — Camauto Rentals" }] }),
  component: SendTaskPage,
});

type VehicleRow = { id: string; year: number; make: string; model: string; plate: string; status: string };
type RunnerRow = { id: string; name: string; phone: string | null };

const MECHANIC_SERVICES = ["Oil change", "Alternator test", "Suspension check", "Battery test", "Road test"];

function vehicleLabel(v: VehicleRow) {
  return `${v.year} ${v.make} ${v.model} — ${v.plate}`;
}

function SendTaskPage() {
  const send = useServerFn(assignTask);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [runners, setRunners] = useState<RunnerRow[]>([]);

  const [type, setType] = useState<TaskType>("inspection");
  const [runnerId, setRunnerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [details, setDetails] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: v }, { data: roles }] = await Promise.all([
        supabase.from("vehicles").select("id, year, make, model, plate, status").order("make"),
        supabase.from("user_roles").select("user_id").eq("role", "runner"),
      ]);
      setVehicles((v ?? []) as VehicleRow[]);
      const ids = (roles ?? []).map((r: any) => r.user_id);
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, first_name, last_name, phone")
          .in("id", ids);
        setRunners(
          (profs ?? []).map((p: any) => ({
            id: p.id,
            name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Runner",
            phone: p.phone,
          }))
        );
      }
    })();
  }, []);

  const toggleService = (s: string) =>
    setServices((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const canSend = useMemo(
    () => !!type && !!runnerId && !!vehicleId && !busy,
    [type, runnerId, vehicleId, busy]
  );

  const handleSend = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      const v = vehicles.find((x) => x.id === vehicleId);
      const detailObj: Record<string, unknown> = { instructions: details.trim() };
      if (type === "mechanic") detailObj.services = services;
      const res = await send({
        data: {
          type,
          vehicleId,
          runnerId,
          details: detailObj,
          dueDate: dueDate || null,
          origin: window.location.origin,
          vehicleLabel: v ? vehicleLabel(v) : undefined,
        },
      });
      const runnerName = runners.find((r) => r.id === runnerId)?.name || res.runnerName;
      setLastSent(
        res.smsStatus === "sent"
          ? `✅ Task sent to ${runnerName} (SMS delivered).`
          : `✅ Task created for ${runnerName}. ⚠️ No phone on file — SMS not sent.`
      );
      toast.success(`Task sent to ${runnerName}`);
      setDetails("");
      setServices([]);
      setDueDate("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Create Task" subtitle="Assign a task to a runner and text them the link." />
      {lastSent && (
        <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {lastSent}
        </div>
      )}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <Label htmlFor="type">Task type</Label>
            <select
              id="type"
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as TaskType)}
            >
              {TASK_TYPE_KEYS.map((k) => (
                <option key={k} value={k}>{TASK_TYPES[k]}</option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="runner">Assign to runner</Label>
            <select
              id="runner"
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={runnerId}
              onChange={(e) => setRunnerId(e.target.value)}
            >
              <option value="">Select runner…</option>
              {runners.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.phone ? "" : " (no phone)"}</option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="vehicle">Vehicle</Label>
            <select
              id="vehicle"
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">Select vehicle…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>
              ))}
            </select>
          </div>

          {type === "mechanic" && (
            <div>
              <Label>Maintenance needed</Label>
              <div className="mt-2 grid gap-2">
                {MECHANIC_SERVICES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={services.includes(s)} onCheckedChange={() => toggleService(s)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="details">Details</Label>
            <Textarea
              id="details"
              className="mt-1"
              rows={3}
              placeholder="Task-specific instructions for the runner…"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="due">Due date (optional)</Label>
            <Input id="due" type="date" className="mt-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <Button className="w-full" size="lg" disabled={!canSend} onClick={handleSend}>
            {busy ? "Sending…" : "Create Task"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}