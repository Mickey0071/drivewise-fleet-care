import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { maintenance, vehicleById, fmtMoney, fmtDate, type Maintenance, type RepairSolution } from "@/lib/mock/data";
import { useStoreVersion, selectRepairSolution, recordRepairPayment, completeRepair, setRepairRentalBlocking } from "@/lib/mock/store";
import type { RepairCompletionSummary } from "@/lib/mock/store";
import { useServerFn } from "@tanstack/react-start";
import { notifyRunnerRepairComplete } from "@/lib/tasks.functions";
import { toast } from "sonner";
import { CheckCircle2, Wrench, Ban, Car } from "lucide-react";
import { CompletedRepairDetailDialog } from "@/components/app/CompletedRepairDetailDialog";
import { RepairCompletionSummaryDialog } from "@/components/app/RepairCompletionSummaryDialog";

function VehicleLink({ vehicleId }: { vehicleId: string }) {
  const v = vehicleById(vehicleId);
  const label = v ? `${v.year} ${v.make} ${v.model}` : vehicleId;
  return (
    <Link to="/fleet/$vehicleId" params={{ vehicleId }} className="text-sm font-semibold text-primary hover:underline">
      {label}
    </Link>
  );
}

function RentalBlockToggle({ m }: { m: Maintenance }) {
  const blocking = !!m.isRentalBlocking;
  const setBlocking = (next: boolean) => {
    if (next === blocking) return;
    setRepairRentalBlocking(m.id, next);
    toast.success(next ? "Vehicle marked non-rentable" : "Vehicle re-opened for rentals");
  };
  return (
    <div className="grid grid-cols-2 gap-1.5 pt-1">
      <Button
        size="sm"
        variant={blocking ? "destructive" : "outline"}
        className="h-8 text-xs"
        onClick={() => setBlocking(true)}
      >
        <Ban className="mr-1 h-3.5 w-3.5" /> Non-Rentable
      </Button>
      <Button
        size="sm"
        variant={blocking ? "outline" : "default"}
        className="h-8 text-xs"
        onClick={() => setBlocking(false)}
      >
        <Car className="mr-1 h-3.5 w-3.5" /> Allow Rentals
      </Button>
    </div>
  );
}

