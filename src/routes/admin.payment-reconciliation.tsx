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
import {
  importStripeCharges,
  type ImportChargeLine,
  type ImportResult,
} from "@/lib/payment-reconciliation.functions";
import {
  auditBalances,
  type BalanceAuditLine,
} from "@/lib/balance-audit.functions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

      <Tabs defaultValue="balance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="balance">Balance audit</TabsTrigger>
          <TabsTrigger value="stripe">Stripe reconciliation</TabsTrigger>
          <TabsTrigger value="import">Import Stripe charges</TabsTrigger>
        </TabsList>

        <TabsContent value="balance" className="space-y-4">
          <BalanceAuditPanel />
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          <ImportChargesPanel />
        </TabsContent>

        <TabsContent value="stripe" className="space-y-4">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

const BAL_VERDICT: Record<
  BalanceAuditLine["verdict"],
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  ok: { label: "OK", variant: "secondary" },
  phantom_extension: { label: "Phantom extension", variant: "destructive" },
  missing_violation: { label: "Missing violation", variant: "outline" },
  bloated_base: { label: "Bloated base", variant: "destructive" },
  multi: { label: "Multiple", variant: "destructive" },
};

function BalanceAuditPanel() {
  const runAudit = useServerFn(auditBalances);
  const applyFix = useServerFn(applyPaymentCorrection);

  const [rentalId, setRentalId] = useState("");
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<BalanceAuditLine[] | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(true);

  const [fixRow, setFixRow] = useState<{ rentalId: string; paymentId: string; amount: number; expected: number } | null>(null);
  const [newAmount, setNewAmount] = useState("");
  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const res = await runAudit({ data: { rentalId: rentalId.trim() || undefined, onlyChanged } });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setLines(res.lines);
      toast.success(`Checked ${res.checked} reservations — ${res.changed} will change`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Balance audit failed");
    } finally {
      setLoading(false);
    }
  }

  function openSplit(rentalId: string, row: { payment_id: string; amount: number; expected: number }) {
    setFixRow({ rentalId, paymentId: row.payment_id, amount: row.amount, expected: row.expected });
    setNewAmount(String(row.expected));
    setReason(`Split base: original term is $${row.expected.toFixed(2)}; remove extension days bloat.`);
  }

  async function submitFix() {
    if (!fixRow) return;
    if (!reason.trim()) {
      toast.error("A reason is required");
      return;
    }
    setApplying(true);
    try {
      const res = await applyFix({
        data: {
          paymentId: fixRow.paymentId,
          action: "set_amount",
          newAmount: Number(newAmount),
          reason: reason.trim(),
        },
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Correction applied and logged to audit");
      setFixRow(null);
      await run();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Correction failed");
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <Card className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Canonical rule: <span className="font-medium text-foreground">base (original term) + signed extensions + unsigned out-accrual − ALL payments received − discounts</span>.
          Total payments includes every payment type (base, extensions, other). Sent-but-unsigned links never count; violations stay on their own line. Report-only — no records change.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="balRentalId" className="text-xs">Reservation (optional)</Label>
            <Input
              id="balRentalId"
              placeholder="e.g. R-576 — leave blank for all"
              value={rentalId}
              onChange={(e) => setRentalId(e.target.value)}
              className="w-64"
            />
          </div>
          <Button onClick={run} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run balance audit
          </Button>
          {lines && (
            <Button variant="ghost" size="sm" onClick={() => setOnlyChanged((v) => !v)}>
              {onlyChanged ? "Show all" : "Show only changed"}
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
                <TableHead>Renter</TableHead>
                <TableHead className="text-right">Time charge</TableHead>
                <TableHead className="text-right">Ext. sent</TableHead>
                <TableHead className="text-right">Accruing</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Old bal.</TableHead>
                <TableHead className="text-right">New bal.</TableHead>
                <TableHead className="text-right">Δ</TableHead>
                <TableHead className="text-right">Violations</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center text-muted-foreground py-6">
                    <CheckCircle2 className="h-5 w-5 inline mr-2 text-green-600" />
                    No balance changes.
                  </TableCell>
                </TableRow>
              ) : (
                lines.map((l) => {
                  const v = BAL_VERDICT[l.verdict];
                  return (
                    <TableRow key={l.rental_id}>
                      <TableCell className="font-medium">{l.rental_id}</TableCell>
                      <TableCell className="text-xs">{l.renter_name}</TableCell>
                      <TableCell className="text-right">{money(l.base_rental)}</TableCell>
                      <TableCell className="text-right">{money(l.signed_extensions)}</TableCell>
                      <TableCell className="text-right">{money(l.unsigned_accrual)}</TableCell>
                      <TableCell className="text-right">{money(l.total_payments)}</TableCell>
                      <TableCell className="text-right">{money(l.old_balance)}</TableCell>
                      <TableCell className="text-right font-medium">{money(l.canonical_balance)}</TableCell>
                      <TableCell className={`text-right ${l.delta < 0 ? "text-green-600" : l.delta > 0 ? "text-destructive" : ""}`}>
                        {l.delta === 0 ? "—" : `${l.delta > 0 ? "+" : ""}${money(l.delta)}`}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{money(l.violations_unpaid)}</TableCell>
                      <TableCell className="text-xs max-w-[320px]">
                        <ul className="list-disc pl-4 space-y-0.5">
                          {l.reasons.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      </TableCell>
                      <TableCell><Badge variant={v.variant}>{v.label}</Badge></TableCell>
                      <TableCell>
                        {l.bloated_rows.map((b) => (
                          <Button
                            key={b.payment_id}
                            size="sm"
                            variant="outline"
                            className="mb-1"
                            onClick={() => openSplit(l.rental_id, b)}
                          >
                            Split {money(b.amount)}
                          </Button>
                        ))}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={!!fixRow} onOpenChange={(o) => !o && setFixRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Split bloated base charge
            </DialogTitle>
            <DialogDescription>
              Correct the base charge to the original-term amount. The change is written to the payment audit log.
            </DialogDescription>
          </DialogHeader>
          {fixRow && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md bg-muted/40 p-3 space-y-1">
                <div>Reservation: <span className="font-medium">{fixRow.rentalId}</span></div>
                <div>Payment: <span className="font-mono text-xs">{fixRow.paymentId}</span></div>
                <div>Current: {money(fixRow.amount)} · Expected base: {money(fixRow.expected)}</div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="balNewAmount" className="text-xs">New base amount</Label>
                <Input id="balNewAmount" type="number" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="balReason" className="text-xs">Reason (required — recorded in audit log)</Label>
                <Input id="balReason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFixRow(null)} disabled={applying}>Cancel</Button>
            <Button onClick={submitFix} disabled={applying} className="gap-2">
              {applying && <Loader2 className="h-4 w-4 animate-spin" />}
              Apply &amp; log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const IMPORT_STATUS: Record<
  ImportChargeLine["status"],
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  inserted: { label: "Recorded", variant: "secondary" },
  would_insert: { label: "Will add", variant: "default" },
  already_recorded: { label: "Already there", variant: "outline" },
  possible_cash_duplicate: { label: "Possible duplicate", variant: "destructive" },
  unmatched: { label: "Unmatched", variant: "destructive" },
};

function ImportChargesPanel() {
  const runImport = useServerFn(importStripeCharges);

  const [driverId, setDriverId] = useState("");
  const [allDrivers, setAllDrivers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<Exclude<ImportResult, { error: string }> | null>(null);

  async function run(commit: boolean) {
    if (!driverId.trim() && !allDrivers) {
      toast.error("Enter a renter id or tick 'all renters'");
      return;
    }
    commit ? setCommitting(true) : setLoading(true);
    try {
      const res = await runImport({
        data: {
          driverId: allDrivers ? undefined : driverId.trim() || undefined,
          allDrivers: allDrivers || undefined,
          commit,
        },
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setResult(res);
      toast.success(
        commit
          ? `Recorded ${res.inserted} Stripe charge(s)`
          : `Found ${res.would_insert} missing charge(s) to add`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
      setCommitting(false);
    }
  }

  return (
    <>
      <Card className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Pulls succeeded Stripe charges (including from payment links / extensions) that were never
          written into the payments table and records them against the matching reservation. Preview
          first — nothing is saved until you press <span className="font-medium text-foreground">Import</span>.
          Already-recorded charges and likely cash duplicates are skipped automatically.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="impDriverId" className="text-xs">Renter id (e.g. D-1014)</Label>
            <Input
              id="impDriverId"
              placeholder="D-1014"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              disabled={allDrivers}
              className="w-48"
            />
          </div>
          <label className="flex items-center gap-2 text-sm pb-2">
            <input type="checkbox" checked={allDrivers} onChange={(e) => setAllDrivers(e.target.checked)} />
            All renters
          </label>
          <Button onClick={() => run(false)} disabled={loading || committing} className="gap-2" variant="outline">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Preview
          </Button>
          <Button
            onClick={() => run(true)}
            disabled={loading || committing || !result || result.would_insert === 0}
            className="gap-2"
          >
            {committing && <Loader2 className="h-4 w-4 animate-spin" />}
            Import{result ? ` ${result.would_insert}` : ""}
          </Button>
          {result && <Badge variant="outline">Stripe: {result.environment}</Badge>}
        </div>
        {result && (
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <span>Renters scanned: {result.drivers_scanned}</span>
            <span>Charges found: {result.charges_found}</span>
            <span>To add: {result.would_insert}</span>
            <span>Recorded: {result.inserted}</span>
            <span>Already there: {result.already_recorded}</span>
            <span>Possible duplicates: {result.possible_duplicates}</span>
            <span>Unmatched: {result.unmatched}</span>
          </div>
        )}
      </Card>

      {result && (
        <Card className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Renter</TableHead>
                <TableHead>Reservation</TableHead>
                <TableHead>Charge date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Charge id</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    <CheckCircle2 className="h-5 w-5 inline mr-2 text-green-600" />
                    No Stripe charges found for this renter.
                  </TableCell>
                </TableRow>
              ) : (
                result.lines.map((l) => {
                  const s = IMPORT_STATUS[l.status];
                  return (
                    <TableRow key={l.charge_id}>
                      <TableCell className="font-mono text-xs">{l.driver_id}</TableCell>
                      <TableCell className="font-medium">{l.rental_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">{l.charge_date}</TableCell>
                      <TableCell className="text-right">{money(l.amount)}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[160px] truncate">{l.charge_id}</TableCell>
                      <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                      <TableCell className="text-xs max-w-[280px]">{l.detail}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}