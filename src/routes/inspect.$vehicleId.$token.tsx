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
import { CheckCircle2, ClipboardCheck, AlertTriangle, Wrench } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inspect/$vehicleId/$token")({
  head: () => ({ meta: [{ title: "Vehicle Inspection — Camauto Rentals" }] }),
  component: InspectPage,
});

const INSPECTION_ITEMS = [
  { key: "tires", label: "Tires" },
  { key: "fluids", label: "Fluids" },
  { key: "brakes", label: "Brakes" },
  { key: "lights", label: "Lights" },
  { key: "body", label: "Body" },
  { key: "interior", label: "Interior" },
] as const;
type ItemKey = typeof INSPECTION_ITEMS[number]["key"];
type ItemState = { status: "pass" | "fail" | null; notes: string };

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
  const [done, setDone] = useState<null | { failedItems: string[]; maintenanceCreated: boolean }>(null);

  const [mileage, setMileage] = useState<number>(0);
  const [fuelLevel, setFuelLevel] = useState<number>(100);
  const [damageNoted, setDamageNoted] = useState(false);
  const [inspectorName, setInspectorName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Record<ItemKey, ItemState>>(() =>
    INSPECTION_ITEMS.reduce((acc, i) => { acc[i.key] = { status: null, notes: "" }; return acc; }, {} as Record<ItemKey, ItemState>)
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("runner_name") : "";
    if (saved) setInspectorName(saved);
  }, []);

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
    const name = inspectorName.trim();
    if (!name) { toast.error("Please enter your name"); return; }
    const missing = INSPECTION_ITEMS.filter(i => !items[i.key].status);
    if (missing.length > 0) {
      toast.error("Mark every item Pass or Fail", { description: `${missing.length} remaining` });
      return;
    }
    const failMissingNotes = INSPECTION_ITEMS.filter(i => items[i.key].status === "fail" && !items[i.key].notes.trim());
    if (failMissingNotes.length > 0) {
      toast.error("Add notes for every failed item", { description: failMissingNotes.map(i => i.label).join(", ") });
      return;
    }
    if (typeof window !== "undefined") localStorage.setItem("runner_name", name);
    setSubmitting(true);
    try {
      const itemsPayload = INSPECTION_ITEMS.reduce((acc, i) => {
        acc[i.key] = { status: items[i.key].status as "pass" | "fail", notes: items[i.key].notes.trim() || undefined };
        return acc;
      }, {} as Record<ItemKey, { status: "pass" | "fail"; notes?: string }>);
      const checklistFlat = INSPECTION_ITEMS.reduce<Record<string, boolean>>((acc, i) => {
        acc[i.label] = items[i.key].status === "pass"; return acc;
      }, {});
      const res = await submitFn({ data: {
        vehicleId,
        token,
        mileage: Number(mileage) || 0,
        fuelLevel: Number(fuelLevel) || 0,
        damageNoted,
        completedBy: name,
        inspectorName: name,
        notes: notes.trim() || undefined,
        checklist: checklistFlat,
        items: itemsPayload,
      }});
      setDone({ failedItems: res.failedItems || [], maintenanceCreated: !!res.maintenanceCreated });
      if (res.mileageWarning) toast.warning(res.mileageWarning);
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
          <CardContent className="py-8 text-center space-y-4">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <p className="text-lg font-semibold">Inspection submitted</p>
            {done.failedItems.length > 0 ? (
              <div className="space-y-3 text-left">
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                  <div className="text-sm font-medium text-destructive">Failed items</div>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {done.failedItems.map((i) => <li key={i}>{i}</li>)}
                  </ul>
                </div>
                {done.maintenanceCreated && (
                  <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                    <Wrench className="mt-0.5 h-4 w-4 text-primary" />
                    <span>A maintenance ticket was auto-created and the vehicle is flagged for follow-up.</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">All items passed. Vehicle returned to the available pool.</p>
            )}
            <p className="text-xs text-muted-foreground">You can close this page.</p>
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
              <Input id="mi" inputMode="numeric" type="number" placeholder="Enter mileage" value={mileage || ""} onChange={(e) => setMileage(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="fuel">Fuel level (%)</Label>
              <Input id="fuel" inputMode="numeric" type="number" min={0} max={100} value={fuelLevel} onChange={(e) => setFuelLevel(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label htmlFor="by">Inspector name</Label>
            <Input id="by" value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} placeholder="Your name" />
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium">Inspection checklist</div>
            {INSPECTION_ITEMS.map((item) => {
              const state = items[item.key];
              return (
                <div key={item.key} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{item.label}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setItems(s => ({ ...s, [item.key]: { ...s[item.key], status: "pass" } }))}
                      className={cn(
                        "h-12 rounded-md border text-sm font-medium transition",
                        state.status === "pass"
                          ? "border-success bg-success text-success-foreground"
                          : "bg-background hover:bg-muted"
                      )}
                    >Pass</button>
                    <button
                      type="button"
                      onClick={() => setItems(s => ({ ...s, [item.key]: { ...s[item.key], status: "fail" } }))}
                      className={cn(
                        "h-12 rounded-md border text-sm font-medium transition",
                        state.status === "fail"
                          ? "border-destructive bg-destructive text-destructive-foreground"
                          : "bg-background hover:bg-muted"
                      )}
                    >Fail</button>
                  </div>
                  {state.status === "fail" && (
                    <Textarea
                      rows={2}
                      placeholder="What's wrong? (required)"
                      value={state.notes}
                      onChange={(e) => setItems(s => ({ ...s, [item.key]: { ...s[item.key], notes: e.target.value } }))}
                    />
                  )}
                </div>
              );
            })}
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