function OpenCard({ m }: { m: Maintenance }) {
  const [downPayments, setDownPayments] = useState<Record<string, string>>({});
  const choose = (sol: RepairSolution) => {
    const dp = Number(downPayments[sol.name]) || 0;
    selectRepairSolution(m.id, sol, dp);
    toast.success(`Moved to In Progress${dp > 0 ? ` · $${dp.toFixed(2)} down` : ""}`);
  };
  return (
    <Card className="border-border">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <VehicleLink vehicleId={m.vehicleId} />
          <Badge variant="outline">Open</Badge>
        </div>
        <div className="text-sm text-muted-foreground">{m.issueDescription || m.serviceType}</div>
        <RentalBlockToggle m={m} />
        <div className="space-y-2 pt-1">
          {(m.solutions ?? []).map((sol, i) => (
            <div key={i} className="rounded-md border border-border p-2">
              <div className="text-sm font-medium">{sol.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Parts {fmtMoney(sol.partsCost)} + Labor {fmtMoney(sol.laborCost)} ={" "}
                <span className="font-semibold text-foreground">{fmtMoney(sol.totalCost)}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number" min={0} step="0.01" className="h-8"
                  placeholder="Down pmt $ (optional)"
                  value={downPayments[sol.name] ?? ""}
                  onChange={e => setDownPayments(d => ({ ...d, [sol.name]: e.target.value }))}
                />
                <Button size="sm" className="shrink-0" onClick={() => choose(sol)}>Select</Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function InProgressCard({ m, onCompleted }: { m: Maintenance; onCompleted: (s: RepairCompletionSummary) => void }) {
  const [payment, setPayment] = useState("");
  const [completeOpen, setCompleteOpen] = useState(false);
  const sol = m.selectedSolution;
  if (!sol) return null;
  const paid = m.amountPaid ?? 0;
  const balance = Math.max(0, sol.totalCost - paid);
  const fullyPaid = balance <= 0;

  const addPayment = () => {
    const amt = Number(payment) || 0;
    if (amt <= 0) return toast.error("Enter a payment amount");
    recordRepairPayment(m.id, amt);
    setPayment("");
    toast.success(`Recorded ${fmtMoney(amt)}`);
  };

  return (
    <>
    <Card className="border-border">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <VehicleLink vehicleId={m.vehicleId} />
          <Badge variant="secondary">In Progress</Badge>
        </div>
        <div className="text-sm font-medium">{sol.name}</div>
        <RentalBlockToggle m={m} />
        <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
          <Row label="Estimate" value={fmtMoney(sol.totalCost)} />
          <Row label="Down payment" value={fmtMoney(m.downPayment ?? 0)} />
          <Row label="Total paid" value={fmtMoney(paid)} />
          <div className="mt-1 flex items-center justify-between border-t border-border pt-1 font-semibold">
            <span>Balance</span>
            <span className={fullyPaid ? "text-green-600" : "text-destructive"}>{fmtMoney(balance)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input type="number" min={0} step="0.01" className="h-8" placeholder="Add payment $"
            value={payment} onChange={e => setPayment(e.target.value)} />
          <Button size="sm" variant="outline" className="shrink-0" onClick={addPayment}>Record Payment</Button>
        </div>
        <Button size="sm" className="w-full" onClick={() => setCompleteOpen(true)}>
          <CheckCircle2 className="mr-1 h-4 w-4" /> Complete
        </Button>
      </CardContent>
    </Card>
    <CompleteRepairDialog m={m} open={completeOpen} onOpenChange={setCompleteOpen} onCompleted={onCompleted} />
    </>
  );
}

function CompleteRepairDialog({ m, open, onOpenChange, onCompleted }: { m: Maintenance; open: boolean; onOpenChange: (v: boolean) => void; onCompleted: (s: RepairCompletionSummary) => void }) {
  const sol = m.selectedSolution;
  const [parts, setParts] = useState(String(m.partsCost ?? sol?.partsCost ?? 0));
  const [labor, setLabor] = useState(String(m.laborCost ?? sol?.laborCost ?? 0));
  const [mechanic, setMechanic] = useState(m.completedBy ?? "");
  const [notes, setNotes] = useState(m.mechanicNotes ?? "");
  const notifyRunner = useServerFn(notifyRunnerRepairComplete);

  const partsNum = Number(parts) || 0;
  const laborNum = Number(labor) || 0;
  const total = partsNum + laborNum;

  const submit = () => {
    if (!mechanic.trim()) return toast.error("Mechanic name is required");
    if (total <= 0) return toast.error("Enter parts and/or labor cost");
    const summary = completeRepair(m.id, {
      completedBy: mechanic.trim(),
      partsCost: partsNum,
      laborCost: laborNum,
      mechanicNotes: notes.trim() || undefined,
    });
    toast.success("Repair completed & logged to P&L");
    onOpenChange(false);
    if (summary) {
      onCompleted(summary);
      // Best-effort notify the runner who reported the issue.
      if (summary.runnerId) {
        notifyRunner({
          data: {
            maintenanceId: summary.maintenanceId,
            issue: summary.issue,
            completedBy: summary.completedBy,
            mechanicNotes: notes.trim() || undefined,
            total: summary.total,
          },
        })
          .then((r) => { if (r?.notified) toast.success("Runner notified of completion"); })
          .catch(() => { /* notification failure must not block */ });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Complete repair</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Mechanic / completed by *</Label>
            <Input value={mechanic} onChange={e => setMechanic(e.target.value)} placeholder="e.g. John Smith" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Parts cost ($)</Label>
              <Input type="number" min={0} step="0.01" value={parts} onChange={e => setParts(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Labor cost ($)</Label>
              <Input type="number" min={0} step="0.01" value={labor} onChange={e => setLabor(e.target.value)} />
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-2 text-sm font-semibold">
            <div className="flex items-center justify-between">
              <span>Total cost</span>
              <span>{fmtMoney(total)}</span>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Mechanic work notes</Label>
            <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Replaced oil & filter, checked levels" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}><CheckCircle2 className="mr-1 h-4 w-4" /> Mark Complete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteCard({ m }: { m: Maintenance }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const sol = m.selectedSolution;
  const parts = m.partsCost ?? sol?.partsCost ?? 0;
  const labor = m.laborCost ?? sol?.laborCost ?? 0;
  return (
    <>
    <Card className="border-border">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <VehicleLink vehicleId={m.vehicleId} />
          <Badge className="bg-green-600 text-white hover:bg-green-600">Complete</Badge>
        </div>
        <div className="text-sm font-medium">{sol?.name ?? m.serviceType}</div>
        <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
          <Row label="Parts" value={fmtMoney(parts)} />
          <Row label="Labor" value={fmtMoney(labor)} />
          <Row label="Total ✓" value={fmtMoney(m.cost)} />
          <Row label="Mechanic" value={m.completedBy || m.vendor || "—"} />
          <Row label="Completed" value={fmtDate((m.completionDate ?? m.dateCompleted)?.slice(0, 10))} />
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={() => setDetailOpen(true)}>View Details</Button>
      </CardContent>
    </Card>
    <CompletedRepairDetailDialog record={m} open={detailOpen} onOpenChange={setDetailOpen} />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Column({ title, count, tone, children }: { title: string; count: number; tone: string; children: React.ReactNode }) {
  return (
    <Card className="bg-muted/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{title}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{count}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {count === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Nothing here yet
          </div>
        ) : children}
      </CardContent>
    </Card>
  );
}

export function RepairsBoard() {
  useStoreVersion();
  const [summary, setSummary] = useState<RepairCompletionSummary | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const handleCompleted = (s: RepairCompletionSummary) => {
    setSummary(s);
    setSummaryOpen(true);
  };
  const repairs = maintenance
    .filter(m => !!m.status && m.approvalStatus !== "pending" && m.approvalStatus !== "rejected")
    .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));
  const open = repairs.filter(m => m.status === "open");
  const inProgress = repairs.filter(m => m.status === "in_progress");
  const complete = repairs.filter(m => m.status === "complete");

  return (
    <>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Column title="Open" count={open.length} tone="bg-muted text-foreground">
        {open.map(m => <OpenCard key={m.id} m={m} />)}
      </Column>
      <Column title="In Progress" count={inProgress.length} tone="bg-amber-500/20 text-amber-700">
        {inProgress.map(m => <InProgressCard key={m.id} m={m} onCompleted={handleCompleted} />)}
      </Column>
      <Column title="Complete" count={complete.length} tone="bg-green-500/20 text-green-700">
        {complete.map(m => <CompleteCard key={m.id} m={m} />)}
      </Column>
    </div>
    <RepairCompletionSummaryDialog open={summaryOpen} onOpenChange={setSummaryOpen} summary={summary} />
    </>
  );
}