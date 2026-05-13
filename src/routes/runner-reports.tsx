import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { runnerReports, useStoreVersion, markAllReportsRead, unreadReportCount } from "@/lib/mock/store";
import { CheckCircle2, Circle, ClipboardList, MailOpen } from "lucide-react";

export const Route = createFileRoute("/runner-reports")({
  head: () => ({ meta: [{ title: "Runner Reports — Camauto Rentals" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ focus: (s.focus as string) || "" }),
  component: RunnerReportsPage,
});

function RunnerReportsPage() {
  useStoreVersion();
  const { focus } = Route.useSearch();
  const unread = unreadReportCount();

  useEffect(() => {
    // Auto-mark all read shortly after viewing
    const t = setTimeout(() => markAllReportsRead(), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div>
      <PageHeader
        title="Runner Reports"
        subtitle="Submitted checklists from runners"
        actions={
          unread > 0 ? (
            <Button variant="outline" size="sm" onClick={() => markAllReportsRead()}>
              <MailOpen className="mr-1 h-4 w-4" /> Mark all read
            </Button>
          ) : null
        }
      />

      {runnerReports.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <ClipboardList className="h-8 w-8" />
            <div>No reports submitted yet.</div>
            <div className="text-xs">Reports show up here when a runner submits their checklist.</div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {runnerReports.map(r => {
          const pct = r.totalTasks ? Math.round((r.completedTasks / r.totalTasks) * 100) : 0;
          const isFocused = r.id === focus;
          return (
            <Card key={r.id} className={isFocused ? "ring-2 ring-primary" : !r.read ? "border-primary/40" : ""}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {r.runnerName}
                    {!r.read && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">NEW</span>}
                  </CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.submittedAt).toLocaleString()} · {r.id}
                  </div>
                </div>
                <Badge variant={pct === 100 ? "default" : "secondary"}>
                  {r.completedTasks}/{r.totalTasks} · {pct}%
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {r.items.map(it => (
                  <div key={it.id} className="flex items-start gap-2 text-sm">
                    {it.done
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0">
                      <div className={it.done ? "text-muted-foreground line-through" : ""}>{it.label}</div>
                      {it.detail && <div className="text-xs text-muted-foreground">{it.detail}</div>}
                    </div>
                  </div>
                ))}
                {r.notes && (
                  <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
                    <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Runner notes</div>
                    {r.notes}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
