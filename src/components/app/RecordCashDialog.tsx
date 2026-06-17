import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { recordManualPayment } from "@/lib/mock/store";
import { toast } from "sonner";
import { DollarSign } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rentalId: string;
  renterName: string;
  defaultAmount: number;
  creditOnFile?: number;
}

export function RecordCashDialog({ open, onOpenChange, rentalId, renterName, defaultAmount, creditOnFile = 0 }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setAmount(defaultAmount ? defaultAmount.toFixed(2) : "");
      setDate(today);
      setNotes("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultAmount]);

  function handleRecord() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    const res = recordManualPayment(rentalId, amt, "cash", date);
    const d = new Date(date + "T00:00:00");
    const dStr = `${d.getMonth() + 1}-${d.getDate()}-${String(d.getFullYear()).slice(2)}`;
    toast.success(`Recorded $${amt.toFixed(2)} cash payment`, {
      description: res.fullyPaid ? `Paid in full · ${dStr}` : `Partial payment · ${dStr}`,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" /> Record Cash Payment
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cash-amount">Amount paid</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="cash-amount"
                type="number"
                min="0.01"
                step="0.01"
                className="pl-6"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Pre-filled with the remaining balance — edit for a partial payment.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cash-date">Date received</Label>
            <Input id="cash-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cash-notes">Notes (optional)</Label>
            <Textarea
              id="cash-notes"
              rows={2}
              maxLength={300}
              placeholder="Where / when cash was received"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            Records a cash receipt for {renterName || "renter"} into Payments and P&amp;L.
          </div>
          {creditOnFile > 0 && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-400">
              💳 Credit on file: ${creditOnFile.toFixed(2)} — already paid, nothing currently due.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleRecord}>
            <DollarSign className="mr-1 h-4 w-4" /> Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}