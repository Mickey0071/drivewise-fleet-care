import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { listNameReviews, resolveNameReview } from "@/lib/name-review.functions";

type ReviewItem = {
  kind: "rental" | "extension";
  id: string;
  ref: string;
  renter_name: string;
  card_name: string;
  score: number;
  pending_since: string | null;
};

function timeAgo(s: string | null): string {
  if (!s) return "—";
  const ms = Date.now() - new Date(s).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function PendingPaymentReviews() {
  const fetchList = useServerFn(listNameReviews);
  const resolveFn = useServerFn(resolveNameReview);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchList();
      setItems((res?.items ?? []) as ReviewItem[]);
    } catch {
      setItems([]);
    }
  }, [fetchList]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (item: ReviewItem, action: "approve" | "refund") => {
    setBusyId(item.id);
    try {
      await resolveFn({ data: { kind: item.kind, id: item.id, action } });
      toast.success(action === "approve" ? "Payment approved" : "Payment refunded");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  if (!items || items.length === 0) return null;

  return (
    <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span aria-hidden>🟡</span> Pending Payment Reviews
          <Badge variant="secondary">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((it) => (
          <div
            key={`${it.kind}-${it.id}`}
            className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="text-sm">
              <div className="font-medium">
                {it.kind === "extension" ? "Extension" : "Reservation"} · {it.ref}
              </div>
              <div className="text-xs text-muted-foreground">
                Renter: {it.renter_name} · Card: {it.card_name} · Match{" "}
                {Math.round((it.score ?? 0) * 100)}% · {timeAgo(it.pending_since)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busyId === it.id}
                onClick={() => act(it, "approve")}
              >
                {busyId === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve Payment"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busyId === it.id}
                onClick={() => act(it, "refund")}
              >
                Refund Payment
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}