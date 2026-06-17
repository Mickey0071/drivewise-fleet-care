import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  reconcilePayments,
  applyPaymentCorrection,
  type ReconLine,
} from "@/lib/payment-reconciliation.functions";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/admin/payment-reconciliation")({
  head: () => ({ meta: [{ title: "Payment Reconciliation — Camauto Rentals" }] }),
  component: ReconciliationPage,
});

function money(n: number | null) {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

const VERDICT_LABEL: Record<ReconLine["verdict"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  ok: { label: "Match", variant: "secondary" },
  mismatch: { label: "Mismatch", variant: "destructive" },
  no_charge_id: { label: "No charge id", variant: "outline" },
  charge_not_found: { label: "Not in Stripe", variant: "destructive" },
  error: { label: "Error", variant: "destructive" },
};

function ReconciliationPage() {
  const runRecon = useServerFn(reconcilePayments);
  const applyFix = useServerFn(applyPaymentCorrection);

  const [rentalId, setRentalId] = useState("");
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<ReconLine[] | null>(null);
  const [env, setEnv] = useState<string>("");
  const [onlyIssues, setOnlyIssues] = useState(true);

  const [selected, setSelected] = useState<ReconLine | null>(null);
  const [action, setAction] = useState<"set_amount" | "delete">("set_amount");
  const [newAmount, setNewAmount] = useState("");
  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const res = await runRecon({ data: rentalId.trim() ? { rentalId: rentalId.trim() } : {} });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setLines(res.lines);
      setEnv(res.environment);
      toast.success(`Checked ${res.checked} rows — ${res.mismatches} need review`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reconciliation failed");
    } finally {
      setLoading(false);
    }
  }

  function openCorrection(line: ReconLine) {
    setSelected(line);
    setAction(line.verdict === "charge_not_found" || line.verdict === "no_charge_id" ? "delete" : "set_amount");
    setNewAmount(line.stripe_amount != null ? String(line.stripe_amount) : String(line.row_amount));
    setReason("");
  }

  async function submitCorrection() {
    if (!selected) return;
    if (!reason.trim()) {
      toast.error("A reason is required");
      return;
    }
    setApplying(true);
    try {
      const res = await applyFix({
        data: {
          paymentId: selected.payment_id,
          action,
          newAmount: action === "set_amount" ? Number(newAmount) : undefined,
          reason: reason.trim(),
        },
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Correction applied and logged");
      setSelected(null);
      await run();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Correction failed");
    } finally {
      setApplying(false);
    }
  }

  const visible = useMemo(() => {
    if (!lines) return [];
    return onlyIssues ? lines.filter((l) => l.verdict !== "ok") : lines;
  }, [lines, onlyIssues]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payment Reconciliation"
        subtitle="Report-only: compares each payment row against the real Stripe charge. No changes are made until you approve a correction — every applied change is written to the payment audit log."
      />

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="rentalId" className="text-xs">Reservation (optional)</Label>
            <Input
              id="rentalId"
              placeholder="e.g. R-576 — leave blank for all"
              value={rentalId}
              onChange={(e) => setRentalId(e.target.value)}
              className="w-64"
            />
          </div>
          <Button onClick={run} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run report
          </Button>
          {env && <Badge variant="outline">Stripe: {env}</Badge>}
          {lines && (
            <Button variant="ghost" size="sm" onClick={() => setOnlyIssues((v) => !v)}>
              {onlyIssues ? "Show all rows" : "Show only issues"}
            </Button>
          )}
        </div>
      </Card>

      {lines && (
        <Card className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reservation</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Row amount</TableHead>
                <TableHead className="text-right">Stripe amount</TableHead>
                <TableHead>Charge id</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    <CheckCircle2 className="h-5 w-5 inline mr-2 text-green-600" />
                    No discrepancies to review.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((l) => {
                  const v = VERDICT_LABEL[l.verdict];
                  return (
                    <TableRow key={l.payment_id}>
                      <TableCell className="font-medium">{l.rental_id}</TableCell>
                      <TableCell className="font-mono text-xs">{l.payment_id}</TableCell>
                      <TableCell className="text-right">{money(l.row_amount)}</TableCell>
                      <TableCell className="text-right">{money(l.stripe_amount)}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[180px] truncate">
                        {l.stripe_charge_id ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={v.variant}>{v.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {l.verdict !== "ok" && (
                          <Button size="sm" variant="outline" onClick={() => openCorrection(l)}>
                            Review
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Apply correction
            </DialogTitle>
            <DialogDescription>{selected?.detail}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md bg-muted/40 p-3 space-y-1">
                <div>Reservation: <span className="font-medium">{selected.rental_id}</span></div>
                <div>Payment: <span className="font-mono text-xs">{selected.payment_id}</span></div>
                <div>Row amount: {money(selected.row_amount)} · Stripe: {money(selected.stripe_amount)}</div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={action === "set_amount" ? "default" : "outline"}
                  onClick={() => setAction("set_amount")}
                >
                  Correct amount
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={action === "delete" ? "destructive" : "outline"}
                  onClick={() => setAction("delete")}
                >
                  Delete row
                </Button>
              </div>
              {action === "set_amount" && (
                <div className="space-y-1">
                  <Label htmlFor="newAmount" className="text-xs">New amount</Label>
                  <Input
                    id="newAmount"
                    type="number"
                    step="0.01"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="reason" className="text-xs">Reason (required — recorded in audit log)</Label>
                <Input
                  id="reason"
                  placeholder="e.g. Matches real Stripe charge of $200"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={submitCorrection} disabled={applying} className="gap-2">
              {applying && <Loader2 className="h-4 w-4 animate-spin" />}
              Apply &amp; log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}