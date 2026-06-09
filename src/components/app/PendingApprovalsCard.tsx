import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listPendingApprovals } from "@/lib/repair-actions.functions";

export function PendingApprovalsCard() {
  const fn = useServerFn(listPendingApprovals);
  const { data } = useQuery({
    queryKey: ["pending-repair-approvals"],
    queryFn: () => fn(),
    refetchInterval: 5 * 60 * 1000,
  });

  const pending = data?.pending ?? [];
  if (pending.length === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          {pending.length} pending diagnosis approval{pending.length === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">Awaiting your Accept/Decline for over 4 hours.</p>
        {pending.map((p: any) => (
          <Link
            key={p.id}
            to="/maintenance"
            className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/40"
          >
            <span className="truncate">{p.issue_description || p.service_type || "Repair"}{p.mechanic_name ? ` — ${p.mechanic_name}` : ""}</span>
            <span className="font-semibold">${(Number(p.cost) || 0).toFixed(2)}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
