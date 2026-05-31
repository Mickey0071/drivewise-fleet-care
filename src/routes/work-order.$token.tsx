import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getWorkOrderFieldPublic, submitWorkOrderField } from "@/lib/work-order-field.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SignaturePad } from "@/components/app/SignaturePad";
import { renderFieldFormPdf, type FieldFormData } from "@/lib/work-order-field-form";
import { DEFAULT_SETTINGS } from "@/lib/agreementSettings";
import { CheckCircle2, Printer, Loader2, Wrench } from "lucide-react";
import { toast } from "sonner";
import logoUrl from "@/assets/camauto-logo-full.jpeg";

export const Route = createFileRoute("/work-order/$token")({
  head: () => ({ meta: [{ title: "Work Order — Camauto Rentals" }] }),
  component: FieldWorkOrderPage,
});

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s + (s.length === 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return s; }
}
const money = (n: number) => `$${(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

type Result = Awaited<ReturnType<typeof getWorkOrderFieldPublic>>;

function FieldWorkOrderPage() {
  const { token } = Route.useParams();
  const fetchFn = useServerFn(getWorkOrderFieldPublic);
  const submitFn = useServerFn(submitWorkOrderField);

  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [mechanicName, setMechanicName] = useState("");
  const [completedDate, setCompletedDate] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [partsUsed, setPartsUsed] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchFn({ data: { token } });
        if (cancelled) return;
        setData(r);
        if (r.found) {
          setMechanicName(r.workOrder.assignedTo ?? "");
          setCompletedDate(r.workOrder.completedDate ?? "");
          setActualCost(r.workOrder.actualCost != null ? String(r.workOrder.actualCost) : "");
          setPartsUsed(r.workOrder.partsUsed ?? "");
          setCompletionNotes(r.workOrder.completionNotes ?? "");
          if (r.workOrder.fieldSubmittedAt) setDone(true);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load work order");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, fetchFn]);

  const pdfData: FieldFormData | null = useMemo(() => {
    if (!data || !data.found) return null;
    const w = data.workOrder;
    return {
      workOrderNumber: w.id,
      vehicle: data.vehicle,
      serviceType: w.serviceType,
      description: w.description,
      scheduledDate: fmtDate(w.scheduledDate),
      assignedTo: w.assignedTo,
      estimatedCost: money(w.estimatedCost),
      settings: DEFAULT_SETTINGS,
    };
  }, [data]);

  async function printBlank() {
    if (!pdfData) return;
    try {
      const blob = await renderFieldFormPdf(pdfData);
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (w) w.addEventListener("load", () => setTimeout(() => w.print(), 400));
      else toast.error("Pop-up blocked", { description: "Allow pop-ups to print." });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) {
      toast.error("Could not open print view", { description: e?.message ?? "Try again" });
    }
  }

  async function onSubmit() {
    if (!data || !data.found) return;
    if (!mechanicName.trim()) { toast.error("Please enter your full name"); return; }
    if (!sig) { toast.error("Please sign before submitting"); return; }
    setSubmitting(true);
    try {
      await submitFn({
        data: {
          token,
          mechanicName: mechanicName.trim(),
          completedDate: completedDate || undefined,
          actualCost: actualCost ? Number(actualCost) : null,
          partsUsed,
          completionNotes,
          mechanicSignature: sig,
        },
      });
      setDone(true);
      toast.success("Work order submitted");
    } catch (e: any) {
      toast.error("Could not submit", { description: e?.message ?? "Try again" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-6">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-5 flex flex-col items-center text-center">
          <img src={logoUrl} alt="Camauto Rentals" className="h-14 w-auto" />
          <h1 className="mt-3 flex items-center gap-2 text-lg font-bold">
            <Wrench className="h-5 w-5 text-primary" /> Maintenance Work Order
          </h1>
        </div>

        {loading && (
          <Card className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </Card>
        )}

        {!loading && (err || !data?.found) && (
          <Card className="p-6 text-center">
            <p className="font-medium">This work order link is invalid or expired.</p>
            <p className="mt-1 text-sm text-muted-foreground">{err ?? "Please request a new link from the office."}</p>
          </Card>
        )}

        {!loading && data?.found && (
          <div className="space-y-4">
            <Card className="space-y-2 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{data.workOrder.id}</span>
                <Badge variant="outline" className="uppercase">{data.workOrder.priority}</Badge>
              </div>
              <Detail label="Vehicle" value={`${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`} />
              <Detail label="Tag / Plate" value={data.vehicle.plate || "—"} />
              <Detail label="Service" value={data.workOrder.serviceType} />
              <Detail label="Scheduled" value={fmtDate(data.workOrder.scheduledDate)} />
              <Detail label="Est. cost" value={money(data.workOrder.estimatedCost)} />
              {data.workOrder.description && <Detail label="Details" value={data.workOrder.description} />}
            </Card>

            <Button variant="outline" className="w-full" onClick={printBlank}>
              <Printer className="mr-2 h-4 w-4" /> Print form to fill by hand
            </Button>

            {done ? (
              <Card className="flex flex-col items-center gap-2 p-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <p className="font-semibold">Submission received</p>
                <p className="text-sm text-muted-foreground">The office has your completed work order. You can close this page.</p>
              </Card>
            ) : (
              <Card className="space-y-4 p-4">
                <h2 className="text-sm font-semibold">Complete digitally</h2>
                <div className="grid gap-1.5">
                  <Label>Your name</Label>
                  <Input value={mechanicName} onChange={e => setMechanicName(e.target.value)} placeholder="Mechanic full name" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Completed on</Label>
                    <Input type="date" value={completedDate} onChange={e => setCompletedDate(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Actual cost ($)</Label>
                    <Input type="number" min={0} step="0.01" value={actualCost} onChange={e => setActualCost(e.target.value)} />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label>Parts used</Label>
                  <Textarea rows={2} value={partsUsed} onChange={e => setPartsUsed(e.target.value)} placeholder="What was installed" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Notes</Label>
                  <Textarea rows={2} value={completionNotes} onChange={e => setCompletionNotes(e.target.value)} placeholder="Condition / issues found" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Signature</Label>
                  <SignaturePad value={sig ?? undefined} onChange={setSig} height={140} />
                </div>
                <Button className="w-full" onClick={onSubmit} disabled={submitting}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Submit work order
                </Button>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}