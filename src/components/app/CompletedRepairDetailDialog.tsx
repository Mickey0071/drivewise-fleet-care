import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import { vehicleById, fmtMoney, fmtDate, type Maintenance } from "@/lib/mock/data";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record: Maintenance | null;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "border-t border-border pt-1.5 font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "text-foreground" : ""}>{value}</span>
    </div>
  );
}

export function CompletedRepairDetailDialog({ open, onOpenChange, record }: Props) {
  if (!record) return null;
  const v = vehicleById(record.vehicleId);
  const parts = record.partsCost ?? record.selectedSolution?.partsCost ?? 0;
  const labor = record.laborCost ?? record.selectedSolution?.laborCost ?? 0;
  const total = record.cost ?? parts + labor;
  const estimate = record.selectedSolution?.totalCost;
  const issue = record.issueDescription || record.selectedSolution?.name || record.serviceType;

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
          {/* Vehicle & issue */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{v ? `${v.year} ${v.make} ${v.model}` : record.vehicleId}</span>
              <Badge className="bg-green-600 text-white hover:bg-green-600">✓ Completed</Badge>
            </div>
            <div className="text-xs text-muted-foreground">Tag #{v?.plate ?? "—"}</div>
            <div className="pt-1"><span className="text-muted-foreground">Issue: </span>{issue}</div>
            <div>
              <span className="text-muted-foreground">Completed: </span>
              {fmtDate((record.completionDate ?? record.dateCompleted)?.slice(0, 10))}
            </div>
            <div>
              <span className="text-muted-foreground">Mechanic: </span>
              {record.completedBy || record.vendor || "—"}
            </div>
          </div>

          {/* Cost breakdown */}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cost breakdown</div>
            <div className="space-y-1">
              <Row label="Parts" value={fmtMoney(parts)} />
              <Row label="Labor" value={fmtMoney(labor)} />
              <Row label="Total" value={fmtMoney(total)} strong />
              {estimate != null && estimate !== total && (
                <div className="pt-1 text-xs text-muted-foreground">Estimated: {fmtMoney(estimate)}</div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</div>
            {record.repairRequestNotes && (
              <div className="rounded-md border border-border p-2">
                <div className="text-xs font-medium text-muted-foreground">Runner</div>
                <div className="whitespace-pre-line">{record.repairRequestNotes}</div>
              </div>
            )}
            {record.mechanicNotes && (
              <div className="rounded-md border border-border p-2">
                <div className="text-xs font-medium text-muted-foreground">Mechanic</div>
                <div className="whitespace-pre-line">{record.mechanicNotes}</div>
              </div>
            )}
            {record.notes && (
              <div className="rounded-md border border-border p-2">
                <div className="text-xs font-medium text-muted-foreground">Additional findings</div>
                <div className="whitespace-pre-line text-muted-foreground">{record.notes}</div>
              </div>
            )}
            {!record.repairRequestNotes && !record.mechanicNotes && !record.notes && (
              <div className="text-xs text-muted-foreground">No notes recorded.</div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Back</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}