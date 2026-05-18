import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { pushRunnerReportToGhl } from "@/lib/ghl.functions";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { staff, vehicles, rentals, drivers, fmtDate } from "@/lib/mock/data";
import { getInspectionsForRental, useStoreVersion, addRunnerReport } from "@/lib/mock/store";
import { CheckCircle2, Car, Wrench, Fuel, Camera, Send, ExternalLink } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/staff-portal")({
  head: () => ({ meta: [{ title: "Runner Portal — Camauto Rentals" }] }),
  component: RunnerPortalPage,
});

type Task = {
  id: string;
  label: string;
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
};

function RunnerPortalPage() {
  useStoreVersion();
  const me = staff.find(s => s.id === "S-02") ?? staff[0];
  const pushToGhl = useServerFn(pushRunnerReportToGhl);

  // Build today's runner checklist from real data
  const tasks = useMemo<Task[]>(() => {
    const list: Task[] = [];
    // Deliveries pending (rentals without check-out inspection)
    rentals.filter(r => !r.endDate && ((r.reservationStatus ?? "active") === "active" || r.reservationStatus === "pending")).forEach(r => {
      const insps = getInspectionsForRental(r.id);
      const delivered = insps.some(i => i.type === "check-out");
      if (!delivered) {
        const v = vehicles.find(x => x.id === r.vehicleId);
        const d = drivers.find(x => x.id === r.driverId);
        list.push({
          id: `deliver-${r.id}`,
          label: `Deliver ${v?.year} ${v?.make} ${v?.model} to ${d?.fullName}`,
          detail: `Plate ${v?.plate} · pickup ${fmtDate(r.startDate)}`,
          icon: Car,
        });
      }
    });
    // Vehicles in maintenance — pickup task
    vehicles.filter(v => v.status === "maintenance").forEach(v => {
      list.push({
        id: `pickup-${v.id}`,
        label: `Pick up ${v.year} ${v.make} ${v.model} from shop`,
        detail: `Plate ${v.plate}`,
        icon: Wrench,
      });
    });
    // Generic daily runner tasks
    list.push({ id: "fuel-lot", label: "Top off fuel on lot vehicles", detail: "Available units only", icon: Fuel });
    list.push({ id: "photos", label: "Photo walk-around on returns", detail: "Upload to inspection record", icon: Camera });
    return list;
  }, []);

  const [done, setDone] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const completed = tasks.filter(t => done[t.id]).length;
  const pct = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  const toggle = (id: string) => setDone(d => ({ ...d, [id]: !d[id] }));
  const reset = () => { setDone({}); setNotes(""); };

  const submit = () => {
    const report = addRunnerReport({
      runnerId: me.id,
      runnerName: me.fullName,
      totalTasks: tasks.length,
      completedTasks: completed,
      items: tasks.map(t => ({ id: t.id, label: t.label, detail: t.detail, done: !!done[t.id] })),
      notes: notes.trim() || undefined,
    });
    toast.success("Report submitted to admin", {
      description: `${completed}/${tasks.length} tasks · opening admin view`,
      action: { label: "Open", onClick: () => window.open("/runner-reports", "_blank") },
    });
    window.open(`/runner-reports?focus=${report.id}`, "_blank");
    // Fire-and-forget sync to GoHighLevel
    pushToGhl({
      data: {
        reportId: report.id,
        runnerName: me.fullName,
        runnerEmail: me.email,
        runnerPhone: me.phone,
        submittedAt: report.submittedAt,
        totalTasks: report.totalTasks,
        completedTasks: report.completedTasks,
        items: report.items,
        notes: report.notes,
      },
    })
      .then(() => toast.success("Synced to GoHighLevel"))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Unknown error";
        toast.error("GHL sync failed", { description: msg });
      });
    reset();
  };

  return (
    <div>
      <PageHeader title="Runner Checklist" subtitle={`${me.fullName} · ${fmtDate(new Date().toISOString())}`} />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="text-sm text-muted-foreground">Today's progress</div>
            <div className="text-2xl font-bold">{completed} / {tasks.length} tasks</div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={pct === 100 ? "default" : "secondary"}>{pct}%</Badge>
            <Button variant="outline" size="sm" onClick={reset}>Reset</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Runner duties</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {tasks.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">No tasks assigned today.</div>
          )}
          {tasks.map(t => {
            const Icon = t.icon;
            const isDone = !!done[t.id];
            return (
              <label
                key={t.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${isDone ? "bg-muted/40" : "hover:bg-muted/20"}`}
              >
                <Checkbox checked={isDone} onCheckedChange={() => toggle(t.id)} className="mt-1" />
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium ${isDone ? "text-muted-foreground line-through" : ""}`}>{t.label}</div>
                  {t.detail && <div className="text-xs text-muted-foreground">{t.detail}</div>}
                </div>
                {isDone && <CheckCircle2 className="h-4 w-4 text-success" />}
              </label>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Notes for admin (optional)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Anything the office should know — issues, delays, damage observed…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">Submitting sends a snapshot of this checklist to the admin Runner Reports page.</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => window.open("/runner-reports", "_blank")}>
                <ExternalLink className="mr-1 h-4 w-4" /> Admin view
              </Button>
              <Button size="sm" onClick={submit} disabled={tasks.length === 0}>
                <Send className="mr-1 h-4 w-4" /> Submit report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
