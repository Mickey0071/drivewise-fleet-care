import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { DollarSign, Plus } from "lucide-react";
import {
  addIncomeCategory,
  addOtherIncome,
  listIncomeCategories,
  useOtherIncomeVersion,
} from "@/lib/other-income";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicleId: string;
  vehicleLabel?: string;
}

export function AddOtherIncomeDialog({ open, onOpenChange, vehicleId, vehicleLabel }: Props) {
  useOtherIncomeVersion(); // re-render when a new category is added
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState<string>("Insurance Claim");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [newCat, setNewCat] = useState("");
  const [showNewCat, setShowNewCat] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount("");
      setDate(today);
      setCategory(listIncomeCategories()[0] ?? "Other");
      setSource("");
      setNotes("");
      setNewCat("");
      setShowNewCat(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleAddCategory() {
    const clean = newCat.trim();
    if (!clean) return;
    addIncomeCategory(clean);
    setCategory(clean);
    setNewCat("");
    setShowNewCat(false);
  }

  function handleSave() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!category) {
      toast.error("Choose or add a category");
      return;
    }
    addOtherIncome({
      vehicleId,
      amount: amt,
      date,
      category,
      source: source.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    toast.success(`+${amt.toFixed(2)} added to ${vehicleLabel || "vehicle"}`, {
      description: `${category}${source ? ` · ${source}` : ""}`,
    });
    onOpenChange(false);
  }

  const cats = listIncomeCategories();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" /> Add Income
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="oi-amount">Amount received</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input id="oi-amount" type="number" min="0.01" step="0.01" className="pl-6"
                value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oi-date">Date received</Label>
            <Input id="oi-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            {!showNewCat ? (
              <div className="flex gap-2">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Choose category" /></SelectTrigger>
                  <SelectContent>
                    {cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" onClick={() => setShowNewCat(true)} title="Add new category">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input placeholder="New category name" value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); } }}
                  autoFocus />
                <Button type="button" onClick={handleAddCategory}>Add</Button>
                <Button type="button" variant="ghost" onClick={() => { setShowNewCat(false); setNewCat(""); }}>Cancel</Button>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oi-source">Source / payer (optional)</Label>
            <Input id="oi-source" placeholder="e.g. Progressive claim #12345, John Doe"
              value={source} onChange={(e) => setSource(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oi-notes">Notes (optional)</Label>
            <Textarea id="oi-notes" rows={2} maxLength={400}
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            Rolls into this vehicle's Income, Net P&amp;L, ROI, and the fleet P&amp;L report.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}><DollarSign className="mr-1 h-4 w-4" /> Add Income</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}