import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { startTask } from "@/lib/tasks.functions";
import { TASK_TYPE_OPTIONS } from "@/components/app/NewTaskDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPin, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/my-tasks")({
  head: () => ({ meta: [{ title: "My Tasks — Camauto Runner Hub" }] }),
  component: MyTasksPage,
});

type TaskRow = {
  id: string; task_type: string; status: string; priority_level: string;
  description: string | null; address: string | null; due_date: string | null;
  year: number | null; make: string | null; model: string | null; plate: string | null;
  completed_at: string | null; completed_inspection_id: string | null; runner_notes: string | null;
  created_at: string;
};

const TYPE_COLORS: Record<string, string> = {
  pickup: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  dropoff: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  dmv: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  repo: "bg-red-500/15 text-red-700 dark:text-red-300",
  mechanic_run: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  inspection: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  parts: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  other: "bg-gray-500/15 text-gray-700 dark:text-gray-300",
};

function MyTasksPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const doStart = useServerFn(startTask);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tab, setTab] = useState<"today" | "all" | "overdue" | "completed">("today");
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("tasks")
      .select("id, task_type, status, priority_level, description, address, due_date, year, make, model, plate, completed_at, completed_inspection_id, runner_notes, created_at")
      .eq("assigned_to_user_id", user.id)
      .order("due_date", { ascending: true });
    setTasks((data ?? []) as TaskRow[]);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = useMemo(() => tasks.filter(t => {
    if (tab === "all") return true;
    if (tab === "completed") return t.status === "completed";
    if (tab === "overdue") return t.status !== "completed" && t.due_date !== null && t.due_date < today;
    // today (default): today + overdue (non-completed)
    if (t.status === "completed") return false;
    return t.due_date === null || t.due_date <= today;
  }), [tasks, tab, today]);

  async function start(id: string) {
    try { await doStart({ data: { task_id: id } }); toast.success("Task started"); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-24">
      <h1 className="text-2xl font-semibold tracking-tight">My Tasks</h1>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="overdue">Overdue</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p>
      : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No tasks here.</CardContent></Card>
      ) : filtered.map(t => {
        const typeLabel = TASK_TYPE_OPTIONS.find(o => o.value === t.task_type)?.label ?? t.task_type;
        const overdue = t.due_date && t.due_date < today && t.status !== "completed";
        return (
          <Card key={t.id}>
            <CardContent className="space-y-2 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", TYPE_COLORS[t.task_type] ?? TYPE_COLORS.other)}>{typeLabel}</span>
                {t.priority_level === "urgent" && <Badge variant="destructive">🚨 Urgent</Badge>}
                {t.priority_level === "flexible" && <Badge variant="secondary">🕐 Flexible</Badge>}
                {t.status === "in_progress" && <Badge>In progress</Badge>}
                {t.status === "completed" && <Badge className="bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" /> Completed</Badge>}
              </div>
              {t.year && (
                <p className="font-semibold">{t.year} {t.make} {t.model}{t.plate ? ` — ${t.plate}` : ""}</p>
              )}
              {t.description && <p className="text-sm">{t.description}</p>}
              {t.address && (
                <a className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                   href={`https://maps.google.com/?q=${encodeURIComponent(t.address)}`}
                   target="_blank" rel="noopener noreferrer">
                  <MapPin className="h-3 w-3" /> {t.address}
                </a>
              )}
              {t.due_date && (
                <p className={cn("text-xs", overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
                  Due {t.due_date}{overdue ? " (overdue)" : ""}
                </p>
              )}
              {t.status === "completed" ? (
                <p className="text-xs text-muted-foreground">Completed at {t.completed_at ? new Date(t.completed_at).toLocaleString() : "—"}</p>
              ) : (
                <div className="flex flex-wrap gap-2 pt-1">
                  {t.status === "pending" && (
                    <Button size="sm" variant="outline" onClick={() => start(t.id)}>Start Task</Button>
                  )}
                  <Button size="sm" onClick={() => navigate({ to: "/checklist", search: { task_id: t.id } })}>
                    Complete with Inspection
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <p className="pt-4 text-center text-xs text-muted-foreground">
        <Link to="/checklist" className="underline">New blank inspection</Link>
      </p>
    </div>
  );
}