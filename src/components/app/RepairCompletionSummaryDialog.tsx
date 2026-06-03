import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Car, DollarSign, BellOff } from "lucide-react";
import { fmtMoney, fmtDate } from "@/lib/mock/data";
import type { RepairCompletionSummary } from "@/lib/mock/store";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  summary: RepairCompletionSummary | null;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "border-t border-border pt-1.5 font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "text-foreground" : ""}>{value}</span>
    </div>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
      <span>{children}</span>
    </li>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}

export function RepairCompletionSummaryDialog({ open, onOpenChange, summary }: Props) {
  if (!summary) return null;
  const s = summary;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Repair Completed
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Header */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{s.vehicleLabel}</span>
              <Badge className="bg-green-600 text-white hover:bg-green-600">✓ Completed</Badge>
            </div>
            <div className="text-xs text-muted-foreground">Tag #{s.vehiclePlate ?? "—"}</div>
            <div className="pt-1"><span className="text-muted-foreground">Issue: </span>{s.issue}</div>
            <div><span className="text-muted-foreground">Completed by: </span>{s.completedBy}</div>
            <div><span className="text-muted-foreground">Date: </span>{fmtDate(s.completionDate)}</div>
          </div>

          {/* Cost breakdown */}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <SectionTitle icon={<DollarSign className="h-3.5 w-3.5" />}>Cost breakdown</SectionTitle>
            <div className="space-y-1">
              <Row label="Parts" value={fmtMoney(s.parts)} />
              <Row label="Labor" value={fmtMoney(s.labor)} />
              <Row label="Total" value={fmtMoney(s.total)} strong />
            </div>
          </div>

          {/* Updates */}
          <div className="space-y-3 rounded-md border border-green-600/30 bg-green-600/5 p-3">
            <div>
              <SectionTitle icon={<Car className="h-3.5 w-3.5" />}>Fleet status</SectionTitle>
              <ul className="space-y-1 text-sm">
                <Check>
                  Vehicle: <span className="font-medium">{s.vehicleLabel}</span>{" "}
                  {s.vehicleAvailable ? "now Available" : `status: ${s.vehicleStatus}`}
                </Check>
                {s.vehicleAvailable && <Check>Can be rented again</Check>}
                <Check>Last service updated: {fmtDate(s.completionDate)}</Check>
              </ul>
            </div>

            <div>
              <SectionTitle icon={<DollarSign className="h-3.5 w-3.5" />}>P&amp;L updated</SectionTitle>
              <ul className="space-y-1 text-sm">
                <Check>Expense posted: {fmtMoney(s.expensePosted)}</Check>
                <Check>Parts: {fmtMoney(s.parts)} | Labor: {fmtMoney(s.labor)}</Check>
                <Check>Vehicle profitability recalculated</Check>
              </ul>
            </div>

            <div>
              <SectionTitle icon={<BellOff className="h-3.5 w-3.5" />}>Alerts cleared</SectionTitle>
              <ul className="space-y-1 text-sm">
                {s.alertCleared ? (
                  <Check><span className="font-medium">{s.alertCleared}</span> alert cleared</Check>
                ) : (
                  <Check>Open maintenance alert cleared</Check>
                )}
                <Check>Fleet maintenance alerts refreshed</Check>
              </ul>
            </div>

            {s.nextScheduled.length > 0 && (
              <div>
                <SectionTitle icon={<CheckCircle2 className="h-3.5 w-3.5" />}>Next scheduled services</SectionTitle>
                <ul className="space-y-1 text-sm">
                  {s.nextScheduled.map((it) => (
                    <Check key={it.type + it.label}>
                      {it.label} next due:{" "}
                      {it.dueDate ? fmtDate(it.dueDate) : it.dueMileage ? `${it.dueMileage.toLocaleString()} mi` : "—"}
                    </Check>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button asChild>
            <Link to="/pnl">View in P&amp;L</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
