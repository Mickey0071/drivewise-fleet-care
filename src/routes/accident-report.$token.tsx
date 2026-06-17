import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAccidentIntake, submitAccidentReport } from "@/lib/accident.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/accident-report/$token")({
  head: () => ({ meta: [{ title: "Accident Report — Camauto Rentals" }] }),
  component: AccidentReportPage,
});

type Form = {
  occurredAt: string;
  location: string;
  description: string;
  fault: string;
  otherPartyName: string;
  otherPartyPhone: string;
  otherPartyInsurance: string;
  otherPartyPlate: string;
  injuries: string;
  policeReport: string;
};

const EMPTY: Form = {
  occurredAt: "", location: "", description: "", fault: "",
  otherPartyName: "", otherPartyPhone: "", otherPartyInsurance: "",
  otherPartyPlate: "", injuries: "", policeReport: "",
};

function AccidentReportPage() {
  const { token } = Route.useParams();
  const fetchIntake = useServerFn(getAccidentIntake);
  const submit = useServerFn(submitAccidentReport);
  const [form, setForm] = useState<Form>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["accident-intake", token],
    queryFn: () => fetchIntake({ data: { token } }),
  });

  useEffect(() => {
    if (data && "found" in data && data.found && data.report) {
      setForm({ ...EMPTY, ...(data.report as Partial<Form>) });
    }
  }, [data]);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.occurredAt) { toast.error("Date and time of the accident is required"); return; }
    setSubmitting(true);
    try {
      await submit({ data: { token, report: form } });
      setDone(true);
      toast.success("Accident report submitted. Thank you.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit report");
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return <Centered><p className="text-muted-foreground">Loading…</p></Centered>;
  }
  if (!data || !("found" in data) || !data.found) {
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>Link not valid</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            This accident report link is invalid or has expired. Please contact Camauto Rentals.
          </CardContent>
        </Card>
      </Centered>
    );
  }
  if (done) {
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>Report received ✅</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Thank you. Your accident report has been sent to Camauto Rentals. You can close this page.
          </CardContent>
        </Card>
      </Centered>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Accident Report</CardTitle>
          <p className="text-sm text-muted-foreground">
            {data.vehicle}{data.plate ? ` · ${data.plate}` : ""}{data.driverName ? ` · ${data.driverName}` : ""}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Date & time of accident" required>
              <Input type="datetime-local" value={form.occurredAt} onChange={e => set("occurredAt", e.target.value)} required />
            </Field>
            <Field label="Location of accident">
              <Input value={form.location} onChange={e => set("location", e.target.value)} placeholder="Street, city, intersection" />
            </Field>
            <Field label="What happened?">
              <Textarea className="min-h-[100px]" value={form.description} onChange={e => set("description", e.target.value)} placeholder="Describe the accident in detail" />
            </Field>
            <Field label="Who was at fault?">
              <Input value={form.fault} onChange={e => set("fault", e.target.value)} placeholder="e.g. other driver, me, unsure" />
            </Field>
            <Field label="Any injuries?">
              <Textarea className="min-h-[60px]" value={form.injuries} onChange={e => set("injuries", e.target.value)} placeholder="Describe any injuries, or 'none'" />
            </Field>
            <div className="rounded-md border p-3">
              <p className="mb-3 text-sm font-medium">Other party / vehicle</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><Input value={form.otherPartyName} onChange={e => set("otherPartyName", e.target.value)} /></Field>
                <Field label="Phone"><Input value={form.otherPartyPhone} onChange={e => set("otherPartyPhone", e.target.value)} /></Field>
                <Field label="Insurance company / policy #"><Input value={form.otherPartyInsurance} onChange={e => set("otherPartyInsurance", e.target.value)} /></Field>
                <Field label="License plate"><Input value={form.otherPartyPlate} onChange={e => set("otherPartyPlate", e.target.value)} /></Field>
              </div>
            </div>
            <Field label="Police report # (if any)">
              <Input value={form.policeReport} onChange={e => set("policeReport", e.target.value)} />
            </Field>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit accident report"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center px-4">{children}</div>;
}