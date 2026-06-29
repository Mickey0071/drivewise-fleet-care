import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listCompletedTaskAlerts, acknowledgeCompletedTask,
} from "@/lib/runner-tasks-admin.functions";

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString("en-US") : "";
}

export function CompletedTaskAlerts() {
  const fetchAlerts = useServerFn(listCompletedTaskAlerts);
  const ackFn = useServerFn(acknowledgeCompletedTask);
  const qc = useQueryClient();

  const { data: alerts = [] } = useQuery({
    queryKey: ["completed-task-alerts"],
    queryFn: () => fetchAlerts(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const ackMut = useMutation({
    mutationFn: (id: string) => ackFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["completed-task-alerts"] }),
  });

  if (alerts.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
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