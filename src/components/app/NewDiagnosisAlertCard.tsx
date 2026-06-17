import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listNewDiagnoses } from "@/lib/repair-actions.functions";

type Diagnosis = {
  id: string;
  vehicle: string;
  plate: string;
  issue: string;
  mechanicName: string;
  cost: number;
};

export function NewDiagnosisAlertCard() {
  const fn = useServerFn(listNewDiagnoses);
  const { data } = useQuery({
    queryKey: ["new-mechanic-diagnoses"],
    queryFn: () => fn(),
    refetchInterval: 60 * 1000,
  });

  const diagnoses = (data?.diagnoses ?? []) as Diagnosis[];
  if (diagnoses.length === 0) return null;

  return (
    <Card className="mb-4 animate-pulse border-emerald-500/50 bg-emerald-500/10 shadow-md">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base text-emerald-700 dark:text-emerald-400">
          <Wrench className="h-4 w-4" /> New mechanic diagnosis ready to approve
          <Badge variant="secondary">{diagnoses.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {diagnoses.map((d) => (
          <Link
            key={d.id}
            to="/maintenance"
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">
                {d.vehicle}
                {d.plate ? <span className="text-muted-foreground"> · {d.plate}</span> : null}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {d.issue}
                {d.mechanicName ? ` — ${d.mechanicName}` : ""}
              </div>
            </div>
            <span className="shrink-0 font-semibold">${d.cost.toFixed(2)}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}