import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Paperclip, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { vehicles, maintenance, type Expense } from "@/lib/mock/data";
import { addExpense, updateExpense, uploadExpenseReceipt } from "@/lib/mock/store";
import { useExpenseCategories } from "@/hooks/use-expense-categories";

const PAYMENT_METHODS = ["Cash", "Card", "Check", "Bank Transfer", "Other"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this expense; otherwise it creates a new one. */
  expense?: Expense | null;
  /** Pre-select a vehicle (e.g. when adding from a vehicle page). */
  defaultVehicleId?: string;
  onSaved?: () => void;
}

export function ExpenseDialog({ open, onOpenChange, expense, defaultVehicleId, onSaved }: Props) {
  const { categories, ensureCategory } = useExpenseCategories();
  const editing = !!expense;

  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [hasVehicle, setHasVehicle] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [maintenanceId, setMaintenanceId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  // Payroll
  const [payrollEmployee, setPayrollEmployee] = useState("");
  const [payrollStart, setPayrollStart] = useState("");
  const [payrollEnd, setPayrollEnd] = useState("");
  const [payrollHours, setPayrollHours] = useState("");
  const [payrollRate, setPayrollRate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(expense?.date ?? new Date().toISOString().slice(0, 10));
    setAmount(expense ? String(expense.amount) : "");
    setCategory(expense?.category ?? "");
    const vid = expense?.vehicleId ?? defaultVehicleId ?? "";
    setHasVehicle(!!vid);
    setVehicleId(vid);
    setMaintenanceId(expense?.maintenanceId ?? "");
    setPaymentMethod(expense?.paymentMethod ?? "Cash");
    setReferenceNumber(expense?.referenceNumber ?? "");
    setVendor(expense?.vendor ?? "");
    setNotes(expense?.notes ?? "");
    setReceiptFile(null);
    setPayrollEmployee(expense?.payrollEmployee ?? "");
    setPayrollStart(expense?.payrollPeriodStart ?? "");
    setPayrollEnd(expense?.payrollPeriodEnd ?? "");
    setPayrollHours(expense?.payrollHours != null ? String(expense.payrollHours) : "");
    setPayrollRate(expense?.payrollRate != null ? String(expense.payrollRate) : "");
  }, [open, expense, defaultVehicleId]);

  const isPayroll = category.trim().toLowerCase() === "payroll";

  // Auto-calc amount from hours * rate for payroll if both present and amount empty/derived.
  useEffect(() => {
    if (!isPayroll) return;
    const h = parseFloat(payrollHours);
    const r = parseFloat(payrollRate);
    if (!isNaN(h) && !isNaN(r) && h > 0 && r > 0) {
      setAmount((h * r).toFixed(2));
    }
  }, [isPayroll, payrollHours, payrollRate]);

  const vehicleMaintenance = useMemo(
    () => maintenance.filter((m) => m.vehicleId === vehicleId),
    [vehicleId],
  );

  async function handleSave() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    const cat = category.trim();
    if (!cat) return toast.error("Pick or enter a category");
    setSaving(true);
    try {
      await ensureCategory(cat);
      let receiptUrl = expense?.receiptUrl;
      if (receiptFile) {
        const { url } = await uploadExpenseReceipt(receiptFile);
        receiptUrl = url;
      }
      const payload: Omit<Expense, "id"> = {
        category: cat,
        amount: amt,
        date,
        vendor: vendor || undefined,
        vehicleId: hasVehicle ? (vehicleId || undefined) : undefined,
        maintenanceId: hasVehicle ? (maintenanceId || undefined) : undefined,
        paymentMethod: paymentMethod || undefined,
        referenceNumber: referenceNumber || undefined,
        notes: notes || undefined,
        receiptUrl,
        payrollEmployee: isPayroll ? (payrollEmployee || undefined) : undefined,
        payrollPeriodStart: isPayroll ? (payrollStart || undefined) : undefined,
        payrollPeriodEnd: isPayroll ? (payrollEnd || undefined) : undefined,
        payrollHours: isPayroll && payrollHours ? parseFloat(payrollHours) : undefined,
        payrollRate: isPayroll && payrollRate ? parseFloat(payrollRate) : undefined,
      };
      if (editing && expense) {
        updateExpense(expense.id, payload);
      } else {
        const exp = addExpense(payload);
        await (exp as { cloudReady?: Promise<unknown> }).cloudReady;
      }
      toast.success(editing ? "Expense updated" : "Expense saved");
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save expense");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Expense" : "Add Expense"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Amount</Label>
              <Input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
                value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block text-xs">Category</Label>
            <Input list="expense-dialog-categories" placeholder="Select or type a new category"
              value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="expense-dialog-categories">
              {categories.map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
          </div>

          {isPayroll && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">Payroll details</p>
              <div>
                <Label className="mb-1.5 block text-xs">Employee / Person</Label>
                <Input value={payrollEmployee} onChange={(e) => setPayrollEmployee(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-xs">Pay period start</Label>
                  <Input type="date" value={payrollStart} onChange={(e) => setPayrollStart(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">Pay period end</Label>
                  <Input type="date" value={payrollEnd} onChange={(e) => setPayrollEnd(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-xs">Hours (optional)</Label>
                  <Input type="number" min="0" step="0.25" value={payrollHours} onChange={(e) => setPayrollHours(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">Hourly rate (optional)</Label>
                  <Input type="number" min="0" step="0.01" value={payrollRate} onChange={(e) => setPayrollRate(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          <div className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Is this expense for a specific vehicle?</Label>
              <Switch checked={hasVehicle} onCheckedChange={setHasVehicle} />
            </div>
            {hasVehicle && (
              <div className="mt-3 space-y-3">
                <div>
                  <Label className="mb-1.5 block text-xs">Vehicle</Label>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setMaintenanceId(""); }}>
                    <option value="">— Select a vehicle —</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.year} {v.make} {v.model} · {v.plate}</option>
                    ))}
                  </select>
                </div>
                {vehicleMaintenance.length > 0 && (
                  <div>
                    <Label className="mb-1.5 block text-xs">Link to repair ticket (optional)</Label>
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={maintenanceId} onChange={(e) => setMaintenanceId(e.target.value)}>
                      <option value="">— None —</option>
                      {vehicleMaintenance.map((m) => (
                        <option key={m.id} value={m.id}>{m.id} · {m.serviceType ?? m.issueDescription ?? "Repair"}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Paid by</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Reference #</Label>
              <Input placeholder="Check / txn #" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block text-xs">Vendor / Paid to</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>

          <div>
            <Label className="mb-1.5 block text-xs">Receipt (optional)</Label>
            <label className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input bg-background px-3 text-sm hover:bg-muted">
              <Paperclip className="h-4 w-4" />
              <span className="truncate">{receiptFile ? receiptFile.name : (expense?.receiptUrl ? "Replace receipt" : "Attach receipt")}</span>
              <input type="file" accept="image/*,application/pdf" className="hidden"
                onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>

          <div>
            <Label className="mb-1.5 block text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Description / details" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save Expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}