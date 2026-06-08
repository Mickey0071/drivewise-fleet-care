import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  listCardholderReviews,
  resolveCardholderReview,
} from "@/lib/cardholder-verification.functions";

type Item = {
  id: string;
  renter_name: string;
  cardholder_name: string;
  cardholder_phone: string | null;
  cardholder_relationship: string | null;
  cardholder_license_url: string | null;
  cardholder_verified_at: string | null;
  verification_status: string;
  score: number;
  amount: number;
  updated_at: string;
};

type Filter = "all" | "pending" | "verified" | "refunded";

function statusBadge(s: string) {
  const map: Record<string, { label: string; variant: "secondary" | "default" | "destructive" | "outline" }> = {
    verified: { label: "Verified", variant: "default" },
    submitted: { label: "Submitted", variant: "secondary" },
    pending: { label: "Pending", variant: "outline" },
    refused: { label: "Refused", variant: "destructive" },
    refunded: { label: "Refunded", variant: "destructive" },
  };
  const m = map[s] ?? { label: s, variant: "outline" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function CardholderVerificationReviews() {
  const fetchList = useServerFn(listCardholderReviews);
  const resolveFn = useServerFn(resolveCardholderReview);
  const [items, setItems] = useState<Item[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [detail, setDetail] = useState<Item | null>(null);
  const [license, setLicense] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchList();
      setItems((res?.items ?? []) as Item[]);
    } catch {
      setItems([]);
    }
  }, [fetchList]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter((it) => {
      if (filter === "all") return true;
      if (filter === "pending")
        return ["pending", "submitted", "refused"].includes(it.verification_status);
      if (filter === "verified") return it.verification_status === "verified";
      if (filter === "refunded") return it.verification_status === "refunded";
      return true;
    });
  }, [items, filter]);

  const act = async (it: Item, action: "reviewed" | "refund") => {
    setBusyId(it.id);
    try {
      await resolveFn({ data: { rentalId: it.id, action } });
      toast.success(action === "reviewed" ? "Marked reviewed" : "Payment refunded");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  if (!items || items.length === 0) return null;

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending Review" },
    { key: "verified", label: "Verified" },
    { key: "refunded", label: "Refunded" },
  ];

  return (
    <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-amber-600" /> Payments Needing Review
          <Badge variant="secondary">{items.length}</Badge>
        </CardTitle>
        <div className="mt-2 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No payments in this view.</p>
        )}
        {filtered.map((it) => (
          <div
            key={it.id}
            className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="text-sm">
              <div className="font-medium">
                {it.renter_name} <span className="text-muted-foreground">paid with</span>{" "}
                {it.cardholder_name}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>${it.amount.toFixed(2)}</span>
                <span>· {it.id}</span>
                {statusBadge(it.verification_status)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {it.cardholder_license_url && (
                <Button size="sm" variant="outline" onClick={() => setLicense(it.cardholder_license_url)}>
                  View License
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setDetail(it)}>
                View Details
              </Button>
              <Button
                size="sm"
                disabled={busyId === it.id}
                onClick={() => act(it, "reviewed")}
              >
                {busyId === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark Reviewed"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busyId === it.id}
                onClick={() => act(it, "refund")}
              >
                Process Refund
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={!!license} onOpenChange={(o) => !o && setLicense(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cardholder license</DialogTitle>
          </DialogHeader>
          {license && <img src={license} alt="Cardholder license" className="w-full rounded-md" />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verification details</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-2 text-sm">
              <Row label="Renter" value={detail.renter_name} />
              <Row label="Cardholder" value={detail.cardholder_name} />
              <Row label="Relationship" value={detail.cardholder_relationship ?? "—"} />
              <Row label="Phone" value={detail.cardholder_phone ?? "—"} />
              <Row label="Amount" value={`$${detail.amount.toFixed(2)}`} />
              <Row label="Match score" value={`${Math.round((detail.score ?? 0) * 100)}%`} />
              <Row
                label="Verified at"
                value={
                  detail.cardholder_verified_at
                    ? new Date(detail.cardholder_verified_at).toLocaleString()
                    : "—"
                }
              />
              <Row label="Status" value={detail.verification_status} />
              {detail.cardholder_license_url && (
                <img
                  src={detail.cardholder_license_url}
                  alt="Cardholder license"
                  className="w-full rounded-md"
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}