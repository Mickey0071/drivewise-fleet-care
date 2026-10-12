import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { CheckCircle2, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  listCompletedTaskAlerts, acknowledgeCompletedTask,
} from "@/lib/runner-tasks-admin.functions";
import { listMechanicJobs, type MechanicJobRow } from "@/lib/mechanic-jobs.functions";
import { vehicleById } from "@/lib/mock/data";

const ACK_KEY = "camauto:mechanic-job-acks";
const WINDOW_MS = 14 * 24 * 3600 * 1000;

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString("en-US") : "";
}

function readAcks(): string[] {
  try { return JSON.parse(localStorage.getItem(ACK_KEY) || "[]"); } catch { return []; }
}

export function CompletedTaskAlerts() {
  const fetchAlerts = useServerFn(listCompletedTaskAlerts);
  const ackFn = useServerFn(acknowledgeCompletedTask);
  const fetchJobs = useServerFn(listMechanicJobs);
  const qc = useQueryClient();
  const [acks, setAcks] = useState<string[]>([]);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => { setAcks(readAcks()); }, []);

  const { data: alerts = [] } = useQuery({
    queryKey: ["completed-task-alerts"],
    queryFn: () => fetchAlerts(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ["mechanic-job-alerts"],
    queryFn: async () => ((await fetchJobs()).jobs ?? []) as unknown as MechanicJobRow[],
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const mechAlerts = jobs.filter(
    (j) => j.status === "submitted" && j.submitted_at &&
      Date.now() - new Date(j.submitted_at).getTime() < WINDOW_MS && !acks.includes(j.id),
  );

  // Pop-up notice when a new completion arrives while the page is open.
  useEffect(() => {
    const ids = [...alerts.map((a) => a.id), ...mechAlerts.map((j) => j.id)];
    if (seen.current === null) { seen.current = new Set(ids); return; }
    for (const a of alerts) if (!seen.current.has(a.id)) toast.success(`Task complete: ${a.title} — ${a.runnerName ?? "Runner"}`);
    for (const j of mechAlerts) if (!seen.current.has(j.id)) toast.success(`Mechanic task complete: ${j.mechanic_name}`);
    seen.current = new Set(ids);
  }, [alerts, mechAlerts]);

  const ackMut = useMutation({
    mutationFn: (id: string) => ackFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["completed-task-alerts"] }),
  });

  function ackMech(id: string) {
    const next = [...acks, id].slice(-500);
    localStorage.setItem(ACK_KEY, JSON.stringify(next));
    setAcks(next);
  }

  if (alerts.length === 0 && mechAlerts.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {mechAlerts.map((j) => {
        const v = j.vehicle_id ? vehicleById(j.vehicle_id) : null;
        return (
          <div key={j.id} className="flex items-start justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
            <Link to="/admin/tasks" search={{ tab: "mechanic" } as any} className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                <Wrench className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold">Mechanic task complete: {j.issue_description || "Diagnosis"}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {j.mechanic_name}{v ? ` · ${v.year} ${v.make} ${v.model}` : ""} · {fmt(j.submitted_at)}
                </div>
              </div>
            </Link>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Dismiss" onClick={() => ackMech(j.id)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      {alerts.map((a) => (
        <div
          key={a.id}
          className="flex items-start justify-between gap-3 rounded-lg border border-green-600/40 bg-green-600/10 px-4 py-3"
        >
          <Link to="/admin/tasks" className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600/20 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-green-800 dark:text-green-300">
                Task complete: {a.title}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {a.runnerName ?? "Runner"}
                {a.vehicleLabel ? ` · ${a.vehicleLabel}` : ""}
                {a.completedAt ? ` · ${fmt(a.completedAt)}` : ""}
              </div>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Dismiss"
            disabled={ackMut.isPending}
            onClick={() => ackMut.mutate(a.id)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
