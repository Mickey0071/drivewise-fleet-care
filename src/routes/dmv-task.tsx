import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { completeDmvTask } from "@/lib/tasks.functions";

export const Route = createFileRoute("/dmv-task")({
  head: () => ({ meta: [{ title: "DMV Run — Camauto Rentals" }] }),
  validateSearch: (s: Record<string, unknown>) =>
    z.object({ task_id: z.string() }).parse(s),
  component: DmvTaskPage,
});

const DMV_DOCS = [
  { key: "power_of_attorney", label: "Power of Attorney" },
  { key: "company_formation_docs", label: "Company Formation Docs" },
  { key: "license", label: "License" },
  { key: "title", label: "Title" },
  { key: "reassignment", label: "Reassignment" },
] as const;

function DmvTaskPage() {
  const navigate = useNavigate();
  const { task_id } = Route.useSearch();
  const doComplete = useServerFn(completeDmvTask);

  const [taskBanner, setTaskBanner] = useState<string | null>(null);
  const [vehicleLabel, setVehicleLabel] = useState<string>("");
  const [docs, setDocs] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tasks")
        .select("description, year, make, model, plate, address")
        .eq("id", task_id)
        .maybeSingle();
      if (cancelled || !data) return;
      setTaskBanner(data.description ?? `Task ${task_id}`);
      if (data.year) {
        setVehicleLabel(`${data.year} ${data.make ?? ""} ${data.model ?? ""} ${data.plate ?? ""}`.trim());
      }
    })();
    return () => { cancelled = true; };
  }, [task_id]);

  const toggle = (key: string) => setDocs((p) => ({ ...p, [key]: !p[key] }));

  const submit = async () => {
    setSubmitting(true);
    try {
      await doComplete({ data: { task_id, documents: docs, notes: notes.trim() } });
      toast.success("DMV task completed");
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to complete");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-24">
        <PageHeader title="✅ DMV Run Complete" subtitle="Task marked complete and admins notified" />
        <Button className="h-12 w-full" onClick={() => navigate({ to: "/my-tasks" })}>
          Back to My Tasks
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24">
      <PageHeader title="📋 DMV Run" subtitle="Paperwork only — no vehicle inspection needed" />

      {(taskBanner || vehicleLabel) && (
        <div className="rounded-md border border-blue-500/40 bg-blue-500/5 px-4 py-3 text-sm">
          {vehicleLabel && <div className="font-medium">{vehicleLabel}</div>}
          {taskBanner && <div className="text-blue-800/90 dark:text-blue-200/90">{taskBanner}</div>}
        </div>
      )}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div>
            <Label>Documents checklist <span className="text-xs font-normal text-muted-foreground">(optional)</span></Label>
            <p className="text-xs text-muted-foreground">Check off whichever paperwork you handled. None of these are required to complete the run.</p>
          </div>
          <div className="space-y-2">
            {DMV_DOCS.map((d) => (
              <label
                key={d.key}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background px-3 py-3 hover:bg-accent"
              >
                <Checkbox checked={!!docs[d.key]} onCheckedChange={() => toggle(d.key)} />
                <span className="text-sm font-medium">{d.label}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Anything to flag for the office?"
          />
        </CardContent>
      </Card>

      <Button className="h-12 w-full text-base font-semibold" disabled={submitting} onClick={submit}>
        {submitting ? "Submitting…" : "Mark DMV Run Complete"}
      </Button>
    </div>
  );
}