import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { startTask } from "@/lib/tasks.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, MapPin, CheckCircle2, ClipboardList, Wrench, Car, AlertOctagon, Phone, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/my-tasks/$taskId")({
  head: () => ({ meta: [{ title: "Task Detail — Camauto Runner Hub" }] }),
  component: TaskDetailPage,
});

type TaskRow = {
  id: string; task_type: string; status: string; priority_level: string;
  description: string | null; address: string | null; due_date: string | null;
  year: number | null; make: string | null; model: string | null; plate: string | null;
  completed_at: string | null; runner_notes: string | null; created_at: string;
  task_mode: string | null; linked_rental_id: string | null; linked_vehicle_id: string | null;
};

type WorkflowKey = "dmv" | "return" | "mechanic_run" | "repo" | "vendor" | "other";

const WORKFLOWS: Record<WorkflowKey, { label: string; icon: typeof ClipboardList }> = {
  dmv:          { label: "DMV",           icon: ClipboardList },
  return:       { label: "Vehicle Return", icon: Car },
  mechanic_run: { label: "Mechanic Run",  icon: Wrench },
  repo:         { label: "Repossession",  icon: AlertOctagon },
  vendor:       { label: "Vendor Contact", icon: Phone },
  other:        { label: "Other",         icon: MoreHorizontal },
};

function inferWorkflow(t: TaskRow): WorkflowKey {
  if (t.task_mode === "return") return "return";
  switch (t.task_type) {
    case "dmv": return "dmv";
    case "mechanic_run": return "mechanic_run";
    case "repo": return "repo";
    case "dropoff": return "return";
    case "parts": return "vendor";
    case "pickup":
    case "inspection":
    case "other":
    default: return "other";
  }
}

export default function TaskDetailPage() {
  const { taskId } = Route.useParams();
  const navigate = useNavigate();
  const doStart = useServerFn(startTask);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<WorkflowKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("tasks")
        .select("id, task_type, status, priority_level, description, address, due_date, year, make, model, plate, completed_at, runner_notes, created_at, task_mode, linked_rental_id, linked_vehicle_id")
        .eq("id", taskId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      else if (!data) setError("Task not found or not assigned to you.");
      else setTask(data as TaskRow);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  function openWorkflow(key: WorkflowKey, t: TaskRow) {
    switch (key) {
      case "dmv":
        navigate({ to: "/dmv-task", search: { task_id: t.id } });
        return;
      case "return":
        navigate({
          to: "/checklist",
          search: { task_id: t.id, mode: "return", rental_id: t.linked_rental_id ?? undefined },
        });
        return;
      case "mechanic_run":
        navigate({ to: "/mechanic-task" });
        return;
      case "repo":
      case "vendor":
      case "other":
      default:
        navigate({ to: "/checklist", search: { task_id: t.id } });
        return;
    }
  }

  async function startAndOpen(key: WorkflowKey, t: TaskRow) {
    if (t.status === "pending") {
      try { await doStart({ data: { task_id: t.id } }); }
      catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not start task");
        return;
      }
    }
    openWorkflow(key, t);
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl pb-24"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }
  if (error || !task) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-24">
        <Link to="/my-tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to tasks
        </Link>
        <Card><CardContent className="py-10 text-center text-sm text-destructive">{error ?? "Task not found"}</CardContent></Card>
      </div>
    );
  }

  const matched = inferWorkflow(task);
  const matchedLabel = WORKFLOWS[matched].label;
  const MatchedIcon = WORKFLOWS[matched].icon;
  const overdue = task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== "completed";
  const secondary = (Object.keys(WORKFLOWS) as WorkflowKey[]).filter((k) => k !== matched);

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24">
      <Link to="/my-tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to tasks
      </Link>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-sm">{matchedLabel}</Badge>
            {task.priority_level === "urgent" && <Badge variant="destructive">🚨 Urgent</Badge>}
            {task.priority_level === "flexible" && <Badge variant="secondary">🕐 Flexible</Badge>}
            {task.status === "in_progress" && <Badge>In progress</Badge>}
            {task.status === "completed" && (
              <Badge className="bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" /> Completed</Badge>
            )}
          </div>

          {task.year && (
            <p className="text-lg font-semibold">
              {task.year} {task.make} {task.model}{task.plate ? ` — ${task.plate}` : ""}
            </p>
          )}
          {task.description && <p className="text-sm">{task.description}</p>}
          {task.address && (
            <a
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              href={`https://maps.google.com/?q=${encodeURIComponent(task.address)}`}
              target="_blank" rel="noopener noreferrer"
            >
              <MapPin className="h-3 w-3" /> {task.address}
            </a>
          )}
          <div className="grid gap-1 text-xs text-muted-foreground">
            <p>Assigned {new Date(task.created_at).toLocaleString()}</p>
            {task.due_date && (
              <p className={overdue ? "font-semibold text-destructive" : undefined}>
                Due {task.due_date}{overdue ? " (overdue)" : ""}
              </p>
            )}
            {task.completed_at && <p>Completed {new Date(task.completed_at).toLocaleString()}</p>}
          </div>
          {task.runner_notes && (
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Notes</p>
              <p className="whitespace-pre-wrap">{task.runner_notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {task.status !== "completed" && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Suggested workflow
              </p>
              <Button
                size="lg"
                className="h-14 w-full text-base"
                onClick={() => startAndOpen(matched, task)}
              >
                <MatchedIcon className="mr-2 h-5 w-5" />
                Start {matchedLabel}
              </Button>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Switch to:
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {secondary.map((k) => {
                  const Icon = WORKFLOWS[k].icon;
                  return (
                    <Button
                      key={k}
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingSwitch(k)}
                    >
                      <Icon className="mr-1.5 h-4 w-4" />
                      {WORKFLOWS[k].label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={pendingSwitch !== null} onOpenChange={(o) => { if (!o) setPendingSwitch(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              Switching from <b>{matchedLabel}</b> to <b>{pendingSwitch ? WORKFLOWS[pendingSwitch].label : ""}</b>?
              The task's recorded type won't change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const k = pendingSwitch;
                setPendingSwitch(null);
                if (k) startAndOpen(k, task);
              }}
            >
              Yes, switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}