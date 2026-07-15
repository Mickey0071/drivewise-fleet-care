import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getMechanicJobPublic,
  submitMechanicJob,
  type ChecklistItem,
  type PartItem,
} from "@/lib/mechanic-jobs.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, Wrench, Plus, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/mechanic-job/$token")({
  head: () => ({ meta: [{ title: "Vehicle Diagnosis — Camauto Rentals" }] }),
  component: MechanicJobPage,
});

const money = (n: number) => `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Result = Awaited<ReturnType<typeof getMechanicJobPublic>>;
type ResultState = "pass" | "fail" | "na" | "";

function MechanicJobPage() {
  const { token } = Route.useParams();
  const fetchFn = useServerFn(getMechanicJobPublic);
  const submitFn = useServerFn(submitMechanicJob);

  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [results, setResults] = useState<Record<string, { result: ResultState; notes: string }>>({});
  const [parts, setParts] = useState<PartItem[]>([{ name: "", qty: 1, price: 0, labor: 0 }]);
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [recommendations, setRecommendations] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchFn({ data: { token } });
        if (cancelled) return;
        setData(r);
        if (r.found && r.job.status === "submitted") setDone(true);
      } catch {
        if (!cancelled) setData({ found: false });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, fetchFn]);

  const items: ChecklistItem[] = data?.found ? data.job.checklistItems : [];
  const partsTotal = useMemo(
    () => parts.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.qty) || 1), 0),
    [parts],
  );
  const laborTotal = useMemo(() => parts.reduce((s, p) => s + (Number(p.labor) || 0), 0), [parts]);

  function setItem(id: string, patch: Partial<{ result: ResultState; notes: string }>) {
    setResults((prev) => {
      const base = prev[id] ?? { result: "" as ResultState, notes: "" };
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }
  function addPart() { setParts((p) => [...p, { name: "", qty: 1, price: 0, labor: 0 }]); }
  function removePart(i: number) { setParts((p) => p.filter((_, idx) => idx !== i)); }
  function setPart(i: number, patch: Partial<PartItem>) {
    setParts((p) => p.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function handleSubmit() {
    const cleanParts = parts
      .filter((p) => p.name.trim() && (Number(p.price) || 0) >= 0)
      .map((p) => ({
        name: p.name.trim(),
        qty: Math.max(1, Math.floor(Number(p.qty) || 1)),
        price: Number(p.price) || 0,
        labor: Number(p.labor) || 0,
      }));
    const pTotal = cleanParts.reduce((s, p) => s + p.price * (p.qty || 1), 0);
    const lTotal = cleanParts.reduce((s, p) => s + (p.labor || 0), 0);
    if (items.length > 0) {
      const completedAny = items.some((it) => {
        const r = results[it.id];
        return r && (r.result === "pass" || r.result === "fail" || (r.notes ?? "").trim());
      });
      if (!completedAny) { toast.error("Mark at least one checklist item"); return; }
    }
    if (!(pTotal > 0) && !(lTotal > 0)) { toast.error("Add parts or a labour estimate"); return; }
    setSubmitting(true);
    try {
      await submitFn({
        data: {
          token,
          checklistResults: items.map((it) => ({
            id: it.id,
            label: it.label,
            result: (results[it.id]?.result || "na") as "pass" | "fail" | "na",
            notes: results[it.id]?.notes ?? "",
          })),
          partsList: cleanParts,
          labourCost: 0,
          estimatedHours: hours ? parseFloat(hours) : null,
          mechanicNotes: notes,
          mechanicRecommendations: recommendations,
        },
      });
      setDone(true);
    } catch (e: any) {
      toast.error(e?.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.found || (data.found && data.job.status === "cancelled")) {
    return (
      <Centered>
        <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="mt-4 text-lg font-semibold">Link expired or invalid</h1>
        <p className="mt-1 text-sm text-muted-foreground">This diagnosis request is no longer available.</p>
      </Centered>
    );
  }

  if (done) {
    return (
      <Centered>
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
        <h1 className="mt-4 text-lg font-semibold">Diagnosis submitted</h1>
        <p className="mt-1 text-sm text-muted-foreground">Thanks! Your findings have been sent to Camauto Rentals.</p>
      </Centered>
    );
  }

  const v = data.vehicle;
  const job = data.job;

  return (
    <div className="min-h-screen bg-muted/30 py-6">
      <div className="mx-auto w-full max-w-xl space-y-4 px-4">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Vehicle Diagnosis Request</h1>
            <p className="text-xs text-muted-foreground">Complete checklist and report findings</p>
          </div>
        </div>

        <Card className="space-y-1 p-4 text-sm">
          <div className="font-medium">{`${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || "Vehicle"}</div>
          {v.plate ? <div className="text-xs text-muted-foreground">Plate: {v.plate}</div> : null}
          {job.issueDescription ? (
            <div className="pt-2"><span className="font-medium">Issue reported:</span> {job.issueDescription}</div>
          ) : null}
          {job.additionalContext ? (
            <div><span className="font-medium">Customer notes:</span> {job.additionalContext}</div>
          ) : null}
        </Card>

        {items.length > 0 ? (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Inspection Checklist</h2>
          <div className="space-y-3">
            {items.map((it) => {
              const r = results[it.id] ?? { result: "", notes: "" };
              return (
                <div key={it.id} className="rounded-md border p-3">
                  <div className="text-sm font-medium">{it.label}</div>
                  <div className="mt-2 flex gap-2">
                    {(["pass", "fail", "na"] as const).map((opt) => (
                      <Button
                        key={opt}
                        type="button"
                        size="sm"
                        variant={r.result === opt ? "default" : "outline"}
                        className="h-7 flex-1 text-xs capitalize"
                        onClick={() => setItem(it.id, { result: opt })}
                      >
                        {opt === "na" ? "N/A" : opt}
                      </Button>
                    ))}
                  </div>
                  <Input
                    className="mt-2 h-8 text-xs"
                    placeholder="Notes (optional)"
                    value={r.notes}
                    onChange={(e) => setItem(it.id, { notes: e.target.value })}
                  />
                </div>
              );
            })}
          </div>
        </Card>
        ) : null}

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Parts Needed</h2>
            <Badge variant="secondary" className="text-xs">Total {money(partsTotal + laborTotal)}</Badge>
          </div>
          <div className="space-y-3">
            {parts.map((p, i) => (
              <div key={i} className="rounded-lg border p-2.5">
                <div className="flex items-center gap-2">
                  <Input className="h-9 flex-1 text-sm" placeholder="Part name (e.g. Drive shaft)"
                    value={p.name} onChange={(e) => setPart(i, { name: e.target.value })} />
                  <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => removePart(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  <div>
                    <label className="mb-0.5 block text-[10px] font-medium uppercase text-muted-foreground">Qty</label>
                    <Input className="h-9 text-right text-sm" type="number" inputMode="numeric" min="1" step="1" placeholder="1"
                      value={p.qty ? String(p.qty) : ""} onChange={(e) => setPart(i, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-medium uppercase text-muted-foreground">Part $</label>
                    <Input className="h-9 text-right text-sm" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0"
                      value={p.price ? String(p.price) : ""} onChange={(e) => setPart(i, { price: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-medium uppercase text-muted-foreground">Labor $</label>
                    <Input className="h-9 text-right text-sm" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0"
                      value={p.labor ? String(p.labor) : ""} onChange={(e) => setPart(i, { labor: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-medium uppercase text-muted-foreground">Line total</label>
                    <div className="flex h-9 items-center justify-end text-sm font-medium tabular-nums">
                      {money((Number(p.price) || 0) * (Number(p.qty) || 1) + (Number(p.labor) || 0))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={addPart}>
            <Plus className="h-4 w-4" /> Add Part
          </Button>
          <div className="mt-3 space-y-1 border-t pt-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Parts total</span><span className="font-medium tabular-nums">{money(partsTotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Labor total</span><span className="font-medium tabular-nums">{money(laborTotal)}</span></div>
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Estimated Hours</h2>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-[11px]">Total estimated hours</Label>
              <Input className="mt-1 h-8" type="number" min="0" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
          </div>
        </Card>

        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">Diagnosis Summary</h2>
          <Textarea className="min-h-[80px] text-sm" placeholder="Diagnosis summary and recommendations"
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Card>

        <div className="flex justify-between rounded-md bg-background px-3 py-2 text-sm font-medium shadow-sm">
          <span>Total estimate</span>
          <span>{money(partsTotal + laborTotal)}</span>
        </div>

        <Button className="w-full" disabled={submitting} onClick={handleSubmit}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Diagnosis"}
        </Button>
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-sm p-8 text-center">{children}</Card>
    </div>
  );
}