import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { createMechanicDropoff } from "@/lib/tasks.functions";

export const Route = createFileRoute("/mechanic-task")({
  head: () => ({ meta: [{ title: "Mechanic Drop-off — Camauto Rentals" }] }),
  component: MechanicTaskPage,
});

type VehicleRow = { id: string; year: number; make: string; model: string; plate: string };

const MECHANIC_TYPES = [
  "General mechanic",
  "Body shop",
  "Engine / drivetrain",
  "Transmission",
  "Tires / alignment",
  "Electrical",
  "AC / HVAC",
  "Diagnostics",
  "Other",
];

function MechanicTaskPage() {
  const navigate = useNavigate();
  const doSubmit = useServerFn(createMechanicDropoff);

  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [mechanicType, setMechanicType] = useState(MECHANIC_TYPES[0]);
  const [customType, setCustomType] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("id, year, make, model, plate")
        .order("make", { ascending: true });
      if (!cancelled) setVehicles((data ?? []) as VehicleRow[]);
    })();
    return () => { cancelled = true; };
  }, []);

  const effectiveType = mechanicType === "Other" ? customType.trim() : mechanicType;
  const canSubmit = !!vehicleId && !!effectiveType && reason.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await doSubmit({
        data: {
          vehicle_id: vehicleId,
          mechanic_type: effectiveType,
          reason: reason.trim(),
          notes: notes.trim(),
        },
      });
      toast.success("Mechanic drop-off logged");
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-24">
        <PageHeader title="✅ Mechanic Drop-off Logged" subtitle="Maintenance ticket created and admins notified" />
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" className="h-12" onClick={() => { setDone(false); setVehicleId(""); setReason(""); setNotes(""); setCustomType(""); }}>
            Log another
          </Button>
          <Button className="h-12" onClick={() => navigate({ to: "/checklist" })}>
            Back to Task Portal
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24">
      <PageHeader title="🔧 Mechanic Drop-off" subtitle="Tell us which mechanic and why the vehicle is being dropped off" />

      <Card>
        <CardContent className="space-y-2 pt-6">
          <Label htmlFor="mech-vehicle">Vehicle *</Label>
          <select
            id="mech-vehicle"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select a vehicle…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.year} {v.make} {v.model} — {v.plate}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <Label htmlFor="mech-type">Mechanic type *</Label>
          <select
            id="mech-type"
            value={mechanicType}
            onChange={(e) => setMechanicType(e.target.value)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {MECHANIC_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {mechanicType === "Other" && (
            <Input
              placeholder="Describe the mechanic / shop"
              value={customType}
              onChange={(e) => setCustomType(e.target.value)}
              maxLength={120}
              className="h-11"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <Label htmlFor="mech-reason">Reason for drop-off *</Label>
          <Textarea
            id="mech-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="e.g. Front-end clunk over bumps, customer reported brake noise…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <Label htmlFor="mech-notes">Notes (optional)</Label>
          <Textarea
            id="mech-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Anything else the office should know?"
          />
        </CardContent>
      </Card>

      <Button className="h-12 w-full text-base font-semibold" disabled={!canSubmit} onClick={submit}>
        {submitting ? "Submitting…" : "Log Mechanic Drop-off"}
      </Button>
    </div>
  );
}