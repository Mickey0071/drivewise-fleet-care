import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";
import { listVerificationAlerts } from "@/lib/cardholder-verification.functions";

type Item = {
  id: string;
  renter_name: string;
  cardholder_name: string;
  verification_status: string;
};

export function VerificationAlertsCard() {
  const fetchAlerts = useServerFn(listVerificationAlerts);
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [refusedCount, setRefusedCount] = useState(0);

  useEffect(() => {
    let active = true;
    fetchAlerts()
      .then((res) => {
        if (!active) return;
        setItems((res?.items ?? []) as Item[]);
        setPendingCount(res?.pendingCount ?? 0);
        setRefusedCount(res?.refusedCount ?? 0);
      })
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [fetchAlerts]);

  if (!items || items.length === 0) return null;

  return (
    <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-amber-600" /> Verification Alerts
          {pendingCount > 0 && (
            <Badge variant="secondary">{pendingCount} pending</Badge>
          )}
          {refusedCount > 0 && (
            <Badge variant="destructive">{refusedCount} HIGH RISK refused</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((it) => {
          const refused = it.verification_status === "refused";
          const submitted = it.verification_status === "submitted";
          return (
            <button
              key={it.id}
              onClick={() => navigate({ to: "/rentals", search: { detail: it.id } })}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  {it.renter_name}{" "}
                  <span className="text-muted-foreground">paid with</span> {it.cardholder_name}
                </div>
                <div className="text-xs text-muted-foreground">{it.id}</div>
              </div>
              <Badge variant={refused ? "destructive" : submitted ? "default" : "outline"}>
                {refused
                  ? "HIGH RISK"
                  : submitted
                    ? "Submitted"
                    : "Pending"}
              </Badge>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
