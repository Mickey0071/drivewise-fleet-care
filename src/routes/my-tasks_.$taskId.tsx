import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { startTask } from "@/lib/tasks.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ClipboardList, Wrench, Car, AlertOctagon, Phone, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/my-tasks_/$taskId")({
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
  const allKeys = Object.keys(WORKFLOWS) as WorkflowKey[];

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-24">
      <Link to="/my-tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to tasks
      </Link>

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Choose a workflow
        </p>
        {task.year && (
          <p className="text-sm text-muted-foreground">
            {task.year} {task.make} {task.model}{task.plate ? ` — ${task.plate}` : ""}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {allKeys.map((k) => {
          const Icon = WORKFLOWS[k].icon;
          const isMatched = k === matched;
          return (
            <Button
              key={k}
              variant={isMatched ? "default" : "outline"}
              className="h-24 flex-col gap-2 text-sm"
              onClick={() => startAndOpen(k, task)}
              disabled={task.status === "completed"}
            >
              <Icon className="h-6 w-6" />
              {WORKFLOWS[k].label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}