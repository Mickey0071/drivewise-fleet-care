import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { startTask } from "@/lib/tasks.functions";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
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

type WorkflowKey = "dmv" | "return" | "mechanic_run" | "parts" | "repo" | "transport" | "vendor" | "other";

function inferWorkflow(t: TaskRow): WorkflowKey {
  if (t.task_mode === "return") return "return";
  switch (t.task_type) {
    case "dmv": return "dmv";
    case "mechanic_run": return "mechanic_run";
    case "parts": return "parts";
    case "repo": return "repo";
    case "transport": return "transport";
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
  const [routed, setRouted] = useState(false);

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
        navigate({ to: "/dmv-run-task", search: { task_id: t.id } });
        return;
      case "return":
        navigate({
          to: "/checklist",
          search: { task_id: t.id, mode: "return", rental_id: t.linked_rental_id ?? undefined },
        });
        return;
      case "mechanic_run":
        navigate({ to: "/mechanic-run-task", search: { task_id: t.id } });
        return;
      case "parts":
        navigate({ to: "/parts-run-task", search: { task_id: t.id } });
        return;
      case "repo":
        navigate({ to: "/repo-task", search: { task_id: t.id } });
        return;
      case "transport":
        navigate({ to: "/transport-task", search: { task_id: t.id } });
        return;
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

  // Auto-route directly to the task-specific workflow as soon as the task loads.
  useEffect(() => {
    if (!task || routed) return;
    setRouted(true);
    void startAndOpen(inferWorkflow(task), task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, routed]);

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

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-24">
      <Link to="/my-tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to tasks
      </Link>
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {task.status === "completed" ? "This task is already completed." : "Opening task…"}
        </CardContent>
      </Card>
    </div>
  );
}