import { createFileRoute, redirect } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { expenses, activeVehicles, vehicleById, fmtDate, fmtMoney } from "@/lib/mock/data";
import { addExpense, deleteExpense, uploadExpenseReceipt, useStoreVersion } from "@/lib/mock/store";
import { Paperclip, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { ReportActions } from "@/components/app/ReportActions";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/expenses")({
  head: () => ({ meta: [{ title: "Expenses — Camauto Rentals" }] }),
  beforeLoad: () => { throw redirect({ to: "/admin/expenses" }); },
  component: ExpensesPage,
});

function ExpensesPage() {
  useStoreVersion();
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [vehicleId, setVehicleId] = useState<string>("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadCategories() {
    const { data, error } = await supabase
      .from("expense_categories")
      .select("name")
      .order("name");
    if (!error && data) {
      const names = data.map((r) => r.name);
      setCategories(names);
      setCategory((c) => c || names[0] || "");
    }
  }

  useEffect(() => { loadCategories(); }, []);

  function reset() {
    setAmount(""); setVendor(""); setNotes(""); setVehicleId(""); setReceiptFile(null);
    setDate(new Date().toISOString().slice(0, 10));
  }

  async function handleSave() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    const cat = category.trim();
    if (!cat) return toast.error("Pick or enter a category");
    setSaving(true);
    try {
      // Save new category if it's not already in the list
      if (!categories.some((c) => c.toLowerCase() === cat.toLowerCase())) {
        const { error: catErr } = await supabase
          .from("expense_categories")
          .insert({ name: cat });
        if (!catErr) {
          setCategories((prev) => [...prev, cat].sort((a, b) => a.localeCompare(b)));
        }
      }
      let receiptUrl: string | undefined;
      if (receiptFile) {
        const { url } = await uploadExpenseReceipt(receiptFile);
        receiptUrl = url;
      }
      const exp = addExpense({
        category: cat, amount: amt, date,
        vendor: vendor || undefined,
        notes: notes || undefined,
        vehicleId: vehicleId || undefined,
        receiptUrl,
      });
      await (exp as { cloudReady?: Promise<unknown> }).cloudReady;
      toast.success("Expense saved");
      reset();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save expense");
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...expenses].sort((a, b) => (b.date.localeCompare(a.date)));

  return (
    <div>
      <PageHeader
        title="Expense Logger"
        subtitle="Track every dollar that leaves the business"
        action={
          <ReportActions csv={{
            filename: "expenses.csv",
            headers: ["ID", "Category", "Vendor", "Date", "Amount", "Vehicle", "Notes"],
            rows: sorted.map(e => [e.id, e.category, e.vendor ?? "", e.date, e.amount, e.vehicleId ? vehicleById(e.vehicleId)?.plate ?? e.vehicleId : "", e.notes ?? ""]),
          }} />
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Quick add</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="mb-1.5 block text-xs">Category</Label>
              <Input
                list="expense-category-options"
                placeholder="Select or type a new category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id="expense-category-options">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Pick from the list or type a new one — new categories are saved automatically.
              </p>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Amount</Label>
              <Input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
                value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Vehicle (optional)</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">— Overhead / not tied to a vehicle —</option>
                {activeVehicles().map(v => (
                  <option key={v.id} value={v.id}>{v.year} {v.make} {v.model} · {v.plate}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Vendor</Label>
              <Input placeholder="e.g. QuickLube" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Notes</Label>
              <Input placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Receipt (optional)</Label>
              <label className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input bg-background px-3 text-sm hover:bg-muted">
                <Paperclip className="h-4 w-4" />
                <span className="truncate">{receiptFile ? receiptFile.name : "Attach receipt"}</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <Button className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save expense"}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent expenses ({sorted.length})</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {sorted.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">No expenses yet. Use the form to log your first one.</p>
            )}
            {sorted.map(e => {
              const v = e.vehicleId ? vehicleById(e.vehicleId) : null;
              return (
                <div key={e.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">{e.category.replace("_", " ")}</span>
                      {e.vendor && <span className="font-medium">{e.vendor}</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fmtDate(e.date)}{v && ` · ${v.plate}`}
                      {e.notes && ` · ${e.notes}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {e.receiptUrl && (
                      <a href={e.receiptUrl} target="_blank" rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground" title="View receipt">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <span className="font-semibold">{fmtMoney(e.amount)}</span>
                    <button
                      onClick={() => { if (confirm("Delete this expense?")) deleteExpense(e.id); }}
                      className="text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
