import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2, MinusCircle, AlertTriangle, ClipboardList, Printer, BadgeCheck,
  Phone, MapPin, ChevronDown, X, ThumbsUp, ThumbsDown, Wrench, Check,
} from "lucide-react";
import {
  listRunnerTasks, getRunnerTaskReport, markRunnerTaskReviewed, getRunnerHistory,
  approveRmTask, rejectRmTask,
  type RunnerTaskReport,
} from "@/lib/runner-tasks-admin.functions";

export const Route = createFileRoute("/admin/tasks")({
  head: () => ({ meta: [{ title: "Runner Tasks — Camauto Rentals" }] }),
  component: TasksPage,
});

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString("en-US") : "—";
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    submitted: { label: "Submitted", variant: "default" },
    sent: { label: "Sent", variant: "secondary" },
    approved: { label: "Approved", variant: "default" },
    rejected: { label: "Rejected", variant: "destructive" },
    cancelled: { label: "Cancelled", variant: "destructive" },
    archived: { label: "Archived", variant: "outline" },
  };
  const m = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function TasksPage() {
  return (
    <div>
      <PageHeader title="Runner Tasks" subtitle="Submitted reports and runner performance" />
      <Tabs defaultValue="tasks">
        <TabsList className="mb-4">
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="history">Runner History</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks"><TasksList /></TabsContent>
        <TabsContent value="history"><RunnerHistory /></TabsContent>
      </Tabs>
    </div>
  );
}

function TasksList() {
  const fetchTasks = useServerFn(listRunnerTasks);
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["runner-tasks"],
    queryFn: () => fetchTasks(),
  });
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading tasks…</div>;
  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <ClipboardList className="h-8 w-8" />
          <div>No runner tasks yet.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((t) => (
        <Card key={t.id}>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t.title}</span>
                {statusBadge(t.status)}
                {t.reviewedAt && (
                  <Badge variant="outline" className="gap-1 text-success">
                    <BadgeCheck className="h-3 w-3" /> Reviewed
                  </Badge>
                )}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {t.runnerName ?? "—"} · {t.runnerPhone ?? "—"}
                {t.vehicleLabel ? ` · ${t.vehicleLabel}` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                {t.submittedAt ? `Submitted ${fmt(t.submittedAt)}` : `Sent ${fmt(t.sentAt)}`}
              </div>
            </div>
            <Button
              size="sm"
              variant={t.status === "submitted" ? "default" : "outline"}
              disabled={t.status !== "submitted"}
              onClick={() => setOpenId(t.id)}
            >
              View Full Report
            </Button>
          </CardContent>
        </Card>
      ))}
      <ReportDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function ReportDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const fetchReport = useServerFn(getRunnerTaskReport);
  const markReviewed = useServerFn(markRunnerTaskReviewed);
  const qc = useQueryClient();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const { data: report, isLoading } = useQuery({
    queryKey: ["runner-task-report", id],
    queryFn: () => fetchReport({ data: { id: id! } }),
    enabled: !!id,
  });

  const reviewMut = useMutation({
    mutationFn: () => markReviewed({ data: { id: id! } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runner-task-report", id] });
      qc.invalidateQueries({ queryKey: ["runner-tasks"] });
    },
  });

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto print:max-w-none print:overflow-visible">
        <DialogHeader>
          <DialogTitle>Task Report</DialogTitle>
        </DialogHeader>
        {isLoading || !report ? (
          <div className="py-8 text-center text-muted-foreground">Loading report…</div>
        ) : (
          <ReportBody report={report} onPhoto={setLightbox} />
        )}
        <DialogFooter className="gap-2 print:hidden">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" /> Print Report
          </Button>
          {report && !report.reviewedAt && (
            <Button onClick={() => reviewMut.mutate()} disabled={reviewMut.isPending}>
              <BadgeCheck className="mr-1 h-4 w-4" /> Mark Reviewed
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white"
            onClick={() => setLightbox(null)}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <img src={lightbox} alt="Task photo" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </Dialog>
  );
}

function ReportBody({ report, onPhoto }: { report: RunnerTaskReport; onPhoto: (url: string) => void }) {
  return (
    <div className="space-y-5 text-sm">
      <section className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <h3 className="col-span-full text-base font-semibold">{report.title}</h3>
        <Field label="Runner" value={`${report.runnerName ?? "—"} · ${report.runnerPhone ?? "—"}`} />
        {report.vehicleLabel && <Field label="Vehicle" value={report.vehicleLabel} />}
        {report.customerName && (
          <Field label="Customer" value={`${report.customerName}${report.customerPhone ? ` · ${report.customerPhone}` : ""}`} />
        )}
        {report.location && <Field label="Location" value={report.location} />}
        <Field label="Scheduled" value={fmt(report.scheduledAt)} />
        <Field label="Submitted" value={fmt(report.submittedAt)} />
      </section>

      {report.instructions && (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Instructions</h4>
          <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{report.instructions}</p>
        </section>
      )}

      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Checklist Results</h4>
        <div className="space-y-2">
          {report.checklistResults.length === 0 && (
            <div className="text-muted-foreground">No checklist items.</div>
          )}
          {report.checklistResults.map((r, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md border p-2">
              <ChecklistIcon status={r.status} />
              <div className="min-w-0">
                <div className="font-medium">{r.item}</div>
                {r.notes && <div className="text-xs text-muted-foreground">{r.notes}</div>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          Photos · {report.photoUrls.length} submitted
        </h4>
        {report.photoUrls.length === 0 ? (
          <div className="text-muted-foreground">No photos submitted.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {report.photoUrls.map((url, i) => (
              <button key={i} onClick={() => onPhoto(url)} className="overflow-hidden rounded-md border">
                <img src={url} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </section>

      {report.runnerNotes && (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Runner Notes</h4>
          <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{report.runnerNotes}</p>
        </section>
      )}
    </div>
  );
}

function ChecklistIcon({ status }: { status: string }) {
  if (status === "done" || status === "pass")
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />;
  if (status === "issue" || status === "fail")
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
  return <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs uppercase text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

function RunnerHistory() {
  const fetchHistory = useServerFn(getRunnerHistory);
  const { data: runners = [], isLoading } = useQuery({
    queryKey: ["runner-history"],
    queryFn: () => fetchHistory(),
  });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading history…</div>;
  if (runners.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <ClipboardList className="h-8 w-8" />
          <div>No runner history yet.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {runners.map((r) => (
        <Collapsible key={r.phone} asChild>
          <Card>
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between gap-3 p-4 text-left">
                <div className="min-w-0">
                  <div className="font-semibold">{r.name}</div>
                  <a
                    href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <Phone className="h-3 w-3" /> {r.phone}
                  </a>
                </div>
                <div className="flex items-center gap-3 text-right text-sm">
                  <div>
                    <div className="font-semibold">{r.completedTasks}/{r.totalTasks}</div>
                    <div className="text-xs text-muted-foreground">completed</div>
                  </div>
                  <div className="hidden sm:block">
                    <div className="font-semibold">
                      {r.avgCompletionMinutes != null ? formatDuration(r.avgCompletionMinutes) : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">avg time</div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-2 border-t px-4 py-3">
                {r.tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{t.title}</div>
                      {t.location && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" /> {t.location}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {statusBadge(t.status)}
                      <span className="text-xs text-muted-foreground">
                        {fmt(t.submittedAt ?? t.sentAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ))}
    </div>
  );
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}