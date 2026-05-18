import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPendingInspectionPublic, submitPendingInspectionPublic } from "@/lib/inspection.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, ClipboardCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/inspect/$vehicleId/$token")({
  head: () => ({ meta: [{ title: "Vehicle Inspection — Camauto Rentals" }] }),
  component: InspectPage,
});

const CHECKLIST_ITEMS = [
  "Exterior damage check",
  "Interior cleanliness",
  "Mileage recorded",
  "Keys returned",
  "Both key fobs present",
  "Tire condition acceptable",
  "No warning lights on dash",
];

interface Loaded {
  vehicleId: string;
  rentalId: string;
  vehicle: { year: number; make: string; model: string; plate: string; mileage: number };
}

function InspectPage() {
  const { vehicleId, token } = Route.useParams();
  const loadFn = useServerFn(getPendingInspectionPublic);
  const submitFn = useServerFn(submitPendingInspectionPublic);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [done, setDone] = useState(false);

  const [mileage, setMileage] = useState<number>(0);
  const [fuelLevel, setFuelLevel] = useState<number>(100);
  const [damageNoted, setDamageNoted] = useState(false);
  const [completedBy, setCompletedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [check, setCheck] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadFn({ data: { vehicleId, token } })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setMileage(res.vehicle.mileage);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [vehicleId, token, loadFn]);

  async function onSubmit() {
    if (!data) return;
    if (!completedBy.trim()) { toast.error("Please enter your name"); return; }
    const missing = CHECKLIST_ITEMS.filter(i => !check[i]);
    if (missing.length > 0) {
      toast.error("Complete every checklist item", { description: `${missing.length} remaining` });
      return;
    }
    setSubmitting(true);
    try {
      await submitFn({ data: {
        vehicleId,
        token,
        mileage: Number(mileage) || 0,
        fuelLevel: Number(fuelLevel) || 0,
        damageNoted,
        completedBy: completedBy.trim(),
        notes: notes.trim() || undefined,
        checklist: CHECKLIST_ITEMS.reduce<Record<string, boolean>>((acc, k) => { acc[k] = !!check[k]; return acc; }, {}),
      }});
      setDone(true);
    } catch (e) {
      toast.error("Submission failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <PageShell><p className="text-center text-muted-foreground">Loading inspection…</p></PageShell>;
  }
  if (loadError) {
    return (
      <PageShell>
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
            <p className="font-medium">{loadError}</p>
            <p className="text-sm text-muted-foreground">If you believe this is wrong, contact dispatch.</p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }
  if (done) {
    return (
      <PageShell>
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <p className="text-lg font-semibold">Inspection submitted</p>
            <p className="text-sm text-muted-foreground">Vehicle returned to the available pool. You can close this page.</p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }
  if (!data) return null;

  return (
    <PageShell>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Post-rental inspection</CardTitle>
          </div>
          <div className="text-sm text-muted-foreground">
            {data.vehicle.year} {data.vehicle.make} {data.vehicle.model} · Plate {data.vehicle.plate}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="mi">Odometer (mi)</Label>
              <Input id="mi" inputMode="numeric" type="number" value={mileage} onChange={(e) => setMileage(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="fuel">Fuel level (%)</Label>
              <Input id="fuel" inputMode="numeric" type="number" min={0} max={100} value={fuelLevel} onChange={(e) => setFuelLevel(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label htmlFor="by">Your name</Label>
            <Input id="by" value={completedBy} onChange={(e) => setCompletedBy(e.target.value)} placeholder="Runner name" />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="text-sm font-medium">Checklist</div>
            {CHECKLIST_ITEMS.map((item) => (
              <label key={item} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={!!check[item]}
                  onCheckedChange={(v) => setCheck(s => ({ ...s, [item]: v === true }))}
                  className="mt-0.5"
                />
                <span>{item}</span>
              </label>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={damageNoted} onCheckedChange={(v) => setDamageNoted(v === true)} />
            <span>New damage observed</span>
          </label>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything dispatch should know" />
          </div>

          <Button className="w-full" onClick={onSubmit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit inspection"}
          </Button>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-center text-lg font-semibold">Camauto Vehicle Inspection</h1>
        {children}
      </div>
    </div>
  );
}