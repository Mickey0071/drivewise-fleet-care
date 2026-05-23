import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Check, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  listRefundRequests, approveRefundRequest, denyRefundRequest,
} from "@/lib/refunds.functions";

export const Route = createFileRoute("/refund-approvals")({
  head: () => ({ meta: [{ title: "Refund Approvals — Camauto Rentals" }] }),
  component: RefundApprovalsPage,
});

type RefundRequest = {
  id: string;
  rental_id: string;
  amount: number;
  reason: string | null;
  status: string;
  requester_name: string | null;
  requester_role: string;
  renter_name: string | null;
  created_at: string;
  decided_at: string | null;
  denial_reason: string | null;
  error: string | null;
  stripe_refund_id: string | null;
};

function fmtMoney(n: number) {
  return `$${Number(n).toFixed(2)}`;
}
function fmtDateTime(s: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

function RefundApprovalsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const fetchList = useServerFn(listRefundRequests);
  const approveFn = useServerFn(approveRefundRequest);
  const denyFn = useServerFn(denyRefundRequest);
  const [items, setItems] = useState<RefundRequest[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denying, setDenying] = useState<RefundRequest | null>(null);
  const [denyReason, setDenyReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { requests } = await fetchList({});
      setItems(requests as unknown as RefundRequest[]);
    } catch (e) {
      toast.error("Failed to load refund requests", { description: e instanceof Error ? e.message : String(e) });
    } finally { setLoading(false); }
  }, [fetchList]);

  useEffect(() => { void load(); }, [load]);

  async function handleApprove(r: RefundRequest) {
    setBusyId(r.id);
    try {
      await approveFn({ data: { id: r.id } });
      toast.success(`Refund of ${fmtMoney(r.amount)} approved & processed`);
      await load();
    } catch (e) {
      toast.error("Approve failed", { description: e instanceof Error ? e.message : String(e) });
    } finally { setBusyId(null); }
  }

  async function handleDeny() {
    if (!denying) return;
    setBusyId(denying.id);
    try {
      await denyFn({ data: { id: denying.id, reason: denyReason.trim() } });
      toast.success("Refund denied — requester notified");
      setDenying(null); setDenyReason("");
      await load();
    } catch (e) {
      toast.error("Deny failed", { description: e instanceof Error ? e.message : String(e) });
    } finally { setBusyId(null); }
  }

  const pending = (items ?? []).filter((r) => r.status === "pending");
  const history = (items ?? []).filter((r) => r.status !== "pending");

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Refund Approvals</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Review and approve refund requests submitted by VAs."
              : "Your refund requests and their status."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pending ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          {pending.length === 0 && (
            <p className="text-sm text-muted-foreground">No pending refund requests.</p>
          )}
          {pending.map((r) => (
            <div key={r.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{fmtMoney(r.amount)} — {r.renter_name || r.rental_id}</div>
                  <div className="text-xs text-muted-foreground">
                    Requested by {r.requester_name || "Staff"} ({r.requester_role.toUpperCase()}) · {fmtDateTime(r.created_at)}
                  </div>
                  <div className="text-xs text-muted-foreground">Rental: {r.rental_id}</div>
                  {r.reason && <div className="mt-1 text-sm italic">"{r.reason}"</div>}
                </div>
                {isAdmin && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleApprove(r)} disabled={busyId === r.id}>
                      {busyId === r.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                      Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => { setDenying(r); setDenyReason(""); }} disabled={busyId === r.id}>
                      <X className="mr-1 h-4 w-4" /> Deny
                    </Button>
                  </div>
                )}
                {!isAdmin && <Badge variant="secondary">Awaiting admin</Badge>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent className="divide-y p-0">
          {history.length === 0 && <p className="p-4 text-sm text-muted-foreground">No past requests.</p>}
          {history.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{fmtMoney(r.amount)} — {r.renter_name || r.rental_id}</div>
                <div className="text-xs text-muted-foreground">
                  By {r.requester_name || "Staff"} · {fmtDateTime(r.created_at)}
                  {r.decided_at && ` · decided ${fmtDateTime(r.decided_at)}`}
                </div>
                {r.denial_reason && <div className="text-xs italic">Denied: "{r.denial_reason}"</div>}
                {r.error && <div className="text-xs text-destructive">Error: {r.error}</div>}
              </div>
              <Badge
                variant={
                  r.status === "approved" ? "default"
                  : r.status === "denied" ? "secondary"
                  : "destructive"
                }
              >
                {r.status}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!denying} onOpenChange={(o) => { if (!o) setDenying(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Deny refund request</DialogTitle></DialogHeader>
          {denying && (
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium">{fmtMoney(denying.amount)}</span> for {denying.renter_name || denying.rental_id},
                requested by {denying.requester_name || "Staff"}.
              </div>
              <Textarea
                placeholder="Reason (sent via SMS to the requester)"
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                maxLength={500}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenying(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeny} disabled={busyId !== null}>
              {busyId !== null ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Deny refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}