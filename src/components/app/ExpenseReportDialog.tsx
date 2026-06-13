import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { expenses, vehicles, vehicleById, fmtMoney, fmtDate, type Expense } from "@/lib/mock/data";
import { downloadCSV } from "@/lib/exports";
import { useExpenseCategories } from "@/hooks/use-expense-categories";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GroupBy = "category" | "vehicle" | "month";

function vehicleLabel(id?: string) {
  if (!id) return "General";
  const v = vehicleById(id);
  return v ? `${v.year} ${v.make} ${v.model} · ${v.plate}` : id;
}

export function ExpenseReportDialog({ open, onOpenChange }: Props) {
  const { categories } = useExpenseCategories();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("category");

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      if (category && e.category !== category) return false;
      if (vehicleId === "__general") { if (e.vehicleId) return false; }
      else if (vehicleId && e.vehicleId !== vehicleId) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [from, to, category, vehicleId]);

  const groups = useMemo(() => {
    const map = new Map<string, { items: Expense[]; total: number }>();
    for (const e of filtered) {
      const key = groupBy === "category" ? e.category
        : groupBy === "vehicle" ? vehicleLabel(e.vehicleId)
        : e.date.slice(0, 7);
      const g = map.get(key) ?? { items: [], total: 0 };
      g.items.push(e); g.total += e.amount;
      map.set(key, g);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupBy]);

  const grandTotal = filtered.reduce((s, e) => s + e.amount, 0);

  function exportCSV() {
    downloadCSV(
      "expense-report.csv",
      ["Date", "Category", "Amount", "Vehicle", "Vendor", "Payment", "Description"],
      filtered.map((e) => [
        e.date, e.category, e.amount, vehicleLabel(e.vehicleId),
        e.vendor ?? "", e.paymentMethod ?? "", e.notes ?? "",
      ]),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate Expense Report</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Category</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All</option>
                {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Vehicle</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">All</option>
                <option value="__general">General (no vehicle)</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
              </select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Group by</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="category">Category</option>
                <option value="vehicle">Vehicle</option>
                <option value="month">Month</option>
              </select>
            </div>
          </div>

          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium">
              <span>{filtered.length} expenses</span>
              <span>Total: {fmtMoney(grandTotal)}</span>
            </div>
            <div className="max-h-64 overflow-y-auto p-2 text-sm">
              {groups.length === 0 && <p className="p-4 text-muted-foreground">No expenses match these filters.</p>}
              {groups.map(([key, g]) => (
                <div key={key} className="mb-2">
                  <div className="flex items-center justify-between font-medium">
                    <span>{key}</span><span>{fmtMoney(g.total)}</span>
                  </div>
                  {g.items.map((e) => (
                    <div key={e.id} className="flex items-center justify-between pl-3 text-xs text-muted-foreground">
                      <span className="truncate">{fmtDate(e.date)} · {e.vendor ?? e.notes ?? e.category}</span>
                      <span>{fmtMoney(e.amount)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={exportCSV} disabled={filtered.length === 0}>
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}