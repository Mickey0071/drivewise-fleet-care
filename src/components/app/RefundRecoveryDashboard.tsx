import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useServerFn } from "@tanstack/react-start";
import {
  listRefundRecovery,
  updateRefundRecoveryStatus,
  type RefundRecoveryRow,
} from "@/lib/refund-recovery.functions";
import { SendPaymentLinkDialog } from "@/components/app/SendPaymentLinkDialog";
import { ChargeCardDialog } from "@/components/app/ChargeCardDialog";
import { driverById, rentalById } from "@/lib/mock/data";
import { getSavedCard } from "@/lib/card-display";
import { fmtMoney } from "@/lib/mock/data";
import { toast } from "sonner";
import { RotateCcw, Smartphone, CreditCard, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

function statusBadge(status: string) {
  switch (status) {
    case "resolved":
      return <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">Resolved</Badge>;
    case "written_off":
      return <Badge variant="secondary">Written Off</Badge>;
    default:
      return <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">Needs Recovery</Badge>;
  }
}

export function RefundRecoveryDashboard() {
  const listFn = useServerFn(listRefundRecovery);
  const updateFn = useServerFn(updateRefundRecoveryStatus);
  const [rows, setRows] = useState<RefundRecoveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payLink, setPayLink] = useState<RefundRecoveryRow | null>(null);
  const [charge, setCharge] = useState<RefundRecoveryRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listFn();
      setRows(res.rows);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: "resolved" | "written_off") {
    setBusyId(id);
    try {
      await updateFn({ data: { id, status } });
      toast.success(status === "resolved" ? "Marked resolved" : "Written off");
      await load();
    } catch (e) {
      toast.error("Could not update", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  }

  const active = rows.filter((r) => r.status === "needs_recovery");
  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <Card className="mb-4 border-amber-500/30">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-semibold">Refund Recovery Needed</h2>
          <Badge variant="secondary">{active.length} open</Badge>
        </div>
        <div className="space-y-2">
          {rows.map((r) => {
            const driver = r.driverId ? driverById(r.driverId) : null;
            const savedCard = getSavedCard(driver);
            const consent = r.rentalId
              ? (() => {
                  const rental = rentalById(r.rentalId);
                  return !!(rental?.clientSignedAt || rental?.signedAt);
                })()
              : false;
            return (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-md border p-3 text-sm md:flex-row md:items-center md:justify-between"
              >
                <div className="space-y-0.5">
                  <div className="font-medium">
                    {r.renterName || "Unknown"}{" "}
                    <span className="text-muted-foreground">· {r.rentalId || "—"}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Refunded {fmtMoney(r.amount)} · {new Date(r.refundedAt).toLocaleDateString()} ·{" "}
                    {r.source === "admin" ? "Admin-initiated" : "System-detected"}
                    {r.source === "system" && !r.customerNotified ? " · ⚠️ customer not notified" : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {statusBadge(r.status)}
                  {r.status === "needs_recovery" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setPayLink(r)} disabled={!r.phone && !r.email}>
                        <Smartphone className="mr-1 h-3.5 w-3.5" /> Payment Link
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCharge(r)}
                        disabled={!savedCard || savedCard.expired || !consent}
                        title={!consent ? "No card-on-file consent in agreement" : undefined}
                      >
                        <CreditCard className="mr-1 h-3.5 w-3.5" /> Charge Card
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "resolved")} disabled={busyId === r.id}>
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Resolved
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, "written_off")} disabled={busyId === r.id}>
                        <XCircle className="mr-1 h-3.5 w-3.5" /> Write Off
                      </Button>
                    </>
                  )}
                  {r.status !== "needs_recovery" && (
                    <Button size="sm" variant="ghost" onClick={() => updateFn({ data: { id: r.id, status: "needs_recovery" } }).then(load)}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reopen
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      <SendPaymentLinkDialog
        open={!!payLink}
        onOpenChange={(o) => { if (!o) setPayLink(null); }}
        rentalId={payLink?.rentalId ?? ""}
        renterName={payLink?.renterName ?? ""}
        phone={payLink?.phone ?? ""}
        email={payLink?.email ?? null}
        defaultAmount={payLink?.amount ?? 0}
        description={payLink ? "Refund recovery — re-process payment" : ""}
        savedCard={payLink?.driverId ? getSavedCard(driverById(payLink.driverId)) : null}
        onSent={() => { if (payLink) setStatus(payLink.id, "resolved"); }}
      />
      <ChargeCardDialog
        open={!!charge}
        onOpenChange={(o) => { if (!o) setCharge(null); }}
        rentalId={charge?.rentalId ?? ""}
        driverId={charge?.driverId ?? ""}
        renterName={charge?.renterName ?? ""}
        defaultAmount={charge?.amount ?? 0}
        description="Refund recovery"
        defaultReason="Refund Recovery"
        savedCard={charge?.driverId ? getSavedCard(driverById(charge.driverId)) : null}
        consentOnFile={charge?.rentalId ? (() => { const rl = rentalById(charge.rentalId!); return !!(rl?.clientSignedAt || rl?.signedAt); })() : false}
      />
    </Card>
  );
}
